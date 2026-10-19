//! Descarga e instalación de vendor assets (BIOS, keys, firmware) desde el backend.
//! Reutiliza la lógica segura de secure_download.rs.
//!
//! Contrato del backend: Blaze-back PR #1, rama cursor/vendor-assets-b423
//! GET /api/vendor/manifest → { items: [...] }
//! Cada item: { kind, downloadUrl, fileSizeBytes, fileName, sha256, expiresAt? }

use crate::emulator_data::{
    eden_firmware_registered_dir, eden_keys_dir, managed_data_root, pcsx2_bios_directory,
    pcsx2_internal_data_root, sanitize_bios_file_name, seed_pcsx2_ini_if_missing,
};
use crate::secure_download::{ensure_path_within, secure_download_file, SecureDownloadError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VendorAssetKind {
    #[serde(rename = "pcsx2-bios")]
    Pcsx2Bios,
    #[serde(rename = "retroarch-ps1-bios")]
    RetroarchPs1Bios,
    #[serde(rename = "eden-keys")]
    EdenKeys,
    #[serde(rename = "eden-firmware")]
    EdenFirmware,
    #[serde(rename = "other")]
    Other,
}

#[derive(Debug)]
pub enum VendorDownloadError {
    Download(SecureDownloadError),
    Extract(String),
    Io(String),
}

impl VendorDownloadError {
    pub fn to_user(&self) -> String {
        match self {
            Self::Download(e) => e.to_user(),
            Self::Extract(m) => format!("Error al extraer: {m}"),
            Self::Io(m) => format!("Error de disco: {m}"),
        }
    }
}

impl From<SecureDownloadError> for VendorDownloadError {
    fn from(e: SecureDownloadError) -> Self {
        Self::Download(e)
    }
}

/// Límite de descarga para vendor assets: 500 MB por archivo
/// (alineado con el límite del backend)
const MAX_VENDOR_ASSET_SIZE: u64 = 500 * 1024 * 1024;

/// Obtiene la carpeta de vendor assets temporales
fn vendor_temp_dir(app: &AppHandle) -> Result<PathBuf, VendorDownloadError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| VendorDownloadError::Io(e.to_string()))?;
    let dir = base.join("vendor-temp");
    fs::create_dir_all(&dir).map_err(|e| VendorDownloadError::Io(e.to_string()))?;
    Ok(dir)
}

/// Rutas managed (sin crear carpetas). PCSX2 usa `…/pcsx2/PCSX2/bios` (subdir
/// interno de `-datapath`), alineado con `pcsx2_managed_bios_present`.
fn destination_path_for_kind(app_data: &Path, kind: &VendorAssetKind) -> PathBuf {
    match kind {
        VendorAssetKind::Pcsx2Bios => {
            let datapath = managed_data_root(app_data, "pcsx2");
            pcsx2_bios_directory(&pcsx2_internal_data_root(&datapath))
        }
        VendorAssetKind::RetroarchPs1Bios => {
            managed_data_root(app_data, "retroarch").join("system")
        }
        VendorAssetKind::EdenKeys => eden_keys_dir(&managed_data_root(app_data, "eden")),
        VendorAssetKind::EdenFirmware => {
            eden_firmware_registered_dir(&managed_data_root(app_data, "eden"))
        }
        VendorAssetKind::Other => app_data.join("vendor-temp"),
    }
}

/// Carpetas finales para cada tipo de asset (AppData managed).
fn destination_dir_for_kind(
    app: &AppHandle,
    kind: &VendorAssetKind,
) -> Result<PathBuf, VendorDownloadError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| VendorDownloadError::Io(e.to_string()))?;

    let dir = destination_path_for_kind(&app_data, kind);
    fs::create_dir_all(&dir).map_err(|e| VendorDownloadError::Io(e.to_string()))?;
    Ok(dir)
}

/// Detecta el formato de archivo por fileName o por el path de la URL (sin query)
fn detect_archive_format(url: &str, file_name: &str) -> Option<&'static str> {
    // Primero intentar por fileName
    if file_name.ends_with(".7z") {
        return Some("7z");
    }
    if file_name.ends_with(".zip") {
        return Some("zip");
    }
    
    // Fallback: intentar por URL sin query string
    let url_without_query = url.split('?').next().unwrap_or(url);
    
    if url_without_query.ends_with(".7z") {
        return Some("7z");
    }
    if url_without_query.ends_with(".zip") {
        return Some("zip");
    }
    
    None // Archivo simple
}

/// Descarga e instala un vendor asset
pub async fn download_vendor_asset(
    app: AppHandle,
    operation_id: String,
    asset_kind: VendorAssetKind,
    url: String,
    file_name: String,
    sha256: String,
    size_bytes: String,
) -> Result<(), VendorDownloadError> {
    // Validar fileName (evitar path traversal, C:foo en Windows, etc)
    let safe_file_name = sanitize_bios_file_name(&file_name)
        .ok_or_else(|| VendorDownloadError::Io(format!("Nombre de archivo inválido: {}", file_name)))?;
    
    let size: u64 = size_bytes
        .parse()
        .map_err(|_| VendorDownloadError::Io("Tamaño inválido".into()))?;
    
    if size > MAX_VENDOR_ASSET_SIZE {
        return Err(VendorDownloadError::Download(SecureDownloadError::TooLarge {
            kind: "Asset vendor",
            limit: MAX_VENDOR_ASSET_SIZE,
        }));
    }

    let temp_dir = vendor_temp_dir(&app)?;
    let temp_file = temp_dir.join(format!("{}.tmp", operation_id));
    
    let cancel = Arc::new(AtomicBool::new(false));
    
    // Descargar con verificación SHA256
    secure_download_file(
        Some(&app),
        &operation_id,
        &url,
        &sha256,
        MAX_VENDOR_ASSET_SIZE,
        &temp_file,
        &cancel,
    )
    .await?;

    // Determinar destino según el tipo de asset
    let dest_dir = destination_dir_for_kind(&app, &asset_kind)?;
    
    // Validar que el destino esté dentro de AppData de Blaze
    ensure_path_within(&dest_dir, &app.path().app_data_dir().unwrap_or_default())?;

    // Detectar formato por safe_file_name (ya validado) o URL
    let archive_format = detect_archive_format(&url, &safe_file_name);

    if let Some(format) = archive_format {
        // Extraer archivo comprimido
        extract_vendor_archive(&temp_file, &dest_dir, format)?;
    } else {
        // Copiar archivo directamente con su nombre real (ya validado)
        let dest_file = dest_dir.join(&safe_file_name);
        fs::copy(&temp_file, &dest_file)
            .map_err(|e| VendorDownloadError::Io(e.to_string()))?;
    }

    // Limpiar archivo temporal
    let _ = fs::remove_file(&temp_file);

    // Keys: si el 7z traía subcarpetas y quedó prod.keys anidado, subiéndolo a dest.
    if matches!(asset_kind, VendorAssetKind::EdenKeys) {
        promote_prod_keys_if_nested(&dest_dir)?;
        let prod = dest_dir.join("prod.keys");
        if !prod.is_file() {
            return Err(VendorDownloadError::Io(
                "Tras instalar keys no se encontró prod.keys en emulator-data/eden/keys"
                    .into(),
            ));
        }
    }

    // Tras instalar BIOS PS2: sembrar/parchear PCSX2.ini (SettingsVersion) para
    // no mostrar el setup wizard en el primer juego.
    if matches!(asset_kind, VendorAssetKind::Pcsx2Bios) {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|e| VendorDownloadError::Io(e.to_string()))?;
        let data_root =
            pcsx2_internal_data_root(&managed_data_root(&app_data, "pcsx2"));
        seed_pcsx2_ini_if_missing(&data_root).map_err(|e| {
            VendorDownloadError::Io(format!("Error preparando PCSX2.ini: {e:?}"))
        })?;
    }

    Ok(())
}

fn move_file_to(src: &Path, dest: &Path) -> Result<(), VendorDownloadError> {
    if let Err(e) = fs::rename(src, dest) {
        fs::copy(src, dest).map_err(|e2| {
            VendorDownloadError::Io(format!("rename {e}; copy {e2}"))
        })?;
        let _ = fs::remove_file(src);
    }
    Ok(())
}

/// Si `prod.keys` quedó en un subdirectorio del extract, lo mueve a la raíz de keys.
fn promote_prod_keys_if_nested(keys_dir: &Path) -> Result<(), VendorDownloadError> {
    let direct = keys_dir.join("prod.keys");
    if !direct.is_file() {
        if let Some(src) = find_named_file_recursive(keys_dir, "prod.keys", 4)? {
            move_file_to(&src, &direct)?;
        }
    }
    let title_direct = keys_dir.join("title.keys");
    if !title_direct.is_file() {
        if let Some(src) = find_named_file_recursive(keys_dir, "title.keys", 4)? {
            let _ = move_file_to(&src, &title_direct);
        }
    }
    Ok(())
}

fn find_named_file_recursive(
    root: &Path,
    name: &str,
    max_depth: u32,
) -> Result<Option<PathBuf>, VendorDownloadError> {
    fn walk(
        dir: &Path,
        name: &str,
        depth: u32,
        max_depth: u32,
    ) -> Result<Option<PathBuf>, VendorDownloadError> {
        if depth > max_depth {
            return Ok(None);
        }
        let entries = fs::read_dir(dir).map_err(|e| VendorDownloadError::Io(e.to_string()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file()
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.eq_ignore_ascii_case(name))
                    .unwrap_or(false)
            {
                return Ok(Some(path));
            }
            if path.is_dir() {
                if let Some(found) = walk(&path, name, depth + 1, max_depth)? {
                    return Ok(Some(found));
                }
            }
        }
        Ok(None)
    }
    walk(root, name, 0, max_depth)
}

/// Extrae un archivo vendor (7z o zip) al directorio destino
fn extract_vendor_archive(
    archive: &Path,
    dest: &Path,
    kind: &str,
) -> Result<(), VendorDownloadError> {
    if kind == "7z" {
        extract_7z_flat(archive, dest)?;
    } else if kind == "zip" {
        extract_zip_flat(archive, dest)?;
    }
    Ok(())
}

/// Extrae un 7z al directorio destino (archivos planos, sin subdirectorios)
fn extract_7z_flat(archive: &Path, dest: &Path) -> Result<(), VendorDownloadError> {
    use sevenz_rust2::decompress_file_with_extract_fn;
    use std::borrow::Cow;
    use std::fs::File;
    use std::io::Write;

    decompress_file_with_extract_fn(archive, dest, |entry, reader, _out| {
        if entry.is_directory() {
            return Ok(true);
        }

        let name = entry.name();
        if name.is_empty() || name.contains('\0') || name.contains("..") {
            return Ok(true); // Skip
        }

        // Extraer solo el nombre del archivo (sin path)
        let file_name = PathBuf::from(name.replace('\\', "/"))
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        if file_name.is_empty() {
            return Ok(true);
        }

        let out_path = dest.join(&file_name);
        let mut out_file = File::create(&out_path).map_err(sevenz_rust2::Error::from)?;
        
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = std::io::Read::read(reader, &mut buf).map_err(sevenz_rust2::Error::from)?;
            if n == 0 {
                break;
            }
            out_file.write_all(&buf[..n]).map_err(sevenz_rust2::Error::from)?;
        }
        
        Ok(true)
    })
    .map_err(|e| VendorDownloadError::Extract(e.to_string()))?;

    Ok(())
}

/// Extrae un zip al directorio destino (archivos planos)
fn extract_zip_flat(archive: &Path, dest: &Path) -> Result<(), VendorDownloadError> {
    use std::fs::File;
    use zip::ZipArchive;

    let file = File::open(archive)
        .map_err(|e| VendorDownloadError::Extract(e.to_string()))?;
    let mut zip = ZipArchive::new(file)
        .map_err(|e| VendorDownloadError::Extract(e.to_string()))?;

    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| VendorDownloadError::Extract(e.to_string()))?;
        
        if entry.is_dir() {
            continue;
        }

        let name = entry
            .enclosed_name()
            .ok_or_else(|| VendorDownloadError::Extract("Entrada insegura".into()))?;
        
        let file_name = name
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| VendorDownloadError::Extract("Nombre inválido".into()))?
            .to_string();

        if file_name.is_empty() || file_name.contains("..") {
            continue;
        }

        let out_path = dest.join(&file_name);
        let mut out_file = File::create(&out_path)
            .map_err(|e| VendorDownloadError::Extract(e.to_string()))?;
        
        std::io::copy(&mut entry, &mut out_file)
            .map_err(|e| VendorDownloadError::Extract(e.to_string()))?;
    }

    Ok(())
}

/// Comando Tauri para descargar un vendor asset
#[tauri::command]
pub async fn download_vendor_asset_command(
    app: AppHandle,
    operation_id: String,
    asset_kind: VendorAssetKind,
    url: String,
    file_name: String,
    sha256: String,
    size_bytes: String,
) -> Result<(), String> {
    download_vendor_asset(app, operation_id, asset_kind, url, file_name, sha256, size_bytes)
        .await
        .map_err(|e| e.to_user())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcsx2_bios_dest_uses_internal_pcsx2_subdir() {
        let app = PathBuf::from(r"C:\Users\x\AppData\Roaming\com.blaze.app");
        let dest = destination_path_for_kind(&app, &VendorAssetKind::Pcsx2Bios);
        assert_eq!(
            dest,
            app.join("emulator-data")
                .join("pcsx2")
                .join("PCSX2")
                .join("bios")
        );
    }

    #[test]
    fn eden_and_retroarch_dest_match_emulator_data_helpers() {
        let app = PathBuf::from(r"C:\Users\x\AppData\Roaming\com.blaze.app");
        assert_eq!(
            destination_path_for_kind(&app, &VendorAssetKind::RetroarchPs1Bios),
            managed_data_root(&app, "retroarch").join("system")
        );
        assert_eq!(
            destination_path_for_kind(&app, &VendorAssetKind::EdenKeys),
            eden_keys_dir(&managed_data_root(&app, "eden"))
        );
        assert_eq!(
            destination_path_for_kind(&app, &VendorAssetKind::EdenFirmware),
            eden_firmware_registered_dir(&managed_data_root(&app, "eden"))
        );
    }
}
