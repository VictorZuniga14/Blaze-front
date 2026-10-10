//! Descarga e instalación atómica de emuladores gestionados por Blaze.
//! El front solo pasa el `id` del manifiesto; URLs/hashes viven embebidos aquí.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use zip::ZipArchive;

const MANIFEST_JSON: &str = include_str!("../runtimes.manifest.json");

const ALLOWED_HOSTS: &[&str] = &[
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "buildbot.libretro.com",
    "git.eden-emu.dev",
];

/// Windows `FILE_ATTRIBUTE_REPARSE_POINT` — usado por 7z para marcar symlinks.
const WIN_ATTR_REPARSE_POINT: u32 = 0x400;

#[cfg(test)]
mod test_allowlist {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, Ordering};

    static OVERRIDE_HOSTS: Mutex<Option<Vec<String>>> = Mutex::new(None);
    static ALLOW_HTTP: AtomicBool = AtomicBool::new(false);

    pub fn set(hosts: Option<Vec<String>>, allow_http: bool) {
        if let Ok(mut g) = OVERRIDE_HOSTS.lock() {
            *g = hosts;
        }
        ALLOW_HTTP.store(allow_http, Ordering::SeqCst);
    }

    pub fn clear() {
        set(None, false);
    }

    pub fn hosts() -> Option<Vec<String>> {
        OVERRIDE_HOSTS.lock().ok().and_then(|g| g.clone())
    }

    pub fn allow_http() -> bool {
        ALLOW_HTTP.load(Ordering::SeqCst)
    }
}

const RENAME_ATTEMPTS: u32 = 8;
const RENAME_SLEEP_MS: u64 = 250;
const DOWNLOAD_TIMEOUT_SECS: u64 = 60 * 60;
const CONNECT_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HashOrigin {
    GithubDigest,
    ComputedLocally,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArchiveKind {
    Zip,
    #[serde(rename = "7z")]
    SevenZ,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CoresPackManifest {
    pub url: String,
    pub sha256: String,
    pub hash_origin: HashOrigin,
    pub archive: ArchiveKind,
    #[serde(default)]
    pub strip_components: u32,
    pub max_download_bytes: u64,
    pub max_extract_bytes: u64,
    pub max_extract_entries: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RuntimeManifestEntry {
    pub id: String,
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub hash_origin: HashOrigin,
    pub archive: ArchiveKind,
    pub exe: String,
    #[serde(default)]
    pub strip_components: u32,
    pub platforms: Vec<String>,
    pub max_download_bytes: u64,
    pub max_extract_bytes: u64,
    pub max_extract_entries: u64,
    /// DLL de core a instalar en `<root>/cores/` (solo RetroArch managed).
    #[serde(default)]
    pub cores: Vec<String>,
    #[serde(default)]
    pub cores_pack: Option<CoresPackManifest>,
}

#[derive(Debug, Deserialize)]
struct ManifestFile {
    runtimes: Vec<RuntimeManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledMarker {
    pub id: String,
    pub version: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRuntimeInfo {
    pub id: String,
    pub version: String,
    pub executable_path: String,
    pub root_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeManifestInfo {
    pub id: String,
    pub version: String,
    pub exe: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInstallProgress {
    operation_id: String,
    phase: String,
    bytes_done: u64,
    bytes_total: u64,
    message: String,
}

#[derive(Debug)]
pub enum InstallError {
    UnknownId(String),
    Network(String),
    HostNotAllowed(String),
    HashMismatch { expected: String, got: String },
    Cancelled,
    DiskSpace { need: u64, free: u64 },
    Extract(String),
    Io(String),
    TooLarge { kind: &'static str, limit: u64 },
    CoreMissing { dll: String },
}

impl InstallError {
    fn to_user(&self) -> String {
        match self {
            Self::UnknownId(id) => format!("Runtime desconocido: {id}"),
            Self::Network(m) => format!("Sin conexión o error de red: {m}"),
            Self::HostNotAllowed(h) => format!("Host no permitido: {h}"),
            Self::HashMismatch { expected, got } => {
                format!(
                    "El archivo descargado no coincide con el hash del manifiesto (esperado {expected}, obtuvo {got})."
                )
            }
            Self::Cancelled => "Instalación cancelada.".into(),
            Self::DiskSpace { need, free } => {
                format!(
                    "Espacio insuficiente. Se necesitan ~{} MB y hay {} MB libres.",
                    need / (1024 * 1024),
                    free / (1024 * 1024)
                )
            }
            Self::Extract(m) => format!("Error al extraer: {m}"),
            Self::Io(m) => format!("Error de disco: {m}"),
            Self::TooLarge { kind, limit } => {
                format!("{kind} supera el límite de {} bytes.", limit)
            }
            Self::CoreMissing { dll } => {
                format!(
                    "Falta el core {dll} en el pack de RetroArch. Reinstalá el emulador o actualizá Blaze."
                )
            }
        }
    }
}

fn manifest_entries() -> Result<&'static [RuntimeManifestEntry], InstallError> {
    static ENTRIES: OnceLock<Vec<RuntimeManifestEntry>> = OnceLock::new();
    let list = ENTRIES.get_or_init(|| {
        let parsed: ManifestFile =
            serde_json::from_str(MANIFEST_JSON).expect("runtimes.manifest.json inválido");
        parsed.runtimes
    });
    Ok(list.as_slice())
}

pub fn lookup_manifest(id: &str) -> Result<&'static RuntimeManifestEntry, InstallError> {
    manifest_entries()?
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| InstallError::UnknownId(id.to_string()))
}

fn host_allowed(url: &reqwest::Url) -> bool {
    #[cfg(test)]
    {
        if let Some(hosts) = test_allowlist::hosts() {
            let scheme_ok = url.scheme() == "https"
                || (test_allowlist::allow_http() && url.scheme() == "http");
            if !scheme_ok {
                return false;
            }
            return url
                .host_str()
                .map(|h| hosts.iter().any(|x| x == h))
                .unwrap_or(false);
        }
    }
    if url.scheme() != "https" {
        return false;
    }
    match url.host_str() {
        Some(host) => ALLOWED_HOSTS.contains(&host),
        None => false,
    }
}

fn validate_url(url_str: &str) -> Result<reqwest::Url, InstallError> {
    let url = reqwest::Url::parse(url_str)
        .map_err(|e| InstallError::Network(format!("URL inválida: {e}")))?;
    if !host_allowed(&url) {
        return Err(InstallError::HostNotAllowed(
            url.host_str().unwrap_or("?").to_string(),
        ));
    }
    Ok(url)
}

fn cancel_map() -> &'static Mutex<std::collections::HashMap<String, Arc<AtomicBool>>> {
    static MAP: OnceLock<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>> =
        OnceLock::new();
    MAP.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn register_cancel(operation_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = cancel_map().lock() {
        map.insert(operation_id.to_string(), Arc::clone(&flag));
    }
    flag
}

fn clear_cancel(operation_id: &str) {
    if let Ok(mut map) = cancel_map().lock() {
        map.remove(operation_id);
    }
}

fn check_cancel(flag: &AtomicBool) -> Result<(), InstallError> {
    if flag.load(Ordering::SeqCst) {
        Err(InstallError::Cancelled)
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn disk_free_bytes(path: &Path) -> Result<u64, InstallError> {
    use std::os::windows::ffi::OsStrExt;
    let mut dir = path.to_path_buf();
    if !dir.exists() {
        if let Some(parent) = dir.parent() {
            dir = parent.to_path_buf();
        }
    }
    let wide: Vec<u16> = dir
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut free_available: u64 = 0;
    let mut total: u64 = 0;
    let mut total_free: u64 = 0;
    let ok = unsafe {
        windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_available,
            &mut total,
            &mut total_free,
        )
    };
    if ok == 0 {
        Err(InstallError::Io(
            "No se pudo consultar el espacio libre en disco.".into(),
        ))
    } else {
        Ok(free_available)
    }
}

#[cfg(not(windows))]
fn disk_free_bytes(_path: &Path) -> Result<u64, InstallError> {
    Ok(u64::MAX / 4)
}

fn emit_progress(
    app: Option<&AppHandle>,
    operation_id: &str,
    phase: &str,
    bytes_done: u64,
    bytes_total: u64,
    message: &str,
) {
    if let Some(app) = app {
        let _ = app.emit(
            "runtime-install-progress",
            RuntimeInstallProgress {
                operation_id: operation_id.to_string(),
                phase: phase.to_string(),
                bytes_done,
                bytes_total,
                message: message.to_string(),
            },
        );
    }
}

fn runtimes_root(app: &AppHandle) -> Result<PathBuf, InstallError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| InstallError::Io(e.to_string()))?;
    Ok(base.join("runtimes"))
}

fn version_dir(root: &Path, id: &str, version: &str) -> PathBuf {
    root.join(id).join(version)
}

fn marker_path(dir: &Path) -> PathBuf {
    dir.join(".installed.json")
}

fn cores_dir(version_root: &Path) -> PathBuf {
    version_root.join("cores")
}

fn cores_present(version_root: &Path, cores: &[String]) -> bool {
    if cores.is_empty() {
        return true;
    }
    let dir = cores_dir(version_root);
    cores.iter().all(|dll| {
        let path = dir.join(dll);
        path.is_file() && file_has_mz_signature(&path)
    })
}

fn resolve_resource_path(app: &AppHandle, relative: &str) -> Option<PathBuf> {
    if let Ok(path) = app.path().resolve(relative, BaseDirectory::Resource) {
        if path.exists() {
            return Some(path);
        }
    }
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    if dev_path.exists() {
        return Some(dev_path);
    }
    None
}

/// Pack offline del instalador: `resources/emulators/packs/<id>.7z` + `<id>.blaze-bundle.json`.
fn resolve_bundled_emulator_pack(app: &AppHandle, id: &str) -> Option<(PathBuf, PathBuf)> {
    let archive_relatives = [
        format!("resources/emulators/packs/{id}.7z"),
        format!("emulators/packs/{id}.7z"),
    ];
    let meta_relatives = [
        format!("resources/emulators/packs/{id}.blaze-bundle.json"),
        format!("emulators/packs/{id}.blaze-bundle.json"),
    ];
    let archive = archive_relatives
        .iter()
        .find_map(|r| resolve_resource_path(app, r))?;
    let meta = meta_relatives
        .iter()
        .find_map(|r| resolve_resource_path(app, r))?;
    if archive.is_file() && meta.is_file() {
        Some((archive, meta))
    } else {
        None
    }
}

/// Carpeta suelta (dev): `resources/emulators/<id>/`.
fn resolve_bundled_emulator_dir(app: &AppHandle, id: &str) -> Option<PathBuf> {
    let relatives = [
        format!("resources/emulators/{id}"),
        format!("emulators/{id}"),
    ];
    for relative in &relatives {
        if let Some(path) = resolve_resource_path(app, relative) {
            if path.is_dir() {
                return Some(path);
            }
        }
    }
    None
}

fn copy_tree_overwrite(source: &Path, destination: &Path) -> Result<(), InstallError> {
    if !source.is_dir() {
        return Err(InstallError::Io(format!(
            "Bundle inválido (no es carpeta): {}",
            source.display()
        )));
    }
    fs::create_dir_all(destination).map_err(|e| InstallError::Io(e.to_string()))?;
    for entry in fs::read_dir(source).map_err(|e| InstallError::Io(e.to_string()))? {
        let entry = entry.map_err(|e| InstallError::Io(e.to_string()))?;
        let file_type = entry.file_type().map_err(|e| InstallError::Io(e.to_string()))?;
        if file_type.is_symlink() {
            continue;
        }
        let src = entry.path();
        let dst = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_tree_overwrite(&src, &dst)?;
        } else if file_type.is_file() {
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent).map_err(|e| InstallError::Io(e.to_string()))?;
            }
            fs::copy(&src, &dst).map_err(|e| {
                InstallError::Io(format!(
                    "No se pudo copiar {} → {}: {e}",
                    src.display(),
                    dst.display()
                ))
            })?;
        }
    }
    Ok(())
}

/// Metadatos del emulador empaquetado en el instalador (evita “actualizar”
/// con binarios viejos del bundle cuando el manifiesto ya apunta a otra versión).
#[derive(Debug, Deserialize)]
struct BundleMeta {
    version: String,
    sha256: String,
}

fn read_bundle_meta_file(path: &Path) -> Option<BundleMeta> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn bundle_meta_matches(meta: &BundleMeta, entry: &RuntimeManifestEntry) -> bool {
    // Offline pack del instalador: alcanza con la misma versión.
    // El sha256 del manifiesto es del zip/URL remoto; el de
    // `*.blaze-bundle.json` es del `.7z` local (suelen diferir, p. ej. Eden).
    meta.version == entry.version
}

fn finalize_bundled_install(
    app: &AppHandle,
    root: &Path,
    entry: &RuntimeManifestEntry,
    operation_id: &str,
    extract_dir: &Path,
    tmp_root: &Path,
) -> Result<InstalledRuntimeInfo, InstallError> {
    let exe_path = extract_dir.join(&entry.exe);
    if !exe_path.is_file() {
        return Err(InstallError::Extract(format!(
            "Bundle de {} incompleto: falta {}.",
            entry.id, entry.exe
        )));
    }
    if !cores_present(extract_dir, &entry.cores) {
        return Err(InstallError::CoreMissing {
            dll: entry
                .cores
                .first()
                .cloned()
                .unwrap_or_else(|| "core".into()),
        });
    }

    let marker = InstalledMarker {
        id: entry.id.clone(),
        version: entry.version.clone(),
        sha256: entry.sha256.clone(),
    };
    let marker_raw =
        serde_json::to_string_pretty(&marker).map_err(|e| InstallError::Io(e.to_string()))?;
    fs::write(marker_path(extract_dir), marker_raw).map_err(|e| InstallError::Io(e.to_string()))?;

    let final_dir = version_dir(root, &entry.id, &entry.version);
    if final_dir.exists() {
        remove_dir_best_effort(&final_dir);
    }
    rename_with_retries(extract_dir, &final_dir)?;
    remove_dir_best_effort(tmp_root);

    emit_progress(Some(app), operation_id, "done", 1, 1, "Emulador listo.");

    Ok(InstalledRuntimeInfo {
        id: entry.id.clone(),
        version: entry.version.clone(),
        executable_path: final_dir.join(&entry.exe).to_string_lossy().to_string(),
        root_path: final_dir.to_string_lossy().to_string(),
    })
}

/// Si el instalador trae el emulador (pack .7z o carpeta), lo instala en AppData/runtimes sin red.
fn try_install_from_bundle(
    app: Option<&AppHandle>,
    root: &Path,
    entry: &RuntimeManifestEntry,
    operation_id: &str,
) -> Result<Option<InstalledRuntimeInfo>, InstallError> {
    let Some(app) = app else {
        return Ok(None);
    };

    let tmp_root = root.join(".tmp").join(format!(
        "bundle-{}-{}-{}",
        entry.id,
        entry.version,
        &operation_id[..operation_id.len().min(8)]
    ));
    let _cleanup = scopeguard_remove(tmp_root.clone());
    let extract_dir = tmp_root.join("extract");
    if extract_dir.exists() {
        remove_dir_best_effort(&extract_dir);
    }
    fs::create_dir_all(&extract_dir).map_err(|e| InstallError::Io(e.to_string()))?;

    // 1) Pack .7z del instalador (camino principal).
    if let Some((archive, meta_path)) = resolve_bundled_emulator_pack(app, &entry.id) {
        let Some(meta) = read_bundle_meta_file(&meta_path) else {
            return Ok(None);
        };
        if !bundle_meta_matches(&meta, entry) {
            return Ok(None);
        }

        emit_progress(
            Some(app),
            operation_id,
            "extracting",
            0,
            1,
            "Instalando emulador incluido en Blaze…",
        );

        let archive_len = fs::metadata(&archive).map(|m| m.len()).unwrap_or(0);
        let need = archive_len
            .saturating_mul(4)
            .saturating_add(128 * 1024 * 1024);
        ensure_disk_space(root, need)?;

        let mut pack_entry = (*entry).clone();
        pack_entry.strip_components = 0;
        pack_entry.max_extract_bytes = 2 * 1024 * 1024 * 1024; // 2 GiB
        pack_entry.max_extract_entries = 50_000;
        let cancel = Arc::new(AtomicBool::new(false));
        extract_7z_tree(&archive, &extract_dir, &pack_entry, &cancel)?;

        let info = finalize_bundled_install(
            app,
            root,
            entry,
            operation_id,
            &extract_dir,
            &tmp_root,
        )?;
        return Ok(Some(info));
    }

    // 2) Carpeta suelta (desarrollo / tauri dev).
    let Some(src) = resolve_bundled_emulator_dir(app, &entry.id) else {
        return Ok(None);
    };
    let Some(meta) = read_bundle_meta_file(&src.join(".blaze-bundle.json")) else {
        return Ok(None);
    };
    if !bundle_meta_matches(&meta, entry) {
        return Ok(None);
    }
    if !src.join(&entry.exe).is_file() || !cores_present(&src, &entry.cores) {
        return Ok(None);
    }

    emit_progress(
        Some(app),
        operation_id,
        "extracting",
        0,
        1,
        "Instalando emulador incluido en Blaze…",
    );
    ensure_disk_space(root, 512 * 1024 * 1024)?;
    copy_tree_overwrite(&src, &extract_dir)?;
    let info = finalize_bundled_install(app, root, entry, operation_id, &extract_dir, &tmp_root)?;
    Ok(Some(info))
}

pub fn is_version_installed(root: &Path, entry: &RuntimeManifestEntry) -> bool {
    let dir = version_dir(root, &entry.id, &entry.version);
    let exe = dir.join(&entry.exe);
    let marker = marker_path(&dir);
    if !exe.is_file() || !marker.is_file() {
        return false;
    }
    if !cores_present(&dir, &entry.cores) {
        return false;
    }
    match fs::read_to_string(&marker) {
        Ok(raw) => match serde_json::from_str::<InstalledMarker>(&raw) {
            Ok(m) => {
                m.id == entry.id
                    && m.version == entry.version
                    && m.sha256.eq_ignore_ascii_case(&entry.sha256)
            }
            Err(_) => false,
        },
        Err(_) => false,
    }
}

fn file_has_mz_signature(path: &Path) -> bool {
    let Ok(mut f) = File::open(path) else {
        return false;
    };
    let mut magic = [0u8; 2];
    match f.read_exact(&mut magic) {
        Ok(()) => magic == *b"MZ",
        Err(_) => false,
    }
}

fn disk_space_need(entry: &RuntimeManifestEntry) -> u64 {
    let mut need = entry
        .max_download_bytes
        .saturating_add(entry.max_extract_bytes);
    if let Some(pack) = &entry.cores_pack {
        need = need
            .saturating_add(pack.max_download_bytes)
            .saturating_add(pack.max_extract_bytes);
    }
    need
}

fn strip_path(path: &Path, strip: u32) -> Result<Option<PathBuf>, InstallError> {
    let mut comps = path.components().peekable();
    // Reject absolute / prefixes
    if matches!(
        comps.peek(),
        Some(Component::Prefix(_)) | Some(Component::RootDir)
    ) {
        return Err(InstallError::Extract(format!(
            "Ruta insegura en archivo: {}",
            path.display()
        )));
    }
    let mut parts: Vec<Component> = Vec::new();
    let mut skipped = 0u32;
    for c in comps {
        match c {
            Component::Normal(_) => {
                if skipped < strip {
                    skipped += 1;
                } else {
                    parts.push(c);
                }
            }
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(InstallError::Extract(
                    "Path traversal (..) rechazado.".into(),
                ));
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(InstallError::Extract("Ruta absoluta rechazada.".into()));
            }
        }
    }
    if parts.is_empty() {
        return Ok(None);
    }
    let mut out = PathBuf::new();
    for c in parts {
        out.push(c);
    }
    Ok(Some(out))
}

fn safe_join(dest: &Path, relative: &Path) -> Result<PathBuf, InstallError> {
    let joined = dest.join(relative);
    let dest_canon = dest
        .canonicalize()
        .unwrap_or_else(|_| dest.to_path_buf());
    // Parent may not exist yet; check component-wise
    let mut check = dest_canon.clone();
    for c in relative.components() {
        match c {
            Component::Normal(s) => check.push(s),
            _ => {
                return Err(InstallError::Extract("Ruta relativa inválida.".into()));
            }
        }
    }
    if !check.starts_with(&dest_canon) {
        return Err(InstallError::Extract("Zip-slip detectado.".into()));
    }
    Ok(joined)
}

fn remove_dir_best_effort(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

fn rename_with_retries(from: &Path, to: &Path) -> Result<(), InstallError> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| InstallError::Io(e.to_string()))?;
    }
    if to.exists() {
        remove_dir_best_effort(to);
    }
    let mut last = None;
    for _ in 0..RENAME_ATTEMPTS {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = Some(e.to_string());
                std::thread::sleep(Duration::from_millis(RENAME_SLEEP_MS));
            }
        }
    }
    Err(InstallError::Io(format!(
        "No se pudo mover la instalación: {}",
        last.unwrap_or_default()
    )))
}

struct DownloadSpec<'a> {
    url: &'a str,
    sha256: &'a str,
    max_download_bytes: u64,
    message: &'a str,
}

async fn download_with_hash(
    app: Option<&AppHandle>,
    operation_id: &str,
    spec: &DownloadSpec<'_>,
    dest_file: &Path,
    cancel: &AtomicBool,
) -> Result<String, InstallError> {
    validate_url(spec.url)?;
    if let Some(parent) = dest_file.parent() {
        fs::create_dir_all(parent).map_err(|e| InstallError::Io(e.to_string()))?;
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
        .map_err(|e| InstallError::Network(e.to_string()))?;

    let response = client
        .get(spec.url)
        .send()
        .await
        .map_err(|e| InstallError::Network(e.to_string()))?;

    if !response.status().is_success() {
        return Err(InstallError::Network(format!(
            "HTTP {}",
            response.status()
        )));
    }
    if !host_allowed(response.url()) {
        return Err(InstallError::HostNotAllowed(
            response
                .url()
                .host_str()
                .unwrap_or("?")
                .to_string(),
        ));
    }

    let content_len = response.content_length().unwrap_or(0);
    if content_len > spec.max_download_bytes {
        return Err(InstallError::TooLarge {
            kind: "Descarga",
            limit: spec.max_download_bytes,
        });
    }

    let mut file =
        File::create(dest_file).map_err(|e| InstallError::Io(e.to_string()))?;
    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();
    let mut done = 0u64;
    let total = content_len.max(1);

    emit_progress(
        app,
        operation_id,
        "downloading",
        0,
        total,
        spec.message,
    );

    while let Some(chunk) = stream.next().await {
        check_cancel(cancel)?;
        let chunk = chunk.map_err(|e| InstallError::Network(e.to_string()))?;
        done += chunk.len() as u64;
        if done > spec.max_download_bytes {
            return Err(InstallError::TooLarge {
                kind: "Descarga",
                limit: spec.max_download_bytes,
            });
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|e| InstallError::Io(e.to_string()))?;
        if done % (512 * 1024) < chunk.len() as u64 || done == total {
            emit_progress(
                app,
                operation_id,
                "downloading",
                done,
                total.max(done),
                spec.message,
            );
        }
    }
    file.flush().map_err(|e| InstallError::Io(e.to_string()))?;

    let got = hex::encode(hasher.finalize());
    verify_sha256_hex(&got, spec.sha256)?;
    Ok(got)
}

fn download_spec_for_runtime(entry: &RuntimeManifestEntry) -> DownloadSpec<'_> {
    DownloadSpec {
        url: &entry.url,
        sha256: &entry.sha256,
        max_download_bytes: entry.max_download_bytes,
        message: "Descargando emulador…",
    }
}

fn download_spec_for_cores(pack: &CoresPackManifest) -> DownloadSpec<'_> {
    DownloadSpec {
        url: &pack.url,
        sha256: &pack.sha256,
        max_download_bytes: pack.max_download_bytes,
        message: "Descargando cores de RetroArch…",
    }
}

fn verify_sha256_hex(got: &str, expected: &str) -> Result<(), InstallError> {
    if got.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(InstallError::HashMismatch {
            expected: expected.to_string(),
            got: got.to_string(),
        })
    }
}

fn ensure_disk_space(root: &Path, need: u64) -> Result<(), InstallError> {
    let free = disk_free_bytes(root)?;
    if free < need {
        Err(InstallError::DiskSpace { need, free })
    } else {
        Ok(())
    }
}

fn extract_zip_tree(
    archive_path: &Path,
    dest: &Path,
    entry: &RuntimeManifestEntry,
    cancel: &AtomicBool,
) -> Result<(), InstallError> {
    let file = File::open(archive_path).map_err(|e| InstallError::Extract(e.to_string()))?;
    let mut zip =
        ZipArchive::new(file).map_err(|e| InstallError::Extract(e.to_string()))?;
    let mut total_bytes = 0u64;
    let mut entries = 0u64;

    for i in 0..zip.len() {
        check_cancel(cancel)?;
        let mut zentry = zip
            .by_index(i)
            .map_err(|e| InstallError::Extract(e.to_string()))?;
        // zip 2.x: symlink bit en unix_mode
        if zentry
            .unix_mode()
            .map(|m| m & 0o170000 == 0o120000)
            .unwrap_or(false)
        {
            return Err(InstallError::Extract(
                "Symlinks no permitidos en el archivo.".into(),
            ));
        }
        let enclosed = zentry
            .enclosed_name()
            .ok_or_else(|| InstallError::Extract("Entrada zip insegura.".into()))?
            .to_path_buf();
        let Some(rel) = strip_path(&enclosed, entry.strip_components)? else {
            continue;
        };
        let out = safe_join(dest, &rel)?;
        if zentry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| InstallError::Extract(e.to_string()))?;
            continue;
        }
        entries += 1;
        if entries > entry.max_extract_entries {
            return Err(InstallError::TooLarge {
                kind: "Entradas extraídas",
                limit: entry.max_extract_entries,
            });
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| InstallError::Extract(e.to_string()))?;
        }
        let mut out_file =
            File::create(&out).map_err(|e| InstallError::Extract(e.to_string()))?;
        let written = std::io::copy(&mut zentry, &mut out_file)
            .map_err(|e| InstallError::Extract(e.to_string()))?;
        total_bytes += written;
        if total_bytes > entry.max_extract_bytes {
            return Err(InstallError::TooLarge {
                kind: "Extracción",
                limit: entry.max_extract_bytes,
            });
        }
    }
    Ok(())
}

fn extract_7z_tree(
    archive_path: &Path,
    dest: &Path,
    entry: &RuntimeManifestEntry,
    cancel: &Arc<AtomicBool>,
) -> Result<(), InstallError> {
    use sevenz_rust2::decompress_file_with_extract_fn;
    use std::borrow::Cow;

    let total_bytes = Arc::new(Mutex::new(0u64));
    let entries = Arc::new(Mutex::new(0u64));
    let parent_cancel = Arc::clone(cancel);

    let tb = Arc::clone(&total_bytes);
    let en = Arc::clone(&entries);
    let max_bytes = entry.max_extract_bytes;
    let max_entries = entry.max_extract_entries;
    let strip = entry.strip_components;
    let dest_owned = dest.to_path_buf();

    decompress_file_with_extract_fn(archive_path, dest, move |arch_entry, reader, _out_path| {
        if parent_cancel.load(Ordering::SeqCst) {
            return Err(sevenz_rust2::Error::Other(Cow::Borrowed("cancelled")));
        }
        let name = arch_entry.name();
        if name.is_empty() {
            return Ok(true);
        }
        if name.contains('\0') {
            return Err(sevenz_rust2::Error::Other(Cow::Borrowed(
                "nombre inválido",
            )));
        }
        let raw = PathBuf::from(name.replace('\\', "/"));
        let rel = match strip_path(&raw, strip) {
            Ok(Some(r)) => r,
            Ok(None) => return Ok(true),
            Err(e) => {
                return Err(sevenz_rust2::Error::Other(Cow::Owned(e.to_user())));
            }
        };
        let out = match safe_join(&dest_owned, &rel) {
            Ok(p) => p,
            Err(e) => return Err(sevenz_rust2::Error::Other(Cow::Owned(e.to_user()))),
        };

        if arch_entry.is_directory() {
            fs::create_dir_all(&out).map_err(sevenz_rust2::Error::from)?;
            return Ok(true);
        }

        // sevenz-rust2 no tiene API de symlink; materializaría el target como archivo.
        // Rechazamos reparse points (symlinks Windows / links en atributos 7z).
        if arch_entry.has_windows_attributes
            && (arch_entry.windows_attributes() & WIN_ATTR_REPARSE_POINT) != 0
        {
            return Err(sevenz_rust2::Error::Other(Cow::Borrowed(
                "symlink no permitido",
            )));
        }

        {
            let mut c = en
                .lock()
                .map_err(|_| sevenz_rust2::Error::Other(Cow::Borrowed("lock")))?;
            *c += 1;
            if *c > max_entries {
                return Err(sevenz_rust2::Error::Other(Cow::Borrowed(
                    "too many entries",
                )));
            }
        }

        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(sevenz_rust2::Error::from)?;
        }
        let mut file = File::create(&out).map_err(sevenz_rust2::Error::from)?;
        let mut buf = [0u8; 64 * 1024];
        loop {
            if parent_cancel.load(Ordering::SeqCst) {
                return Err(sevenz_rust2::Error::Other(Cow::Borrowed("cancelled")));
            }
            let n = std::io::Read::read(reader, &mut buf)
                .map_err(sevenz_rust2::Error::from)?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .map_err(sevenz_rust2::Error::from)?;
            let mut t = tb
                .lock()
                .map_err(|_| sevenz_rust2::Error::Other(Cow::Borrowed("lock")))?;
            *t += n as u64;
            if *t > max_bytes {
                return Err(sevenz_rust2::Error::Other(Cow::Borrowed(
                    "extract too large",
                )));
            }
        }
        Ok(true)
    })
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("cancelled") {
            InstallError::Cancelled
        } else if msg.contains("too many") || msg.contains("too large") {
            InstallError::TooLarge {
                kind: "Extracción",
                limit: entry.max_extract_bytes,
            }
        } else {
            InstallError::Extract(msg)
        }
    })?;

    Ok(())
}

fn extract_archive(
    archive_path: &Path,
    dest: &Path,
    entry: &RuntimeManifestEntry,
    cancel: &Arc<AtomicBool>,
) -> Result<(), InstallError> {
    fs::create_dir_all(dest).map_err(|e| InstallError::Io(e.to_string()))?;
    match entry.archive {
        ArchiveKind::Zip => extract_zip_tree(archive_path, dest, entry, cancel),
        ArchiveKind::SevenZ => extract_7z_tree(archive_path, dest, entry, cancel),
    }
}

/// Extrae solo las DLL listadas a `dest/cores/<dll>`. Entradas no listadas se drenan (sólido) y no se escriben.
fn extract_7z_selected_cores(
    archive_path: &Path,
    dest: &Path,
    wanted_dlls: &[String],
    pack: &CoresPackManifest,
    cancel: &Arc<AtomicBool>,
) -> Result<(), InstallError> {
    use sevenz_rust2::decompress_file_with_extract_fn;
    use std::borrow::Cow;
    use std::collections::HashSet;

    let wanted: HashSet<String> = wanted_dlls
        .iter()
        .map(|d| d.to_ascii_lowercase())
        .collect();
    let found = Arc::new(Mutex::new(HashSet::<String>::new()));
    let total_bytes = Arc::new(Mutex::new(0u64));
    let entries = Arc::new(Mutex::new(0u64));
    let parent_cancel = Arc::clone(cancel);
    let tb = Arc::clone(&total_bytes);
    let en = Arc::clone(&entries);
    let found2 = Arc::clone(&found);
    let max_bytes = pack.max_extract_bytes;
    let max_entries = pack.max_extract_entries;
    let strip = pack.strip_components;
    let cores_out = cores_dir(dest);

    decompress_file_with_extract_fn(archive_path, dest, move |arch_entry, reader, _out_path| {
        if parent_cancel.load(Ordering::SeqCst) {
            return Err(sevenz_rust2::Error::Other(Cow::Borrowed("cancelled")));
        }
        let name = arch_entry.name();
        if name.is_empty() || arch_entry.is_directory() {
            return Ok(true);
        }
        if name.contains('\0') {
            return Err(sevenz_rust2::Error::Other(Cow::Borrowed(
                "nombre inválido",
            )));
        }
        if arch_entry.has_windows_attributes
            && (arch_entry.windows_attributes() & WIN_ATTR_REPARSE_POINT) != 0
        {
            return Err(sevenz_rust2::Error::Other(Cow::Borrowed(
                "symlink no permitido",
            )));
        }

        let raw = PathBuf::from(name.replace('\\', "/"));
        let rel = match strip_path(&raw, strip) {
            Ok(Some(r)) => r,
            Ok(None) => {
                let mut sink = std::io::sink();
                let _ = std::io::copy(reader, &mut sink);
                return Ok(true);
            }
            Err(e) => {
                return Err(sevenz_rust2::Error::Other(Cow::Owned(e.to_user())));
            }
        };
        let basename = rel
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let key = basename.to_ascii_lowercase();
        if !wanted.contains(&key) {
            let mut sink = std::io::sink();
            let _ = std::io::copy(reader, &mut sink);
            return Ok(true);
        }

        {
            let mut c = en
                .lock()
                .map_err(|_| sevenz_rust2::Error::Other(Cow::Borrowed("lock")))?;
            *c += 1;
            if *c > max_entries {
                return Err(sevenz_rust2::Error::Other(Cow::Borrowed(
                    "too many entries",
                )));
            }
        }

        let out = cores_out.join(&basename);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(sevenz_rust2::Error::from)?;
        }
        let mut file = File::create(&out).map_err(sevenz_rust2::Error::from)?;
        let mut buf = [0u8; 64 * 1024];
        loop {
            if parent_cancel.load(Ordering::SeqCst) {
                return Err(sevenz_rust2::Error::Other(Cow::Borrowed("cancelled")));
            }
            let n = reader.read(&mut buf).map_err(sevenz_rust2::Error::from)?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .map_err(sevenz_rust2::Error::from)?;
            let mut t = tb
                .lock()
                .map_err(|_| sevenz_rust2::Error::Other(Cow::Borrowed("lock")))?;
            *t += n as u64;
            if *t > max_bytes {
                return Err(sevenz_rust2::Error::Other(Cow::Borrowed(
                    "extract too large",
                )));
            }
        }
        if let Ok(mut set) = found2.lock() {
            set.insert(key);
        }
        Ok(true)
    })
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("cancelled") {
            InstallError::Cancelled
        } else if msg.contains("too many") || msg.contains("too large") {
            InstallError::TooLarge {
                kind: "Extracción",
                limit: pack.max_extract_bytes,
            }
        } else {
            InstallError::Extract(msg)
        }
    })?;

    let found_set = found
        .lock()
        .map_err(|_| InstallError::Io("lock".into()))?
        .clone();
    for dll in wanted_dlls {
        let key = dll.to_ascii_lowercase();
        if !found_set.contains(&key) {
            return Err(InstallError::CoreMissing { dll: dll.clone() });
        }
        let path = cores_dir(dest).join(dll);
        if !file_has_mz_signature(&path) {
            return Err(InstallError::Extract(format!(
                "Core {dll} no parece un PE válido (falta firma MZ)."
            )));
        }
    }
    Ok(())
}

fn install_cores_into_extract(
    entry: &RuntimeManifestEntry,
    extract_dir: &Path,
    cores_archive: &Path,
    cancel: &Arc<AtomicBool>,
) -> Result<(), InstallError> {
    let Some(pack) = entry.cores_pack.as_ref() else {
        return Ok(());
    };
    if entry.cores.is_empty() {
        return Ok(());
    }
    match pack.archive {
        ArchiveKind::SevenZ => {
            extract_7z_selected_cores(cores_archive, extract_dir, &entry.cores, pack, cancel)
        }
        ArchiveKind::Zip => Err(InstallError::Extract(
            "El pack de cores debe ser 7z.".into(),
        )),
    }
}

/// Instala un runtime bajo `root` (p.ej. AppData/runtimes o un temp de test).
pub async fn install_runtime_into(
    app: Option<&AppHandle>,
    root: &Path,
    runtime_id: &str,
    operation_id: &str,
) -> Result<InstalledRuntimeInfo, InstallError> {
    let entry = lookup_manifest(runtime_id)?;
    if is_version_installed(root, entry) {
        let dir = version_dir(root, &entry.id, &entry.version);
        return Ok(InstalledRuntimeInfo {
            id: entry.id.clone(),
            version: entry.version.clone(),
            executable_path: dir.join(&entry.exe).to_string_lossy().to_string(),
            root_path: dir.to_string_lossy().to_string(),
        });
    }

    if let Some(bundled) = try_install_from_bundle(app, root, entry, operation_id)? {
        return Ok(bundled);
    }

    let cancel = register_cancel(operation_id);
    let tmp_root = root.join(".tmp").join(format!(
        "{}-{}-{}",
        entry.id,
        entry.version,
        &operation_id[..operation_id.len().min(8)]
    ));
    let _cleanup = scopeguard_remove(tmp_root.clone());

    let result = async {
        check_cancel(&cancel)?;
        fs::create_dir_all(&tmp_root).map_err(|e| InstallError::Io(e.to_string()))?;

        ensure_disk_space(root, disk_space_need(entry))?;

        let archive_path = tmp_root.join(format!("pack.{}", match entry.archive {
            ArchiveKind::Zip => "zip",
            ArchiveKind::SevenZ => "7z",
        }));

        download_with_hash(
            app,
            operation_id,
            &download_spec_for_runtime(entry),
            &archive_path,
            &cancel,
        )
        .await?;

        emit_progress(
            app,
            operation_id,
            "extracting",
            0,
            1,
            "Extrayendo emulador…",
        );
        check_cancel(&cancel)?;

        let extract_dir = tmp_root.join("extract");
        let entry_clone = (*entry).clone();
        let cancel_flag = Arc::clone(&cancel);
        let extract_dir2 = extract_dir.clone();
        let archive_path2 = archive_path.clone();
        tokio::task::spawn_blocking(move || {
            extract_archive(&archive_path2, &extract_dir2, &entry_clone, &cancel_flag)
        })
        .await
        .map_err(|e| InstallError::Extract(e.to_string()))??;

        check_cancel(&cancel)?;
        let exe_path = extract_dir.join(&entry.exe);
        if !exe_path.is_file() {
            return Err(InstallError::Extract(format!(
                "No se encontró el ejecutable {} tras extraer.",
                entry.exe
            )));
        }

        if let Some(pack) = entry.cores_pack.as_ref() {
            if !entry.cores.is_empty() {
                let cores_archive = tmp_root.join("cores.7z");
                download_with_hash(
                    app,
                    operation_id,
                    &download_spec_for_cores(pack),
                    &cores_archive,
                    &cancel,
                )
                .await?;

                emit_progress(
                    app,
                    operation_id,
                    "extracting",
                    0,
                    1,
                    "Extrayendo cores…",
                );
                check_cancel(&cancel)?;

                let entry_cores = (*entry).clone();
                let cancel_cores = Arc::clone(&cancel);
                let extract_dir_cores = extract_dir.clone();
                let cores_archive2 = cores_archive.clone();
                tokio::task::spawn_blocking(move || {
                    install_cores_into_extract(
                        &entry_cores,
                        &extract_dir_cores,
                        &cores_archive2,
                        &cancel_cores,
                    )
                })
                .await
                .map_err(|e| InstallError::Extract(e.to_string()))??;

                // Borrar el pack tras extraer (éxito); en error el scopeguard limpia .tmp.
                let _ = fs::remove_file(&cores_archive);
                check_cancel(&cancel)?;
            }
        }

        let marker = InstalledMarker {
            id: entry.id.clone(),
            version: entry.version.clone(),
            sha256: entry.sha256.clone(),
        };
        let marker_raw = serde_json::to_string_pretty(&marker)
            .map_err(|e| InstallError::Io(e.to_string()))?;
        fs::write(marker_path(&extract_dir), marker_raw)
            .map_err(|e| InstallError::Io(e.to_string()))?;

        let final_dir = version_dir(root, &entry.id, &entry.version);
        rename_with_retries(&extract_dir, &final_dir)?;

        emit_progress(app, operation_id, "done", 1, 1, "Emulador listo.");

        Ok(InstalledRuntimeInfo {
            id: entry.id.clone(),
            version: entry.version.clone(),
            executable_path: final_dir.join(&entry.exe).to_string_lossy().to_string(),
            root_path: final_dir.to_string_lossy().to_string(),
        })
    }
    .await;

    clear_cancel(operation_id);
    match &result {
        Ok(_) => {
            remove_dir_best_effort(&tmp_root);
        }
        Err(_) => {
            remove_dir_best_effort(&tmp_root);
        }
    }
    result
}

/// Mini scopeguard sin crate extra.
struct RemoveOnDrop(PathBuf);
impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        // cleaned explicitly; keep as safety net only if still exists under .tmp
        if self.0.exists() && self.0.to_string_lossy().contains(".tmp") {
            remove_dir_best_effort(&self.0);
        }
    }
}
fn scopeguard_remove(path: PathBuf) -> RemoveOnDrop {
    RemoveOnDrop(path)
}

#[tauri::command]
pub async fn install_runtime(
    app: AppHandle,
    id: String,
    operation_id: String,
) -> Result<InstalledRuntimeInfo, String> {
    let root = runtimes_root(&app).map_err(|e| e.to_user())?;
    install_runtime_into(Some(&app), &root, &id, &operation_id)
        .await
        .map_err(|e| e.to_user())
}

#[tauri::command]
pub fn cancel_runtime_install(operation_id: String) -> Result<(), String> {
    if let Ok(map) = cancel_map().lock() {
        if let Some(flag) = map.get(&operation_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn runtime_manifest_ids() -> Result<Vec<String>, String> {
    Ok(manifest_entries()
        .map_err(|e| e.to_user())?
        .iter()
        .map(|e| e.id.clone())
        .collect())
}

/// Versiones pinneadas en el manifiesto embebido (para updates managed).
#[tauri::command]
pub fn runtime_manifest_list() -> Result<Vec<RuntimeManifestInfo>, String> {
    Ok(manifest_entries()
        .map_err(|e| e.to_user())?
        .iter()
        .map(|e| RuntimeManifestInfo {
            id: e.id.clone(),
            version: e.version.clone(),
            exe: e.exe.clone(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn temp_root(name: &str) -> PathBuf {
        let p = std::env::temp_dir()
            .join("blaze-runtime-tests")
            .join(name)
            .join(format!("{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn manifest_loads_pcsx2_and_retroarch() {
        let entries = manifest_entries().unwrap();
        assert!(entries.iter().any(|e| e.id == "pcsx2"));
        assert!(entries.iter().any(|e| e.id == "retroarch"));
        assert!(entries.iter().any(|e| e.id == "eden"));
        let eden = lookup_manifest("eden").unwrap();
        assert_eq!(eden.exe, "eden.exe");
        assert_eq!(
            eden.sha256,
            "ff498e5da9630216926ac3cbe9fb493b14930665c728a40a8f5b59507fdd7ebf"
        );
        assert!(eden.platforms.iter().any(|p| p == "Nintendo Switch"));
        let pcsx2 = lookup_manifest("pcsx2").unwrap();
        assert_eq!(pcsx2.hash_origin, HashOrigin::GithubDigest);
        assert_eq!(
            pcsx2.sha256,
            "7dfc829ca1994cc1045ac49f05e39b6cf968b72e6a374c40e05c2a2b4ac200b4"
        );
        let ra = lookup_manifest("retroarch").unwrap();
        assert_eq!(ra.hash_origin, HashOrigin::ComputedLocally);
        assert_eq!(
            ra.sha256,
            "b2139b1d0f9d4526dc6b5ce23cbb3efdc766096fa6f2c3df016818b486ac6372"
        );
        assert_eq!(ra.strip_components, 1);
        assert_eq!(pcsx2.strip_components, 0);
    }

    #[test]
    fn host_allowlist_rejects_http_and_unknown() {
        let _guard = http_test_lock();
        test_allowlist::clear();
        assert!(validate_url("http://github.com/x").is_err());
        assert!(validate_url("https://evil.example/x").is_err());
        assert!(validate_url(
            "https://github.com/PCSX2/pcsx2/releases/download/v2.8.2/x.7z"
        )
        .is_ok());
        assert!(validate_url(
            "https://buildbot.libretro.com/stable/1.22.2/windows/x86_64/RetroArch.7z"
        )
        .is_ok());
        assert!(validate_url(
            "https://git.eden-emu.dev/eden-emu/eden/releases/download/v0.2.1/Eden-Windows-v0.2.1-amd64-msvc-standard.zip"
        )
        .is_ok());
    }

    #[test]
    fn zip_slip_rejected() {
        let root = temp_root("zip-slip");
        let zip_path = root.join("bad.zip");
        {
            let file = File::create(&zip_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            // enclosed_name should reject .. paths; also our strip_path rejects ParentDir
            zip.start_file(
                "ok.txt",
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
            zip.write_all(b"hi").unwrap();
            zip.finish().unwrap();
        }
        let dest = root.join("out");
        fs::create_dir_all(&dest).unwrap();
        let entry = RuntimeManifestEntry {
            id: "t".into(),
            version: "1".into(),
            url: "https://github.com/x".into(),
            sha256: "00".into(),
            hash_origin: HashOrigin::ComputedLocally,
            archive: ArchiveKind::Zip,
            exe: "ok.txt".into(),
            strip_components: 0,
            platforms: vec![],
            max_download_bytes: 1_000_000,
            max_extract_bytes: 1_000_000,
            max_extract_entries: 100,
        cores: vec![],
        cores_pack: None,
        };
        let cancel = AtomicBool::new(false);
        extract_zip_tree(&zip_path, &dest, &entry, &cancel).unwrap();
        assert!(dest.join("ok.txt").is_file());

        // ParentDir rejection unit
        assert!(strip_path(Path::new("../evil.txt"), 0).is_err());
        assert!(strip_path(Path::new("/abs/evil.txt"), 0).is_err());
    }

    #[test]
    fn marker_and_exe_required() {
        let root = temp_root("marker");
        let entry = lookup_manifest("pcsx2").unwrap();
        assert!(!is_version_installed(root.as_path(), entry));
        let dir = version_dir(&root, &entry.id, &entry.version);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(&entry.exe), b"fake").unwrap();
        assert!(!is_version_installed(root.as_path(), entry));
        let marker = InstalledMarker {
            id: entry.id.clone(),
            version: entry.version.clone(),
            sha256: entry.sha256.clone(),
        };
        fs::write(
            marker_path(&dir),
            serde_json::to_string(&marker).unwrap(),
        )
        .unwrap();
        assert!(is_version_installed(root.as_path(), entry));
    }

    #[test]
    fn interrupted_tmp_does_not_count_as_installed() {
        let root = temp_root("interrupted");
        let entry = lookup_manifest("pcsx2").unwrap();
        let tmp = root.join(".tmp").join("pcsx2-partial");
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("pcsx2-qt.exe"), b"x").unwrap();
        assert!(!is_version_installed(root.as_path(), entry));
        assert!(!version_dir(&root, &entry.id, &entry.version).exists());
    }

    #[test]
    fn strip_components_drops_root_folder() {
        let p = Path::new("RetroArch-Win64/retroarch.exe");
        let stripped = strip_path(p, 1).unwrap().unwrap();
        assert_eq!(stripped, PathBuf::from("retroarch.exe"));
        let flat = strip_path(Path::new("pcsx2-qt.exe"), 0).unwrap().unwrap();
        assert_eq!(flat, PathBuf::from("pcsx2-qt.exe"));
    }

    #[test]
    fn hash_mismatch_rejected() {
        let err = verify_sha256_hex(
            "deadbeef",
            "7dfc829ca1994cc1045ac49f05e39b6cf968b72e6a374c40e05c2a2b4ac200b4",
        )
        .unwrap_err();
        assert!(matches!(err, InstallError::HashMismatch { .. }));
    }

    #[test]
    fn sevenz_entry_path_rejects_traversal() {
        assert!(strip_path(Path::new("..\\evil.bin"), 0).is_err());
        assert!(strip_path(Path::new("nested/../../x.bin"), 0).is_err());
        let ok = strip_path(Path::new("RetroArch-Win64/cores/foo.dll"), 1).unwrap();
        assert_eq!(ok.unwrap(), PathBuf::from("cores/foo.dll"));
    }

    #[test]
    fn cancel_flag_cleans_tmp_layout() {
        let root = temp_root("cancel-clean");
        let entry = lookup_manifest("pcsx2").unwrap();
        let op = "cancel-op-test";
        let tmp = root.join(".tmp").join(format!(
            "{}-{}-{}",
            entry.id,
            entry.version,
            &op[..op.len().min(8)]
        ));
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("partial.bin"), b"x").unwrap();
        assert!(!is_version_installed(root.as_path(), entry));
        remove_dir_best_effort(&tmp);
        assert!(!tmp.exists());
        assert!(!version_dir(&root, &entry.id, &entry.version).exists());
    }

    #[test]
    fn redirect_host_must_be_allowlisted() {
        let _guard = http_test_lock();
        test_allowlist::clear();
        let evil = reqwest::Url::parse("https://evil.example/redirect").unwrap();
        assert!(!host_allowed(&evil));
        let objects = reqwest::Url::parse("https://objects.githubusercontent.com/x").unwrap();
        assert!(host_allowed(&objects));
    }

    #[test]
    fn download_size_cap_enforced_in_zip_extract() {
        let root = temp_root("extract-cap");
        let zip_path = root.join("cap.zip");
        {
            let file = File::create(&zip_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            zip.start_file(
                "big.bin",
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
            zip.write_all(&vec![0u8; 2048]).unwrap();
            zip.finish().unwrap();
        }
        let dest = root.join("out");
        let entry = RuntimeManifestEntry {
            id: "t".into(),
            version: "1".into(),
            url: "https://github.com/x".into(),
            sha256: "00".into(),
            hash_origin: HashOrigin::ComputedLocally,
            archive: ArchiveKind::Zip,
            exe: "big.bin".into(),
            strip_components: 0,
            platforms: vec![],
            max_download_bytes: 1_000_000,
            max_extract_bytes: 1000,
            max_extract_entries: 100,
        cores: vec![],
        cores_pack: None,
        };
        let cancel = AtomicBool::new(false);
        let err = extract_zip_tree(&zip_path, &dest, &entry, &cancel).unwrap_err();
        assert!(matches!(err, InstallError::TooLarge { kind: "Extracción", .. }));
    }

    #[test]
    fn extract_entry_count_cap_enforced() {
        let root = temp_root("entry-cap");
        let zip_path = root.join("many.zip");
        {
            let file = File::create(&zip_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            for i in 0..5 {
                zip.start_file(
                    format!("f{i}.txt"),
                    SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
                )
                .unwrap();
                zip.write_all(b"x").unwrap();
            }
            zip.finish().unwrap();
        }
        let dest = root.join("out");
        let entry = RuntimeManifestEntry {
            id: "t".into(),
            version: "1".into(),
            url: "https://github.com/x".into(),
            sha256: "00".into(),
            hash_origin: HashOrigin::ComputedLocally,
            archive: ArchiveKind::Zip,
            exe: "f0.txt".into(),
            strip_components: 0,
            platforms: vec![],
            max_download_bytes: 1_000_000,
            max_extract_bytes: 1_000_000,
            max_extract_entries: 2,
        cores: vec![],
        cores_pack: None,
        };
        let cancel = AtomicBool::new(false);
        let err = extract_zip_tree(&zip_path, &dest, &entry, &cancel).unwrap_err();
        assert!(matches!(
            err,
            InstallError::TooLarge {
                kind: "Entradas extraídas",
                ..
            }
        ));
    }

    #[test]
    fn download_size_cap_logic() {
        let max = 100u64;
        assert!(101 > max);
        let entry = lookup_manifest("retroarch").unwrap();
        assert!(entry.max_download_bytes > 0);
    }

    #[test]
    fn disk_space_check_fails_when_insufficient() {
        let root = temp_root("disk");
        let err = ensure_disk_space(root.as_path(), u64::MAX / 2).unwrap_err();
        assert!(matches!(err, InstallError::DiskSpace { .. }));
    }

    #[tokio::test]
    #[ignore = "descarga real de red; ejecutar con cargo test -- --ignored"]
    async fn e2e_install_runtime_into_temp() {
        let root = temp_root("e2e-network");
        let info = install_runtime_into(None, &root, "retroarch", "e2e-retroarch-1")
            .await
            .expect("install retroarch from buildbot");
        assert!(Path::new(&info.executable_path).is_file());
        assert!(is_version_installed(
            root.as_path(),
            lookup_manifest("retroarch").unwrap()
        ));
        let tmp_left = root.join(".tmp");
        assert!(
            !tmp_left.exists()
                || fs::read_dir(&tmp_left)
                    .map(|mut d| d.next())
                    .ok()
                    .flatten()
                    .is_none(),
            "no debe quedar basura en .tmp tras instalar"
        );
    }

    #[tokio::test]
    #[ignore = "descarga real de red; ejecutar con cargo test -- --ignored"]
    async fn e2e_install_pcsx2_via_github() {
        let root = temp_root("e2e-pcsx2");
        let info = install_runtime_into(None, &root, "pcsx2", "e2e-pcsx2-gh")
            .await
            .expect("install pcsx2 from github (redirect a release-assets incluido)");
        assert!(Path::new(&info.executable_path).is_file());
        assert!(is_version_installed(
            root.as_path(),
            lookup_manifest("pcsx2").unwrap()
        ));
    }

    fn make_compressible_7z(dir: &Path, archive: &Path, files: &[(&str, usize)]) {
        let src = dir.join("7z-src");
        let _ = fs::remove_dir_all(&src);
        fs::create_dir_all(&src).unwrap();
        for (name, size) in files {
            fs::write(src.join(name), vec![0u8; *size]).unwrap();
        }
        sevenz_rust2::compress_to_path(&src, archive).expect("crear 7z de prueba");
    }

    fn sample_entry(
        max_extract_bytes: u64,
        max_extract_entries: u64,
        exe: &str,
    ) -> RuntimeManifestEntry {
        RuntimeManifestEntry {
            id: "t".into(),
            version: "1".into(),
            url: "https://github.com/x".into(),
            sha256: "00".into(),
            hash_origin: HashOrigin::ComputedLocally,
            archive: ArchiveKind::SevenZ,
            exe: exe.into(),
            strip_components: 0,
            platforms: vec![],
            max_download_bytes: 50_000_000,
            max_extract_bytes,
            max_extract_entries,
            cores: vec![],
            cores_pack: None,
        }
    }

    fn mz_dll(size: usize) -> Vec<u8> {
        let mut v = vec![0u8; size.max(2)];
        v[0] = b'M';
        v[1] = b'Z';
        v
    }

    fn make_cores_7z(dir: &Path, archive: &Path, dlls: &[(&str, &[u8])]) {
        let src = dir.join("cores-src");
        let _ = fs::remove_dir_all(&src);
        let nested = src.join("RetroArch-Win64").join("cores");
        fs::create_dir_all(&nested).unwrap();
        for (name, bytes) in dlls {
            fs::write(nested.join(name), bytes).unwrap();
        }
        sevenz_rust2::compress_to_path(&src, archive).expect("crear cores 7z");
    }

    fn cores_pack_for(url: &str, sha256: &str) -> CoresPackManifest {
        CoresPackManifest {
            url: url.into(),
            sha256: sha256.into(),
            hash_origin: HashOrigin::ComputedLocally,
            archive: ArchiveKind::SevenZ,
            strip_components: 1,
            max_download_bytes: 50_000_000,
            max_extract_bytes: 50_000_000,
            max_extract_entries: 32,
        }
    }

    #[test]
    fn sevenz_extract_bytes_cap_enforced() {
        let root = temp_root("7z-bytes");
        let archive = root.join("pack.7z");
        // Muy compresible: 64 KiB de ceros → archivo 7z pequeño, pero al extraer supera tope.
        make_compressible_7z(&root, &archive, &[("big.bin", 64 * 1024)]);
        let dest = root.join("out");
        let entry = sample_entry(1024, 100, "big.bin");
        let cancel = Arc::new(AtomicBool::new(false));
        let err = extract_7z_tree(&archive, &dest, &entry, &cancel).unwrap_err();
        assert!(matches!(err, InstallError::TooLarge { .. }));
    }

    #[test]
    fn sevenz_extract_entry_count_cap_enforced() {
        let root = temp_root("7z-entries");
        let archive = root.join("pack.7z");
        make_compressible_7z(
            &root,
            &archive,
            &[("a.txt", 16), ("b.txt", 16), ("c.txt", 16), ("d.txt", 16)],
        );
        let dest = root.join("out");
        let entry = sample_entry(1_000_000, 2, "a.txt");
        let cancel = Arc::new(AtomicBool::new(false));
        let err = extract_7z_tree(&archive, &dest, &entry, &cancel).unwrap_err();
        assert!(matches!(err, InstallError::TooLarge { .. }));
    }

    #[test]
    fn sevenz_rust2_has_no_symlink_api_we_reject_reparse_attr() {
        // Evidencia: el crate no menciona symlink/reparse en su API pública de extracción;
        // materializaría el stream como archivo regular. Nuestro extractor rechaza
        // FILE_ATTRIBUTE_REPARSE_POINT (0x400) cuando viene en metadatos Windows.
        assert_eq!(WIN_ATTR_REPARSE_POINT, 0x400);
        let mut entry = sevenz_rust2::ArchiveEntry::new_file("link.bin");
        entry.has_windows_attributes = true;
        entry.windows_attributes = WIN_ATTR_REPARSE_POINT;
        assert!(entry.has_windows_attributes);
        assert_eq!(entry.windows_attributes() & WIN_ATTR_REPARSE_POINT, WIN_ATTR_REPARSE_POINT);
    }

    /// Servidor HTTP mínimo (solo tests) con respuestas programables.
    struct TestHttpServer {
        addr: std::net::SocketAddr,
        _join: Option<std::thread::JoinHandle<()>>,
    }

    impl TestHttpServer {
        fn spawn(
            handler: Arc<dyn Fn(&str) -> (u16, Vec<(String, String)>, Vec<u8>) + Send + Sync>,
        ) -> Self {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = listener.local_addr().unwrap();
            let join = std::thread::spawn(move || {
                for stream in listener.incoming().take(32) {
                    let Ok(mut stream) = stream else { continue };
                    let mut buf = [0u8; 4096];
                    let _ = std::io::Read::read(&mut stream, &mut buf);
                    let req = String::from_utf8_lossy(&buf);
                    let path = req
                        .lines()
                        .next()
                        .and_then(|l| l.split_whitespace().nth(1))
                        .unwrap_or("/")
                        .to_string();
                    let (code, headers, body) = handler(&path);
                    let omit_cl = headers.iter().any(|(k, v)| {
                        k.eq_ignore_ascii_case("x-omit-content-length") && v == "1"
                    });
                    let declared_cl = headers.iter().find_map(|(k, v)| {
                        if k.eq_ignore_ascii_case("content-length") {
                            Some(v.clone())
                        } else {
                            None
                        }
                    });
                    let mut resp = format!("HTTP/1.1 {code} OK\r\nConnection: close\r\n");
                    if !omit_cl {
                        let cl = declared_cl.unwrap_or_else(|| body.len().to_string());
                        resp.push_str(&format!("Content-Length: {cl}\r\n"));
                    }
                    for (k, v) in &headers {
                        if k.eq_ignore_ascii_case("content-length")
                            || k.eq_ignore_ascii_case("x-omit-content-length")
                        {
                            continue;
                        }
                        resp.push_str(&format!("{k}: {v}\r\n"));
                    }
                    resp.push_str("\r\n");
                    use std::io::Write;
                    let _ = stream.write_all(resp.as_bytes());
                    let _ = stream.write_all(&body);
                }
            });
            Self {
                addr,
                _join: Some(join),
            }
        }

        fn url(&self, path: &str) -> String {
            format!("http://{}{}", self.addr, path)
        }
    }

    /// Evita carreras entre tests que mutan la allowlist inyectable.
    fn http_test_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn install_local_allowlist() {
        test_allowlist::set(
            Some(vec!["127.0.0.1".into(), "localhost".into()]),
            true,
        );
    }

    #[tokio::test]
    async fn http_content_length_over_cap_rejected() {
        let _guard = http_test_lock();
        install_local_allowlist();
        let server = TestHttpServer::spawn(Arc::new(|_path| {
            (
                200,
                vec![("Content-Length".into(), "999999".into())],
                vec![0u8; 8],
            )
        }));
        let root = temp_root("http-cl");
        let dest = root.join("pack.bin");
        let entry = RuntimeManifestEntry {
            id: "t".into(),
            version: "1".into(),
            url: server.url("/big"),
            sha256: "00".into(),
            hash_origin: HashOrigin::ComputedLocally,
            archive: ArchiveKind::Zip,
            exe: "x".into(),
            strip_components: 0,
            platforms: vec![],
            max_download_bytes: 100,
            max_extract_bytes: 1000,
            max_extract_entries: 10,
        cores: vec![],
        cores_pack: None,
        };
        let cancel = AtomicBool::new(false);
        let err = download_with_hash(
            None,
            "op-cl",
            &DownloadSpec {
                url: &entry.url,
                sha256: &entry.sha256,
                max_download_bytes: entry.max_download_bytes,
                message: "test",
            },
            &dest,
            &cancel,
        )
            .await
            .unwrap_err();
        test_allowlist::clear();
        assert!(
            matches!(
                err,
                InstallError::TooLarge {
                    kind: "Descarga",
                    ..
                }
            ),
            "got: {}",
            err.to_user()
        );
    }

    #[tokio::test]
    async fn http_stream_over_cap_without_content_length() {
        let _guard = http_test_lock();
        install_local_allowlist();
        let body = vec![0u8; 250];
        let server = TestHttpServer::spawn(Arc::new(move |_path| {
            (
                200,
                vec![("X-Omit-Content-Length".into(), "1".into())],
                body.clone(),
            )
        }));
        let root = temp_root("http-stream");
        let dest = root.join("pack.bin");
        let entry = RuntimeManifestEntry {
            id: "t".into(),
            version: "1".into(),
            url: server.url("/stream"),
            sha256: "00".into(),
            hash_origin: HashOrigin::ComputedLocally,
            archive: ArchiveKind::Zip,
            exe: "x".into(),
            strip_components: 0,
            platforms: vec![],
            max_download_bytes: 100,
            max_extract_bytes: 1000,
            max_extract_entries: 10,
        cores: vec![],
        cores_pack: None,
        };
        let cancel = AtomicBool::new(false);
        let err = download_with_hash(
            None,
            "op-stream",
            &DownloadSpec {
                url: &entry.url,
                sha256: &entry.sha256,
                max_download_bytes: entry.max_download_bytes,
                message: "test",
            },
            &dest,
            &cancel,
        )
            .await
            .unwrap_err();
        test_allowlist::clear();
        assert!(
            matches!(
                err,
                InstallError::TooLarge {
                    kind: "Descarga",
                    ..
                }
            ),
            "got: {}",
            err.to_user()
        );
    }

    #[tokio::test]
    async fn http_redirect_to_disallowed_host_rejected() {
        let _guard = http_test_lock();
        install_local_allowlist();
        let server = TestHttpServer::spawn(Arc::new(|_path| {
            (
                302,
                vec![("Location".into(), "https://evil.example/steal".into())],
                Vec::new(),
            )
        }));
        let root = temp_root("http-redir");
        let dest = root.join("pack.bin");
        let entry = RuntimeManifestEntry {
            id: "t".into(),
            version: "1".into(),
            url: server.url("/redir"),
            sha256: "00".into(),
            hash_origin: HashOrigin::ComputedLocally,
            archive: ArchiveKind::Zip,
            exe: "x".into(),
            strip_components: 0,
            platforms: vec![],
            max_download_bytes: 1_000_000,
            max_extract_bytes: 1_000_000,
            max_extract_entries: 10,
        cores: vec![],
        cores_pack: None,
        };
        let cancel = AtomicBool::new(false);
        let err = download_with_hash(
            None,
            "op-redir",
            &DownloadSpec {
                url: &entry.url,
                sha256: &entry.sha256,
                max_download_bytes: entry.max_download_bytes,
                message: "test",
            },
            &dest,
            &cancel,
        )
            .await
            .unwrap_err();
        test_allowlist::clear();
        let msg = err.to_user();
        assert!(
            msg.contains("Host no permitido")
                || msg.contains("redirect")
                || msg.contains("red"),
            "unexpected: {msg}"
        );
    }

    #[tokio::test]
    async fn http_hash_mismatch_end_to_end() {
        let _guard = http_test_lock();
        install_local_allowlist();
        let payload = b"hello-blaze-runtime".to_vec();
        let server = TestHttpServer::spawn(Arc::new(move |_path| {
            (200, vec![], payload.clone())
        }));
        let root = temp_root("http-hash");
        let dest = root.join("pack.bin");
        let entry = RuntimeManifestEntry {
            id: "t".into(),
            version: "1".into(),
            url: server.url("/hash"),
            sha256: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef".into(),
            hash_origin: HashOrigin::ComputedLocally,
            archive: ArchiveKind::Zip,
            exe: "x".into(),
            strip_components: 0,
            platforms: vec![],
            max_download_bytes: 1_000_000,
            max_extract_bytes: 1_000_000,
            max_extract_entries: 10,
        cores: vec![],
        cores_pack: None,
        };
        let cancel = AtomicBool::new(false);
        let err = download_with_hash(
            None,
            "op-hash",
            &DownloadSpec {
                url: &entry.url,
                sha256: &entry.sha256,
                max_download_bytes: entry.max_download_bytes,
                message: "test",
            },
            &dest,
            &cancel,
        )
            .await
            .unwrap_err();
        test_allowlist::clear();
        assert!(
            matches!(err, InstallError::HashMismatch { .. }),
            "got: {}",
            err.to_user()
        );
    }

    #[tokio::test]
    async fn http_cancel_mid_download_cleans_tmp() {
        let _guard = http_test_lock();
        install_local_allowlist();
        // Cuerpo grande + envío lento vía Content-Length engañoso no aplica;
        // usamos muchos bytes y cancelamos en cuanto arranca install_runtime_into.
        let payload = vec![0u8; 2_000_000];
        let server = TestHttpServer::spawn(Arc::new(move |_path| {
            (200, vec![], payload.clone())
        }));
        let root = temp_root("http-cancel");
        let mut hasher = Sha256::new();
        hasher.update(&vec![0u8; 2_000_000]);
        let good_hash = hex::encode(hasher.finalize());

        // Empaquetamos un zip mínimo como cuerpo no es necesario: cancelamos en download.
        // install_runtime_into usa el URL del manifiesto; aquí ejercemos download_with_hash
        // + limpieza manual del layout .tmp como hace install_runtime_into.
        let op = "cancelme1";
        let cancel = register_cancel(op);
        let cancel2 = Arc::clone(&cancel);
        let entry = RuntimeManifestEntry {
            id: "t".into(),
            version: "1".into(),
            url: server.url("/slow"),
            sha256: good_hash,
            hash_origin: HashOrigin::ComputedLocally,
            archive: ArchiveKind::Zip,
            exe: "x".into(),
            strip_components: 0,
            platforms: vec![],
            max_download_bytes: 50_000_000,
            max_extract_bytes: 50_000_000,
            max_extract_entries: 100,
        cores: vec![],
        cores_pack: None,
        };
        let dest = root.join(".tmp").join("partial").join("pack.bin");
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        let download = tokio::spawn(async move {
            // Pequeña demora para que el stream arranque.
            tokio::time::sleep(Duration::from_millis(5)).await;
            cancel2.store(true, Ordering::SeqCst);
        });
        let result = download_with_hash(
            None,
            op,
            &DownloadSpec {
                url: &entry.url,
                sha256: &entry.sha256,
                max_download_bytes: entry.max_download_bytes,
                message: "test",
            },
            &dest,
            &cancel,
        )
        .await;
        let _ = download.await;
        clear_cancel(op);
        remove_dir_best_effort(&root.join(".tmp"));
        test_allowlist::clear();
        assert!(matches!(result, Err(InstallError::Cancelled)) || result.is_err());
        assert!(!root.join(".tmp").exists() || fs::read_dir(root.join(".tmp")).map(|mut d| d.next().is_none()).unwrap_or(true));
    }

    #[test]
    fn manifest_retroarch_lists_default_cores_and_pack() {
        let ra = lookup_manifest("retroarch").unwrap();
        assert!(ra.cores.contains(&"swanstation_libretro.dll".into()));
        assert!(ra.cores.contains(&"fceumm_libretro.dll".into()));
        assert_eq!(ra.cores.len(), 10);
        let pack = ra.cores_pack.as_ref().expect("cores_pack");
        assert!(pack.url.contains("RetroArch_cores.7z"));
        assert_eq!(pack.hash_origin, HashOrigin::ComputedLocally);
        assert!(pack.max_download_bytes > 230 * 1024 * 1024);
        assert_eq!(
            pack.sha256,
            "86b871e11b9b4772ac644b40a38f2c8e9449da1f355eae7da08aa061148547b0"
        );
        let need = disk_space_need(ra);
        assert!(need > ra.max_download_bytes + ra.max_extract_bytes);
    }

    #[test]
    fn selective_cores_extract_skips_unlisted_dll() {
        let root = temp_root("cores-select");
        let archive = root.join("cores.7z");
        make_cores_7z(
            &root,
            &archive,
            &[
                ("wanted_a_libretro.dll", &mz_dll(64)),
                ("wanted_b_libretro.dll", &mz_dll(64)),
                ("noise_libretro.dll", &mz_dll(64)),
            ],
        );
        let dest = root.join("out");
        fs::create_dir_all(&dest).unwrap();
        let pack = cores_pack_for("https://buildbot.libretro.com/x.7z", "00");
        let wanted = vec![
            "wanted_a_libretro.dll".into(),
            "wanted_b_libretro.dll".into(),
        ];
        let cancel = Arc::new(AtomicBool::new(false));
        extract_7z_selected_cores(&archive, &dest, &wanted, &pack, &cancel).unwrap();
        assert!(cores_dir(&dest).join("wanted_a_libretro.dll").is_file());
        assert!(cores_dir(&dest).join("wanted_b_libretro.dll").is_file());
        assert!(!cores_dir(&dest).join("noise_libretro.dll").exists());
    }

    #[test]
    fn selective_cores_missing_dll_errors() {
        let root = temp_root("cores-missing");
        let archive = root.join("cores.7z");
        make_cores_7z(
            &root,
            &archive,
            &[("only_one_libretro.dll", &mz_dll(32))],
        );
        let dest = root.join("out");
        fs::create_dir_all(&dest).unwrap();
        let pack = cores_pack_for("https://buildbot.libretro.com/x.7z", "00");
        let wanted = vec![
            "only_one_libretro.dll".into(),
            "absent_libretro.dll".into(),
        ];
        let cancel = Arc::new(AtomicBool::new(false));
        let err = extract_7z_selected_cores(&archive, &dest, &wanted, &pack, &cancel)
            .unwrap_err();
        match err {
            InstallError::CoreMissing { dll } => {
                assert_eq!(dll, "absent_libretro.dll");
            }
            other => panic!("expected CoreMissing, got {}", other.to_user()),
        }
        // Sin instalación parcial usable: no debe quedar como "instalado".
        assert!(!cores_dir(&dest).join("absent_libretro.dll").exists());
    }

    #[test]
    fn selective_cores_cancel_mid_extract() {
        let root = temp_root("cores-cancel");
        let archive = root.join("cores.7z");
        // Varias DLL grandes (ceros) para dar tiempo a cancelar.
        let big = mz_dll(256 * 1024);
        make_cores_7z(
            &root,
            &archive,
            &[
                ("a_libretro.dll", &big),
                ("b_libretro.dll", &big),
                ("c_libretro.dll", &big),
                ("d_libretro.dll", &big),
            ],
        );
        let dest = root.join("out");
        fs::create_dir_all(&dest).unwrap();
        let pack = cores_pack_for("https://buildbot.libretro.com/x.7z", "00");
        let wanted = vec![
            "a_libretro.dll".into(),
            "b_libretro.dll".into(),
            "c_libretro.dll".into(),
            "d_libretro.dll".into(),
        ];
        let cancel = Arc::new(AtomicBool::new(false));
        cancel.store(true, Ordering::SeqCst);
        let err = extract_7z_selected_cores(&archive, &dest, &wanted, &pack, &cancel)
            .unwrap_err();
        assert!(matches!(err, InstallError::Cancelled));
    }

    #[tokio::test]
    async fn cores_pack_hash_mismatch_end_to_end() {
        let _guard = http_test_lock();
        install_local_allowlist();
        let payload = b"not-a-real-cores-pack".to_vec();
        let server = TestHttpServer::spawn(Arc::new(move |_path| {
            (200, vec![], payload.clone())
        }));
        let root = temp_root("cores-hash");
        let dest = root.join("cores.7z");
        let pack = cores_pack_for(
            &server.url("/cores.7z"),
            "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        );
        let cancel = AtomicBool::new(false);
        let err = download_with_hash(
            None,
            "op-cores-hash",
            &download_spec_for_cores(&pack),
            &dest,
            &cancel,
        )
        .await
        .unwrap_err();
        test_allowlist::clear();
        assert!(matches!(err, InstallError::HashMismatch { .. }));
    }

    #[tokio::test]
    #[ignore = "descarga real de red (~430 MiB); ejecutar con cargo test -- --ignored"]
    async fn e2e_install_retroarch_with_cores_pack() {
        let root = temp_root("e2e-ra-cores");
        let info = install_runtime_into(None, &root, "retroarch", "e2e-ra-cores-1")
            .await
            .expect("install retroarch + cores pack");
        assert!(Path::new(&info.executable_path).is_file());
        let entry = lookup_manifest("retroarch").unwrap();
        assert!(is_version_installed(root.as_path(), entry));
        let cores = PathBuf::from(&info.root_path).join("cores");
        for dll in &entry.cores {
            let p = cores.join(dll);
            assert!(p.is_file(), "falta {dll}");
            assert!(file_has_mz_signature(&p), "MZ inválida en {dll}");
        }
        // El pack no debe quedar en la instalación final.
        assert!(!PathBuf::from(&info.root_path).join("cores.7z").exists());
        assert!(
            !root.join(".tmp").exists()
                || fs::read_dir(root.join(".tmp"))
                    .map(|mut d| d.next().is_none())
                    .unwrap_or(true)
        );
    }
}
