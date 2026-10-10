use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

/// Manifest dentro del zip Switch del catálogo (base + update/DLC).
pub const SWITCH_BUNDLE_MANIFEST: &str = "blaze-switch.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchBundleManifest {
    /// Nombre de archivo del NSP/XCI base (raíz del zip).
    pub base: String,
    /// Update / DLC a instalar en Eden tras la descarga.
    #[serde(default)]
    pub install: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchBundleExtract {
    pub primary_path: String,
    pub install_paths: Vec<String>,
    pub has_manifest: bool,
}

const PROGRESS_EMIT_EVERY: u64 = 512 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferProgress {
    transfer_id: String,
    direction: String,
    bytes_done: u64,
    bytes_total: u64,
    /// Offset del rango PUT (multipart paralelo).
    #[serde(skip_serializing_if = "Option::is_none")]
    range_offset: Option<u64>,
    /// Bytes enviados dentro de ese rango.
    #[serde(skip_serializing_if = "Option::is_none")]
    range_done: Option<u64>,
}

fn emit_progress(
    app: &AppHandle,
    transfer_id: &str,
    direction: &str,
    bytes_done: u64,
    bytes_total: u64,
) {
    let _ = app.emit(
        "catalog-transfer-progress",
        TransferProgress {
            transfer_id: transfer_id.to_string(),
            direction: direction.to_string(),
            bytes_done,
            bytes_total,
            range_offset: None,
            range_done: None,
        },
    );
}

fn emit_upload_range_progress(
    app: &AppHandle,
    transfer_id: &str,
    range_offset: u64,
    range_done: u64,
    bytes_total: u64,
) {
    let _ = app.emit(
        "catalog-transfer-progress",
        TransferProgress {
            transfer_id: transfer_id.to_string(),
            direction: "upload".to_string(),
            bytes_done: range_offset.saturating_add(range_done),
            bytes_total,
            range_offset: Some(range_offset),
            range_done: Some(range_done),
        },
    );
}

/// Lee como máximo `length` bytes y reporta progreso del rango (streaming PUT).
struct ProgressReader {
    inner: io::Take<File>,
    app: AppHandle,
    transfer_id: String,
    range_offset: u64,
    range_len: u64,
    read_so_far: u64,
    last_emit: u64,
    bytes_total: u64,
}

impl Read for ProgressReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        if n > 0 {
            self.read_so_far = (self.read_so_far + n as u64).min(self.range_len);
            if self.read_so_far - self.last_emit >= PROGRESS_EMIT_EVERY
                || self.read_so_far >= self.range_len
            {
                self.last_emit = self.read_so_far;
                emit_upload_range_progress(
                    &self.app,
                    &self.transfer_id,
                    self.range_offset,
                    self.read_so_far,
                    self.bytes_total,
                );
            }
        }
        Ok(n)
    }
}

#[tauri::command]
pub fn catalog_games_dir(app: AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo resolver app data: {e}"))?;
    let dir = base.join("catalog-games");
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear carpeta: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

/// Sube un rango del archivo a una URL firmada (PUT único o parte multipart).
/// Async + spawn_blocking para poder subir varias partes en paralelo.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn http_put_file_range(
    app: AppHandle,
    transfer_id: String,
    url: String,
    path: String,
    content_type: String,
    offset: u64,
    length: u64,
    bytes_done_base: u64,
    bytes_total: u64,
) -> Result<String, String> {
    let _ = bytes_done_base; // compat JS; el progreso usa `offset` como id de rango
    tokio::task::spawn_blocking(move || {
        put_file_range_blocking(
            app,
            transfer_id,
            url,
            path,
            content_type,
            offset,
            length,
            bytes_total,
        )
    })
    .await
    .map_err(|e| format!("Error interno al subir: {e}"))?
}

#[allow(clippy::too_many_arguments)]
fn put_file_range_blocking(
    app: AppHandle,
    transfer_id: String,
    url: String,
    path: String,
    content_type: String,
    offset: u64,
    length: u64,
    bytes_total: u64,
) -> Result<String, String> {
    let file_path = PathBuf::from(&path);
    if !file_path.is_file() {
        return Err("El archivo a subir no existe.".into());
    }
    let mut file = File::open(&file_path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;

    emit_upload_range_progress(&app, &transfer_id, offset, 0, bytes_total);

    let reader = ProgressReader {
        inner: file.take(length),
        app: app.clone(),
        transfer_id: transfer_id.clone(),
        range_offset: offset,
        range_len: length,
        read_so_far: 0,
        last_emit: 0,
        bytes_total,
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 60 * 6))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .put(&url)
        .header("Content-Type", &content_type)
        .header("Content-Length", length)
        .body(reqwest::blocking::Body::new(reader))
        .send()
        .map_err(|e| format!("Error de red al subir: {e}"))?;
    let status = response.status();
    let etag = response
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim_matches('"')
        .to_string();
    if !status.is_success() {
        let text = response.text().unwrap_or_default();
        return Err(format!("Subida falló ({status}): {text}"));
    }
    emit_upload_range_progress(&app, &transfer_id, offset, length, bytes_total);
    Ok(etag)
}

#[tauri::command]
pub async fn http_download_file(
    app: AppHandle,
    transfer_id: String,
    url: String,
    dest_path: String,
    bytes_total: u64,
) -> Result<(), String> {
    let dest = PathBuf::from(&dest_path);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("No se pudo crear carpeta destino: {e}"))?;
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 60 * 6))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Error de red al descargar: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Descarga falló ({})", response.status()));
    }

    let mut file = tokio::fs::File::create(&dest)
        .await
        .map_err(|e| format!("No se pudo crear archivo: {e}"))?;
    let mut stream = response.bytes_stream();
    let mut done = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Error leyendo descarga: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Error escribiendo archivo: {e}"))?;
        done += chunk.len() as u64;
        emit_progress(&app, &transfer_id, "download", done, bytes_total.max(done));
    }
    file.flush()
        .await
        .map_err(|e| format!("Error al cerrar archivo: {e}"))?;
    emit_progress(&app, &transfer_id, "download", done, bytes_total.max(done));
    Ok(())
}

#[tauri::command]
pub fn path_file_size(path: String) -> Result<u64, String> {
    let meta = std::fs::metadata(Path::new(&path)).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("La ruta no es un archivo.".into());
    }
    Ok(meta.len())
}

#[tauri::command]
pub fn join_path(base: String, child: String) -> Result<String, String> {
    let safe = child.replace(['/', '\\'], "_");
    Ok(PathBuf::from(base).join(safe).to_string_lossy().to_string())
}

/// Extrae nombres de `FILE "..."` / `FILE name` de un .cue.
fn cue_referenced_files(cue_text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in cue_text.lines() {
        let trimmed = line.trim();
        if !trimmed.to_ascii_uppercase().starts_with("FILE ") {
            continue;
        }
        let rest = trimmed[5..].trim();
        let name = if let Some(stripped) = rest.strip_prefix('"') {
            stripped.find('"').map(|end| stripped[..end].to_string())
        } else {
            rest.split_whitespace().next().map(|s| s.to_string())
        };
        if let Some(n) = name {
            let n = n.trim();
            if !n.is_empty() {
                out.push(n.to_string());
            }
        }
    }
    out
}

/// Empaqueta un .cue + sus .bin/.img referenciados en un zip (sin recomprimir bins).
#[tauri::command]
pub fn pack_cue_bundle(cue_path: String, dest_zip: String) -> Result<String, String> {
    let cue = PathBuf::from(&cue_path);
    if !cue.is_file() {
        return Err("El archivo .cue no existe.".into());
    }
    let cue_dir = cue
        .parent()
        .ok_or_else(|| "No se pudo resolver la carpeta del .cue.".to_string())?;
    let cue_text =
        std::fs::read_to_string(&cue).map_err(|e| format!("No se pudo leer el .cue: {e}"))?;
    let refs = cue_referenced_files(&cue_text);
    if refs.is_empty() {
        return Err(
            "El .cue no referencia ningún archivo (FILE). ¿Está completo?".into(),
        );
    }

    let mut missing: Vec<String> = Vec::new();
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    let cue_name = cue
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("game.cue")
        .to_string();
    files.push((cue_name, cue.clone()));
    for name in refs {
        let path = cue_dir.join(&name);
        if !path.is_file() {
            missing.push(name);
            continue;
        }
        let entry_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(name.as_str())
            .to_string();
        files.push((entry_name, path));
    }
    if !missing.is_empty() {
        return Err(format!(
            "Faltan archivos referenciados por el .cue: {}",
            missing.join(", ")
        ));
    }

    if let Some(parent) = Path::new(&dest_zip).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("No se pudo crear carpeta del zip: {e}"))?;
    }
    let zip_file = File::create(&dest_zip)
        .map_err(|e| format!("No se pudo crear el zip: {e}"))?;
    let mut zip = zip::ZipWriter::new(zip_file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);

    for (entry_name, path) in files {
        zip.start_file(&entry_name, options)
            .map_err(|e| format!("No se pudo agregar {entry_name} al zip: {e}"))?;
        let mut src =
            File::open(&path).map_err(|e| format!("No se pudo abrir {entry_name}: {e}"))?;
        std::io::copy(&mut src, &mut zip)
            .map_err(|e| format!("Error empaquetando {entry_name}: {e}"))?;
    }
    zip.finish()
        .map_err(|e| format!("No se pudo cerrar el zip: {e}"))?;
    Ok(dest_zip)
}

/// Otros `.nsp`/`.xci` en la misma carpeta que la base (update/DLC típicos).
#[tauri::command]
pub fn list_switch_extras(base_path: String) -> Result<Vec<String>, String> {
    let base = PathBuf::from(&base_path);
    if !base.is_file() {
        return Err("El archivo base no existe.".into());
    }
    let dir = base
        .parent()
        .ok_or_else(|| "No se pudo resolver la carpeta del juego.".to_string())?;
    let base_name = base.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let mut out = Vec::new();
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if name.eq_ignore_ascii_case(base_name) {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext != "nsp" && ext != "xci" {
            continue;
        }
        out.push(path.to_string_lossy().to_string());
    }
    out.sort_by(|a, b| {
        let score = |p: &str| {
            let n = p.to_ascii_lowercase();
            if n.contains("[upd]") || n.contains("update") {
                0
            } else if n.contains("dlc") || n.contains("booster") {
                1
            } else {
                2
            }
        };
        score(a).cmp(&score(b)).then_with(|| a.cmp(b))
    });
    Ok(out)
}

/// Empaqueta base Switch + update/DLC + `blaze-switch.json` para el catálogo.
/// Async + progreso: los NSP son multi-GB y un comando sync congela la UI.
#[tauri::command]
pub async fn pack_switch_bundle(
    app: AppHandle,
    transfer_id: String,
    base_path: String,
    extra_paths: Vec<String>,
    dest_zip: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            pack_switch_bundle_blocking(&app, &transfer_id, &base_path, &extra_paths, &dest_zip)
        })) {
            Ok(result) => result,
            Err(_) => Err(
                "Falló el empaquetado (archivo demasiado grande o zip inválido). Probá de nuevo."
                    .into(),
            ),
        }
    })
    .await
    .map_err(|e| format!("Empaquetado interrumpido: {e}"))?
}

fn pack_switch_bundle_blocking(
    app: &AppHandle,
    transfer_id: &str,
    base_path: &str,
    extra_paths: &[String],
    dest_zip: &str,
) -> Result<String, String> {
    let base = PathBuf::from(base_path);
    if !base.is_file() {
        return Err("El archivo base (.nsp/.xci) no existe.".into());
    }
    let base_name = base
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Nombre de base inválido.".to_string())?
        .to_string();

    let mut files: Vec<(String, PathBuf)> = vec![(base_name.clone(), base)];
    let mut install_names: Vec<String> = Vec::new();
    for raw in extra_paths {
        let path = PathBuf::from(raw);
        if !path.is_file() {
            return Err(format!("No existe el extra: {raw}"));
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| format!("Nombre inválido: {raw}"))?
            .to_string();
        if name.eq_ignore_ascii_case(&base_name) {
            continue;
        }
        if install_names.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
            continue;
        }
        install_names.push(name.clone());
        files.push((name, path));
    }

    let mut bytes_total: u64 = 0;
    for (_, path) in &files {
        bytes_total = bytes_total.saturating_add(
            std::fs::metadata(path)
                .map(|m| m.len())
                .unwrap_or(0),
        );
    }

    let manifest = SwitchBundleManifest {
        base: base_name,
        install: install_names,
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("No se pudo serializar blaze-switch.json: {e}"))?;

    if let Some(parent) = Path::new(dest_zip).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("No se pudo crear carpeta del zip: {e}"))?;
    }
    // Evitar zip a medias de un intento anterior.
    let _ = std::fs::remove_file(dest_zip);

    let zip_file = File::create(dest_zip)
        .map_err(|e| format!("No se pudo crear el zip: {e}"))?;
    let mut zip = zip::ZipWriter::new(zip_file);

    // Manifest chico: sin Zip64.
    let manifest_opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);
    zip.start_file(SWITCH_BUNDLE_MANIFEST, manifest_opts)
        .map_err(|e| format!("No se pudo agregar manifest: {e}"))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| format!("No se pudo escribir manifest: {e}"))?;

    emit_progress(app, transfer_id, "pack", 0, bytes_total);

    let mut bytes_done: u64 = 0;
    let mut last_emit: u64 = 0;
    let mut buf = vec![0u8; 1024 * 1024];

    // NSP de Switch suelen superar 4 GiB → Zip64 obligatorio (si no, panic en zip crate).
    const ZIP64_THRESHOLD: u64 = 0xFFFF_FFFF;
    let archive_needs_zip64 = bytes_total >= ZIP64_THRESHOLD;

    for (entry_name, path) in files {
        let file_len = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored)
            .large_file(archive_needs_zip64 || file_len >= ZIP64_THRESHOLD);
        zip.start_file(&entry_name, opts)
            .map_err(|e| format!("No se pudo agregar {entry_name} al zip: {e}"))?;
        let mut src =
            File::open(&path).map_err(|e| format!("No se pudo abrir {entry_name}: {e}"))?;
        loop {
            let n = src
                .read(&mut buf)
                .map_err(|e| format!("Error leyendo {entry_name}: {e}"))?;
            if n == 0 {
                break;
            }
            zip.write_all(&buf[..n])
                .map_err(|e| format!("Error empaquetando {entry_name}: {e}"))?;
            bytes_done = bytes_done.saturating_add(n as u64);
            if bytes_done - last_emit >= PROGRESS_EMIT_EVERY || bytes_done >= bytes_total {
                last_emit = bytes_done;
                emit_progress(app, transfer_id, "pack", bytes_done, bytes_total);
            }
        }
    }
    zip.finish()
        .map_err(|e| format!("No se pudo cerrar el zip: {e}"))?;
    emit_progress(app, transfer_id, "pack", bytes_total, bytes_total);
    Ok(dest_zip.to_string())
}

fn extract_zip_flat(zip_path: &Path, dest: &Path) -> Result<Vec<PathBuf>, String> {
    let file = File::open(zip_path).map_err(|e| format!("No se pudo abrir el zip: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Zip inválido: {e}"))?;

    let mut extracted: Vec<PathBuf> = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Error leyendo entrada del zip: {e}"))?;
        let name = entry
            .enclosed_name()
            .ok_or_else(|| "Entrada de zip insegura.".to_string())?
            .to_path_buf();
        let file_name = name
            .file_name()
            .ok_or_else(|| "Nombre de archivo inválido en el zip.".to_string())?
            .to_owned();
        let out_path = dest.join(&file_name);
        if entry.is_dir() {
            continue;
        }
        let mut out = File::create(&out_path)
            .map_err(|e| format!("No se pudo crear {}: {e}", out_path.display()))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("Error extrayendo {}: {e}", out_path.display()))?;
        extracted.push(out_path);
    }
    if extracted.is_empty() {
        return Err("El zip no contenía archivos.".into());
    }
    Ok(extracted)
}

/// Descomprime un zip de catálogo. Devuelve la ruta al .cue / base Switch / primer archivo.
#[tauri::command]
pub fn extract_zip_archive(zip_path: String, dest_dir: String) -> Result<String, String> {
    let detail = extract_catalog_zip(zip_path, dest_dir)?;
    Ok(detail.primary_path)
}

/// Como `extract_zip_archive`, pero también lista update/DLC del manifest Switch.
#[tauri::command]
pub fn extract_catalog_zip(zip_path: String, dest_dir: String) -> Result<SwitchBundleExtract, String> {
    let zip_path = PathBuf::from(&zip_path);
    if !zip_path.is_file() {
        return Err("El archivo zip no existe.".into());
    }
    let dest = PathBuf::from(&dest_dir);
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("No se pudo crear carpeta destino: {e}"))?;

    let extracted = extract_zip_flat(&zip_path, &dest)?;

    let manifest_path = dest.join(SWITCH_BUNDLE_MANIFEST);
    if manifest_path.is_file() {
        let text = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("No se pudo leer blaze-switch.json: {e}"))?;
        let manifest: SwitchBundleManifest = serde_json::from_str(&text)
            .map_err(|e| format!("blaze-switch.json inválido: {e}"))?;
        let primary = dest.join(&manifest.base);
        if !primary.is_file() {
            return Err(format!(
                "El zip Switch no contiene la base '{}'.",
                manifest.base
            ));
        }
        let install_paths = manifest
            .install
            .iter()
            .map(|n| dest.join(n))
            .filter(|p| p.is_file())
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        return Ok(SwitchBundleExtract {
            primary_path: primary.to_string_lossy().to_string(),
            install_paths,
            has_manifest: true,
        });
    }

    let cue = extracted.iter().find(|p| {
        p.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("cue"))
            .unwrap_or(false)
    });
    let primary = cue.unwrap_or(&extracted[0]);
    Ok(SwitchBundleExtract {
        primary_path: primary.to_string_lossy().to_string(),
        install_paths: vec![],
        has_manifest: false,
    })
}

#[tauri::command]
pub fn remove_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok(());
    }
    if p.is_file() {
        std::fs::remove_file(&p).map_err(|e| format!("No se pudo borrar archivo: {e}"))?;
    } else if p.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| format!("No se pudo borrar carpeta: {e}"))?;
    }
    Ok(())
}
