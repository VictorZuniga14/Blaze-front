//! Lógica de descarga segura compartida entre runtime_install y vendor assets.
//! Reutiliza allowlist de hosts, validación de URLs, verificación de hash, límites, etc.

use futures_util::StreamExt;
use reqwest;
use sha2::{Digest, Sha256};
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
        Some(host) => ALLOWED_HOSTS.contains(&host),
        None => false,
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
pub fn ensure_path_within(
    path: &Path,
    allowed_parent: &Path,
) -> Result<(), SecureDownloadError> {
    let canonical_parent = allowed_parent
        .canonicalize()
        .unwrap_or_else(|_| allowed_parent.to_path_buf());
    
    let canonical_path = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf());
    
    if !canonical_path.starts_with(&canonical_parent) {
        return Err(SecureDownloadError::Io(format!(
            "Ruta {} fuera del directorio permitido {}",
            path.display(),
            allowed_parent.display()
        )));
    }
    
    Ok(())
}
