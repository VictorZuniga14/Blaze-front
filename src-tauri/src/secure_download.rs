//! Lógica de descarga segura compartida entre runtime_install y vendor assets.
//! Reutiliza allowlist de hosts, validación de URLs, verificación de hash, límites, etc.

use futures_util::StreamExt;
use reqwest;
use sha2::{Digest, Sha256};
use std::env;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const ALLOWED_HOSTS: &[&str] = &[
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "buildbot.libretro.com",
    "git.eden-emu.dev",
];

// Patrones wildcard para hosts dinámicos (fallback cuando no hay host exacto configurado)
// ADVERTENCIA: Solo usar como fallback documentado. En producción configurar BLAZE_R2_HOST.
const ALLOWED_HOST_PATTERNS_FALLBACK: &[&str] = &[
    "*.r2.cloudflarestorage.com",  // Cloudflare R2 storage (URLs presignadas) - FALLBACK
];

const DOWNLOAD_TIMEOUT_SECS: u64 = 60 * 60;
const CONNECT_TIMEOUT_SECS: u64 = 30;
const PROGRESS_EMIT_EVERY: u64 = 512 * 1024;

#[derive(Debug)]
pub enum SecureDownloadError {
    Network(String),
    HostNotAllowed(String),
    HashMismatch { expected: String, got: String },
    Cancelled,
    Io(String),
    TooLarge { kind: &'static str, limit: u64 },
}

impl SecureDownloadError {
    pub fn to_user(&self) -> String {
        match self {
            Self::Network(m) => format!("Sin conexión o error de red: {m}"),
            Self::HostNotAllowed(h) => format!("Host no permitido: {h}"),
            Self::HashMismatch { expected, got } => {
                format!(
                    "El archivo descargado no coincide con el hash esperado (esperado {expected}, obtuvo {got})."
                )
            }
            Self::Cancelled => "Descarga cancelada.".into(),
            Self::Io(m) => format!("Error de disco: {m}"),
            Self::TooLarge { kind, limit } => {
                format!("{kind} supera el límite de {} bytes.", limit)
            }
        }
    }
}

fn host_allowed(url: &reqwest::Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    match url.host_str() {
        Some(host) => {
            // 1. Intentar match exacto con hosts estáticos
            if ALLOWED_HOSTS.contains(&host) {
                return true;
            }
            
            // 2. Intentar host R2 exacto configurado (recomendado en producción)
            if let Ok(r2_host) = env::var("BLAZE_R2_HOST") {
                if !r2_host.is_empty() && host == r2_host {
                    return true;
                }
            }
            
            // 3. Fallback: intentar patrones wildcard (solo si no hay host exacto configurado)
            // ADVERTENCIA: Aceptar cualquier cuenta R2 es menos seguro.
            // En producción, configurar BLAZE_R2_HOST con el host exacto (ej: "abc123.r2.cloudflarestorage.com")
            if env::var("BLAZE_R2_HOST").is_err() {
                for pattern in ALLOWED_HOST_PATTERNS_FALLBACK {
                    if matches_wildcard_pattern(host, pattern) {
                        return true;
                    }
                }
            }
            
            false
        }
        None => false,
    }
}

fn matches_wildcard_pattern(host: &str, pattern: &str) -> bool {
    if let Some(suffix) = pattern.strip_prefix("*.") {
        // Para match correcto con *.suffix:
        // 1. Host debe terminar en .suffix (no solo suffix)
        // 2. Debe haber al menos un carácter antes del punto
        if host == suffix {
            // "r2.cloudflarestorage.com" NO debe hacer match con "*.r2.cloudflarestorage.com"
            return false;
        }
        
        // Debe terminar con ".suffix" (con el punto incluido)
        let full_suffix = format!(".{}", suffix);
        host.ends_with(&full_suffix)
    } else {
        host == pattern
    }
}

fn validate_url(url_str: &str) -> Result<reqwest::Url, SecureDownloadError> {
    let url = reqwest::Url::parse(url_str)
        .map_err(|e| SecureDownloadError::Network(format!("URL inválida: {e}")))?;
    if !host_allowed(&url) {
        return Err(SecureDownloadError::HostNotAllowed(
            url.host_str().unwrap_or("?").to_string(),
        ));
    }
    Ok(url)
}

fn verify_sha256_hex(got: &str, expected: &str) -> Result<(), SecureDownloadError> {
    if got.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(SecureDownloadError::HashMismatch {
            expected: expected.to_string(),
            got: got.to_string(),
        })
    }
}

pub fn sha256_file(path: &Path) -> Result<String, SecureDownloadError> {
    let mut file = File::open(path).map_err(|e| SecureDownloadError::Io(e.to_string()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = std::io::Read::read(&mut file, &mut buf)
            .map_err(|e| SecureDownloadError::Io(e.to_string()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Descarga un archivo con verificación de hash SHA256, límites de tamaño y progreso.
/// Escribe primero a `dest_file.part` y luego renombra a `dest_file` tras verificar el hash.
pub async fn secure_download_file(
    app: Option<&AppHandle>,
    operation_id: &str,
    url: &str,
    sha256: &str,
    max_download_bytes: u64,
    dest_file: &Path,
    cancel: &AtomicBool,
) -> Result<String, SecureDownloadError> {
    validate_url(url)?;
    
    if let Some(parent) = dest_file.parent() {
        fs::create_dir_all(parent).map_err(|e| SecureDownloadError::Io(e.to_string()))?;
    }

    let part_file = dest_file.with_extension("part");
    
    // Si ya existe el archivo final con el hash correcto, no descargar de nuevo
    if dest_file.exists() {
        if let Ok(existing_hash) = sha256_file(dest_file) {
            if existing_hash.eq_ignore_ascii_case(sha256) {
                return Ok(existing_hash);
            }
        }
    }

    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 10 {
            return attempt.error("demasiadas redirecciones");
        }
        if !host_allowed(attempt.url()) {
            let host = attempt.url().host_str().unwrap_or("?").to_string();
            return attempt.error(format!("redirect a host no permitido: {host}"));
        }
        attempt.follow()
    });

    let client = reqwest::Client::builder()
        .redirect(redirect_policy)
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .build()
        .map_err(|e| SecureDownloadError::Network(e.to_string()))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| SecureDownloadError::Network(e.to_string()))?;

    if !response.status().is_success() {
        return Err(SecureDownloadError::Network(format!(
            "HTTP {}",
            response.status()
        )));
    }
    
    if !host_allowed(response.url()) {
        return Err(SecureDownloadError::HostNotAllowed(
            response
                .url()
                .host_str()
                .unwrap_or("?")
                .to_string(),
        ));
    }

    let content_len = response.content_length().unwrap_or(0);
    if content_len > max_download_bytes {
        return Err(SecureDownloadError::TooLarge {
            kind: "Descarga",
            limit: max_download_bytes,
        });
    }

    let mut file =
        File::create(&part_file).map_err(|e| SecureDownloadError::Io(e.to_string()))?;
    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();
    let mut done = 0u64;
    let total = content_len.max(1);

    emit_download_progress(app, operation_id, 0, total);

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            let _ = fs::remove_file(&part_file);
            return Err(SecureDownloadError::Cancelled);
        }
        
        let chunk = chunk.map_err(|e| SecureDownloadError::Network(e.to_string()))?;
        done += chunk.len() as u64;
        
        if done > max_download_bytes {
            let _ = fs::remove_file(&part_file);
            return Err(SecureDownloadError::TooLarge {
                kind: "Descarga",
                limit: max_download_bytes,
            });
        }
        
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|e| SecureDownloadError::Io(e.to_string()))?;
        
        if done % PROGRESS_EMIT_EVERY < chunk.len() as u64 || done == total {
            emit_download_progress(app, operation_id, done, total.max(done));
        }
    }
    
    file.flush().map_err(|e| SecureDownloadError::Io(e.to_string()))?;
    drop(file);

    let got = hex::encode(hasher.finalize());
    verify_sha256_hex(&got, sha256)?;

    // Renombrar .part al archivo final
    fs::rename(&part_file, dest_file).map_err(|e| SecureDownloadError::Io(e.to_string()))?;

    emit_download_progress(app, operation_id, done, total);

    Ok(got)
}

fn emit_download_progress(
    app: Option<&AppHandle>,
    operation_id: &str,
    bytes_done: u64,
    bytes_total: u64,
) {
    if let Some(app) = app {
        #[derive(Clone, serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct DownloadProgress {
            operation_id: String,
            bytes_done: u64,
            bytes_total: u64,
        }
        
        let _ = app.emit(
            "secure-download-progress",
            DownloadProgress {
                operation_id: operation_id.to_string(),
                bytes_done,
                bytes_total,
            },
        );
    }
}

/// Valida que una ruta esté dentro de un directorio permitido (anti path-traversal).
/// IMPORTANTE: Rechaza componentes ".." explícitamente para evitar bypass cuando canonicalize falla.
pub fn ensure_path_within(
    path: &Path,
    allowed_parent: &Path,
) -> Result<(), SecureDownloadError> {
    // 1. Rechazar componentes ".." explícitamente (ataque path traversal)
    for component in path.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(SecureDownloadError::Io(format!(
                "Ruta contiene '..' (path traversal): {}",
                path.display()
            )));
        }
    }
    
    // 2. Normalizar y validar que esté dentro del padre permitido
    let canonical_parent = allowed_parent
        .canonicalize()
        .unwrap_or_else(|_| allowed_parent.to_path_buf());
    
    // Si la ruta no existe, construir la ruta absoluta manualmente
    let absolute_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        canonical_parent.join(path)
    };
    
    let canonical_path = absolute_path
        .canonicalize()
        .unwrap_or_else(|_| absolute_path.clone());
    
    if !canonical_path.starts_with(&canonical_parent) {
        return Err(SecureDownloadError::Io(format!(
            "Ruta {} fuera del directorio permitido {}",
            path.display(),
            allowed_parent.display()
        )));
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_ensure_path_within_rejects_parent_dir() {
        let temp = std::env::temp_dir();
        
        // Intentar path traversal con ..
        let evil_path = PathBuf::from("catalog-games/../evil.exe");
        let result = ensure_path_within(&evil_path, &temp);
        assert!(
            result.is_err(),
            "Debe rechazar rutas con .. (path traversal)"
        );
        
        // Variantes
        let evil_path2 = PathBuf::from("subdir/../../evil.exe");
        assert!(
            ensure_path_within(&evil_path2, &temp).is_err(),
            "Debe rechazar múltiples .."
        );
        
        let evil_path3 = PathBuf::from("./../../evil.exe");
        assert!(
            ensure_path_within(&evil_path3, &temp).is_err(),
            "Debe rechazar . y .."
        );
    }

    #[test]
    fn test_ensure_path_within_allows_safe_paths() {
        let temp = std::env::temp_dir();
        
        let safe_path = PathBuf::from("catalog-games/game.iso");
        let result = ensure_path_within(&safe_path, &temp);
        assert!(
            result.is_ok(),
            "Debe permitir rutas seguras sin .."
        );
        
        let safe_path2 = PathBuf::from("subdir/file.bin");
        assert!(
            ensure_path_within(&safe_path2, &temp).is_ok(),
            "Debe permitir subdirectorios normales"
        );
    }

    #[test]
    fn test_host_matching_exact() {
        let url = reqwest::Url::parse("https://github.com/test").unwrap();
        assert!(host_allowed(&url), "github.com debe estar permitido");

        let url = reqwest::Url::parse("https://buildbot.libretro.com/test").unwrap();
        assert!(host_allowed(&url), "buildbot.libretro.com debe estar permitido");
    }

    #[test]
    fn test_host_matching_wildcard_r2_cloudflarestorage() {
        // URL presignada realista de R2
        let url = reqwest::Url::parse(
            "https://abc123.r2.cloudflarestorage.com/blaze-vendor/bios_ps2.7z?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=..."
        ).unwrap();
        assert!(
            host_allowed(&url),
            "*.r2.cloudflarestorage.com debe estar permitido (URLs presignadas)"
        );

        let url = reqwest::Url::parse("https://my-account.r2.cloudflarestorage.com/file.bin").unwrap();
        assert!(
            host_allowed(&url),
            "Cualquier subdomain.r2.cloudflarestorage.com debe estar permitido"
        );
    }

    #[test]
    fn test_host_not_allowed() {
        let url = reqwest::Url::parse("https://evil.com/malware.exe").unwrap();
        assert!(
            !host_allowed(&url),
            "evil.com NO debe estar permitido"
        );

        let url = reqwest::Url::parse("https://not-r2.cloudflarestorage.com/file").unwrap();
        assert!(
            !host_allowed(&url),
            "Dominios que no terminan en .r2.cloudflarestorage.com NO deben estar permitidos"
        );
    }

    #[test]
    fn test_http_not_allowed() {
        let url = reqwest::Url::parse("http://github.com/test").unwrap();
        assert!(
            !host_allowed(&url),
            "HTTP (no HTTPS) NO debe estar permitido"
        );
    }

    #[test]
    fn test_wildcard_pattern_matching() {
        assert!(
            matches_wildcard_pattern("abc123.r2.cloudflarestorage.com", "*.r2.cloudflarestorage.com"),
            "Subdomain wildcard debe funcionar"
        );

        assert!(
            matches_wildcard_pattern("pub-xyz.r2.dev", "*.r2.dev"),
            "Subdomain wildcard r2.dev debe funcionar"
        );

        assert!(
            !matches_wildcard_pattern("r2.cloudflarestorage.com", "*.r2.cloudflarestorage.com"),
            "Dominio sin subdomain NO debe hacer match con wildcard"
        );

        assert!(
            !matches_wildcard_pattern("evil-r2.cloudflarestorage.com.evil.com", "*.r2.cloudflarestorage.com"),
            "Dominio con suffix malicioso NO debe hacer match"
        );
    }

    #[test]
    fn test_validate_url_r2_presigned() {
        // URL presignada realista de R2
        let url_str = "https://abc123.r2.cloudflarestorage.com/blaze-vendor/switch_firmware.7z?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=abc/20261016/auto/s3/aws4_request&X-Amz-Date=20261016T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=abcdef123456";
        
        let result = validate_url(url_str);
        assert!(
            result.is_ok(),
            "URL presignada de R2 debe ser válida: {:?}",
            result.err()
        );
    }
    
    #[test]
    fn test_r2_exact_host_from_env() {
        // Simular host exacto configurado
        env::set_var("BLAZE_R2_HOST", "abc123.r2.cloudflarestorage.com");
        
        let url = reqwest::Url::parse("https://abc123.r2.cloudflarestorage.com/file.bin").unwrap();
        assert!(host_allowed(&url), "Host exacto configurado debe ser permitido");
        
        let url2 = reqwest::Url::parse("https://otro.r2.cloudflarestorage.com/file.bin").unwrap();
        assert!(!host_allowed(&url2), "Otras cuentas R2 NO deben ser permitidas cuando hay host exacto");
        
        env::remove_var("BLAZE_R2_HOST");
    }
    
    #[test]
    fn test_r2_fallback_when_not_configured() {
        // Sin BLAZE_R2_HOST configurado, el wildcard actúa como fallback
        env::remove_var("BLAZE_R2_HOST");
        
        let url = reqwest::Url::parse("https://cualquier.r2.cloudflarestorage.com/file.bin").unwrap();
        assert!(
            host_allowed(&url),
            "Con fallback, cualquier cuenta R2 es permitida (menos seguro)"
        );
    }
    
    #[test]
    fn test_r2_dev_blocked() {
        // *.r2.dev debe estar bloqueado (quitado de allowlist)
        env::remove_var("BLAZE_R2_HOST");
        
        let url = reqwest::Url::parse("https://cualquier.r2.dev/file.bin").unwrap();
        assert!(
            !host_allowed(&url),
            "*.r2.dev NO debe estar permitido"
        );
    }
}
