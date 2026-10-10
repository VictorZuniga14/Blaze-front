//! Rutas de datos de emuladores (managed vs manual) y comprobaciones previas al lanzamiento.
//!
//! Evidencia PCSX2 v2.8.2 + `-datapath`:
//! - CLI: `pcsx2-qt/QtHost.cpp` → `QtHost::ParseCommandLineOptions` asigna
//!   `EmuConfig.CustomDataPath` al valor de `-datapath`.
//! - Experimento controlado (pack sha256 `7dfc829c…`, 15 s, sin ISO):
//!   `-datapath <tmp>` crea `<tmp>/PCSX2/{bios,inis,…}` y `inis/PCSX2.ini`.
//!   Por tanto el data root efectivo es `<datapath>/PCSX2`.

use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{path::BaseDirectory, AppHandle, Manager};
use zip::ZipArchive;

pub const MANAGED_DATA_DIR: &str = "emulator-data";

/// Subcarpeta que PCSX2 crea bajo `-datapath` (CustomDataPath).
pub const PCSX2_DATA_SUBDIR: &str = "PCSX2";

/// Igual que `MIN_BIOS_SIZE` / `MAX_BIOS_SIZE` en `pcsx2/ps2/BiosTools.cpp` (v2.8.2).
const BIOS_MIN_BYTES: u64 = 4 * 1024 * 1024;
const BIOS_MAX_BYTES: u64 = 8 * 1024 * 1024;

const PCSX2_INI_SEED: &str = "\
[UI]
SetupWizardIncomplete=false
StartFullscreen=false
";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeDataSource {
    Manual,
    Managed,
}

impl RuntimeDataSource {
    pub fn parse(s: Option<&str>) -> Self {
        match s.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
            Some("managed") => Self::Managed,
            _ => Self::Manual,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedEmulatorPaths {
    /// Valor para `-datapath` (PCSX2) o directorio base RA managed.
    pub blaze_managed_root: Option<PathBuf>,
    /// Raíz efectiva de datos PCSX2 (`…/PCSX2` bajo managed, o documentos/manual).
    pub pcsx2_data_root: Option<PathBuf>,
    pub retroarch_cfg: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLaunchPlan {
    pub arguments: Vec<String>,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug)]
pub enum LaunchPrepError {
    BiosMissing { bios_dir: PathBuf },
    KeysMissing { keys_dir: PathBuf },
    FirmwareMissing { firmware_dir: PathBuf },
    Io(String),
}

impl LaunchPrepError {
    pub fn into_launch_plan(self) -> RuntimeLaunchPlan {
        match self {
            Self::BiosMissing { bios_dir } => RuntimeLaunchPlan {
                arguments: vec![],
                error: Some(format!(
                    "No hay BIOS de PS2 en {}. El instalador debería incluirla; si falta, pegá un dump en esa carpeta o reinstalá Blaze.",
                    bios_dir.display()
                )),
                error_code: Some("BiosMissing".to_string()),
            },
            Self::KeysMissing { keys_dir } => RuntimeLaunchPlan {
                arguments: vec![],
                error: Some(format!(
                    "Faltan keys de Switch (prod.keys) en {}. Abrí la carpeta desde Configuración y pegá tus keys; Blaze no las redistribuye.",
                    keys_dir.display()
                )),
                error_code: Some("KeysMissing".to_string()),
            },
            Self::FirmwareMissing { firmware_dir } => RuntimeLaunchPlan {
                arguments: vec![],
                error: Some(format!(
                    "Falta firmware de Switch en {}. Importalo desde Configuración (zip .nca); Blaze no lo incluye en el instalador.",
                    firmware_dir.display()
                )),
                error_code: Some("FirmwareMissing".to_string()),
            },
            Self::Io(m) => RuntimeLaunchPlan {
                arguments: vec![],
                error: Some(format!("Error preparando datos del emulador: {m}")),
                error_code: Some("Io".to_string()),
            },
        }
    }
}

pub fn managed_data_root(app_data: &Path, emulator_kind: &str) -> PathBuf {
    app_data.join(MANAGED_DATA_DIR).join(emulator_kind)
}

pub fn pcsx2_datapath_for_managed(managed_root: &Path) -> PathBuf {
    managed_root.to_path_buf()
}

pub fn pcsx2_internal_data_root(datapath: &Path) -> PathBuf {
    datapath.join(PCSX2_DATA_SUBDIR)
}

fn resolve_pcsx2_data_root_manual(exe: &Path) -> Option<PathBuf> {
    let exe_dir = exe.parent()?;
    if exe_dir.join("portable.txt").is_file() || exe_dir.join("portable.ini").is_file() {
        return Some(exe_dir.to_path_buf());
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(docs) = dirs::document_dir() {
        candidates.push(docs.join("PCSX2"));
    }
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Documents").join("PCSX2"));
        candidates.push(home.join("Documentos").join("PCSX2"));
        candidates.push(home.join("OneDrive").join("Documents").join("PCSX2"));
        candidates.push(home.join("OneDrive").join("Documentos").join("PCSX2"));
    }

    for candidate in candidates {
        if candidate.join("inis").join("PCSX2.ini").is_file() {
            return Some(candidate);
        }
    }

    dirs::document_dir().map(|d| d.join("PCSX2"))
}

fn resolve_retroarch_cfg_manual(exe: &Path) -> Option<PathBuf> {
    let exe_dir = exe.parent()?;
    let next_to_exe = exe_dir.join("retroarch.cfg");
    if next_to_exe.is_file() {
        return Some(next_to_exe);
    }
    if let Some(roaming) = dirs::config_dir() {
        let candidate = roaming.join("RetroArch").join("retroarch.cfg");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Some(home) = dirs::home_dir() {
        let candidate = home
            .join("AppData")
            .join("Roaming")
            .join("RetroArch")
            .join("retroarch.cfg");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    Some(next_to_exe)
}

/// Única resolución de rutas de datos por fuente y tipo de emulador.
pub fn resolve_emulator_paths(
    app_data: Option<&Path>,
    source: RuntimeDataSource,
    emulator_kind: &str,
    exe: &Path,
) -> ResolvedEmulatorPaths {
    if source == RuntimeDataSource::Managed {
        let app = app_data.unwrap_or_else(|| Path::new(""));
        let managed = managed_data_root(app, emulator_kind);
        match emulator_kind {
            "pcsx2" => {
                let datapath = pcsx2_datapath_for_managed(&managed);
                let internal = pcsx2_internal_data_root(&datapath);
                ResolvedEmulatorPaths {
                    blaze_managed_root: Some(datapath),
                    pcsx2_data_root: Some(internal),
                    retroarch_cfg: None,
                }
            }
            "retroarch" => ResolvedEmulatorPaths {
                blaze_managed_root: Some(managed.clone()),
                pcsx2_data_root: None,
                retroarch_cfg: Some(managed.join("retroarch.cfg")),
            },
            "eden" => ResolvedEmulatorPaths {
                blaze_managed_root: Some(managed),
                pcsx2_data_root: None,
                retroarch_cfg: None,
            },
            _ => ResolvedEmulatorPaths {
                blaze_managed_root: Some(managed),
                pcsx2_data_root: None,
                retroarch_cfg: None,
            },
        }
    } else {
        match emulator_kind {
            "pcsx2" => ResolvedEmulatorPaths {
                blaze_managed_root: None,
                pcsx2_data_root: resolve_pcsx2_data_root_manual(exe),
                retroarch_cfg: None,
            },
            "retroarch" => ResolvedEmulatorPaths {
                blaze_managed_root: None,
                pcsx2_data_root: None,
                retroarch_cfg: resolve_retroarch_cfg_manual(exe),
            },
            "eden" => ResolvedEmulatorPaths {
                blaze_managed_root: exe.parent().map(|p| p.join("user")),
                pcsx2_data_root: None,
                retroarch_cfg: None,
            },
            _ => ResolvedEmulatorPaths {
                blaze_managed_root: None,
                pcsx2_data_root: None,
                retroarch_cfg: None,
            },
        }
    }
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), LaunchPrepError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| LaunchPrepError::Io(e.to_string()))?;
    }
    let tmp = path.with_file_name(format!(
        ".{}.blaze-seed.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
    ));
    {
        let mut f = File::create(&tmp).map_err(|e| LaunchPrepError::Io(e.to_string()))?;
        f.write_all(contents.as_bytes())
            .map_err(|e| LaunchPrepError::Io(e.to_string()))?;
        f.flush()
            .map_err(|e| LaunchPrepError::Io(e.to_string()))?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        LaunchPrepError::Io(e.to_string())
    })?;
    Ok(())
}

/// Siembra `PCSX2.ini` mínimo solo si no existe (managed).
pub fn seed_pcsx2_ini_if_missing(data_root: &Path) -> Result<(), LaunchPrepError> {
    let ini = data_root.join("inis").join("PCSX2.ini");
    if ini.is_file() {
        return Ok(());
    }
    fs::create_dir_all(data_root.join("bios")).map_err(|e| LaunchPrepError::Io(e.to_string()))?;
    write_atomic(&ini, PCSX2_INI_SEED)
}

fn retroarch_cfg_seed(root: &Path) -> String {
    let save = root.join("saves");
    let states = root.join("states");
    let system = root.join("system");
    let assets = root.join("assets");
    format!(
        "config_save_on_exit = \"true\"\n\
         savefile_directory = \"{}\"\n\
         savestate_directory = \"{}\"\n\
         system_directory = \"{}\"\n\
         core_assets_directory = \"{}\"\n",
        save.display(),
        states.display(),
        system.display(),
        assets.display()
    )
}

/// Siembra `retroarch.cfg` mínimo solo si no existe (managed). Sin claves cheevos_* ni libretro_directory.
pub fn seed_retroarch_cfg_if_missing(managed_root: &Path) -> Result<(), LaunchPrepError> {
    let cfg = managed_root.join("retroarch.cfg");
    if cfg.is_file() {
        return Ok(());
    }
    for sub in ["saves", "states", "system", "assets"] {
        fs::create_dir_all(managed_root.join(sub))
            .map_err(|e| LaunchPrepError::Io(e.to_string()))?;
    }
    write_atomic(&cfg, &retroarch_cfg_seed(managed_root))
}

pub fn ensure_managed_data_layout(
    source: RuntimeDataSource,
    emulator_kind: &str,
    paths: &ResolvedEmulatorPaths,
) -> Result<(), LaunchPrepError> {
    if source != RuntimeDataSource::Managed {
        return Ok(());
    }
    match emulator_kind {
        "pcsx2" => {
            if let Some(root) = paths.pcsx2_data_root.as_ref() {
                seed_pcsx2_ini_if_missing(root)?;
            }
        }
        "retroarch" => {
            if let Some(cfg) = paths.retroarch_cfg.as_ref() {
                if let Some(root) = cfg.parent() {
                    seed_retroarch_cfg_if_missing(root)?;
                }
            }
        }
        "eden" => {
            if let Some(root) = paths.blaze_managed_root.as_ref() {
                seed_eden_managed_layout(root)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn eden_keys_dir(managed_root: &Path) -> PathBuf {
    managed_root.join("keys")
}

pub fn eden_firmware_registered_dir(managed_root: &Path) -> PathBuf {
    managed_root
        .join("nand")
        .join("system")
        .join("Contents")
        .join("registered")
}

pub fn seed_eden_managed_layout(managed_root: &Path) -> Result<(), LaunchPrepError> {
    fs::create_dir_all(eden_keys_dir(managed_root))
        .map_err(|e| LaunchPrepError::Io(e.to_string()))?;
    fs::create_dir_all(eden_firmware_registered_dir(managed_root))
        .map_err(|e| LaunchPrepError::Io(e.to_string()))?;
    Ok(())
}

pub fn has_eden_prod_keys(keys_dir: &Path) -> bool {
    let prod = keys_dir.join("prod.keys");
    prod.is_file()
        && fs::metadata(&prod)
            .map(|m| m.len() > 32)
            .unwrap_or(false)
}

pub fn has_eden_firmware(registered_dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(registered_dir) else {
        return false;
    };
    entries.flatten().any(|e| {
        e.path()
            .extension()
            .and_then(|x| x.to_str())
            .map(|x| x.eq_ignore_ascii_case("nca"))
            .unwrap_or(false)
    })
}

pub fn ensure_eden_keys_for_launch(managed_root: &Path) -> Result<(), LaunchPrepError> {
    let keys_dir = eden_keys_dir(managed_root);
    fs::create_dir_all(&keys_dir).map_err(|e| LaunchPrepError::Io(e.to_string()))?;
    if has_eden_prod_keys(&keys_dir) {
        Ok(())
    } else {
        Err(LaunchPrepError::KeysMissing { keys_dir })
    }
}

pub fn ensure_eden_firmware_for_launch(managed_root: &Path) -> Result<(), LaunchPrepError> {
    let fw = eden_firmware_registered_dir(managed_root);
    fs::create_dir_all(&fw).map_err(|e| LaunchPrepError::Io(e.to_string()))?;
    if has_eden_firmware(&fw) {
        Ok(())
    } else {
        Err(LaunchPrepError::FirmwareMissing { firmware_dir: fw })
    }
}

/// Eden portable: `user/` junto al exe tiene prioridad sobre %AppData%.
/// Sincroniza keys + firmware managed → `<exe_dir>/user/`.
pub fn sync_eden_portable_user(
    exe: &Path,
    managed_root: &Path,
) -> Result<PathBuf, LaunchPrepError> {
    let exe_dir = exe
        .parent()
        .ok_or_else(|| LaunchPrepError::Io("Ruta de Eden inválida".into()))?;
    let user_dir = exe_dir.join("user");
    seed_eden_managed_layout(managed_root)?;
    fs::create_dir_all(&user_dir).map_err(|e| LaunchPrepError::Io(e.to_string()))?;

    let keys_src = eden_keys_dir(managed_root);
    let keys_dst = user_dir.join("keys");
    copy_directory_missing_only(&keys_src, &keys_dst)
        .map_err(LaunchPrepError::Io)?;

    let nand_src = managed_root.join("nand");
    let nand_dst = user_dir.join("nand");
    if nand_src.is_dir() {
        copy_directory_missing_only(&nand_src, &nand_dst).map_err(LaunchPrepError::Io)?;
    }
    Ok(user_dir)
}

/// Réplica de `IsBIOS` → `LoadBiosVersion` en `pcsx2/ps2/BiosTools.cpp` (v2.8.2):
/// localiza la tabla ROMDIR (entrada `RESET`) y exige una entrada `ROMVER` legible.
fn romdir_name_eq(name: &[u8; 10], expected: &[u8]) -> bool {
    let mut buf = [0u8; 10];
    let n = expected.len().min(10);
    buf[..n].copy_from_slice(&expected[..n]);
    name == &buf
}

fn load_bios_version_faithful(data: &[u8]) -> bool {
    const ENTRY_SIZE: usize = 16;
    let max_scan = (512 * 1024).min(data.len() / ENTRY_SIZE);
    let mut reset_at: Option<usize> = None;
    for i in 0..max_scan {
        let off = i * ENTRY_SIZE;
        let mut name = [0u8; 10];
        name.copy_from_slice(&data[off..off + 10]);
        if romdir_name_eq(&name, b"RESET") {
            reset_at = Some(off);
            break;
        }
    }
    let Some(mut off) = reset_at else {
        return false;
    };

    let mut file_offset: u64 = 0;
    loop {
        if off + ENTRY_SIZE > data.len() {
            return false;
        }
        let mut name = [0u8; 10];
        name.copy_from_slice(&data[off..off + 10]);
        let file_size = u32::from_le_bytes(data[off + 12..off + 16].try_into().unwrap());
        off += ENTRY_SIZE;

        // while (rd.fileName[0] != '\0' && strnlen(rd.fileName, 10) != 10)
        if name[0] == 0 || !name.contains(&0) {
            return false;
        }

        if romdir_name_eq(&name, b"ROMVER") {
            let start = file_offset as usize;
            return start + 14 <= data.len();
        }

        if file_size % 0x10 == 0 {
            file_offset += file_size as u64;
        } else {
            file_offset += (file_size as u64 + 0x10) & !0xfu64;
        }
    }
}

pub fn is_valid_pcsx2_bios_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    let len = meta.len();
    // Filtro barato (FindBiosImage en BiosTools.cpp).
    if !(BIOS_MIN_BYTES..=BIOS_MAX_BYTES).contains(&len) {
        return false;
    }
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    // Lectura completa acotada (máx. 8 MiB).
    let mut buf = Vec::with_capacity(len as usize);
    if file.read_to_end(&mut buf).is_err() {
        return false;
    }
    load_bios_version_faithful(&buf)
}

pub fn pcsx2_bios_directory(data_root: &Path) -> PathBuf {
    data_root.join("bios")
}

pub fn find_valid_pcsx2_bios(bios_dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(bios_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && is_valid_pcsx2_bios_file(&path) {
            return Some(path);
        }
    }
    None
}

pub fn ensure_pcsx2_bios_for_launch(data_root: &Path) -> Result<(), LaunchPrepError> {
    let bios_dir = pcsx2_bios_directory(data_root);
    if find_valid_pcsx2_bios(&bios_dir).is_some() {
        Ok(())
    } else {
        Err(LaunchPrepError::BiosMissing { bios_dir })
    }
}

fn eden_launch_arguments(
    managed: &Path,
    content_path: &str,
    start_fullscreen: bool,
) -> Result<Vec<String>, LaunchPrepError> {
    ensure_eden_keys_for_launch(managed)?;
    ensure_eden_firmware_for_launch(managed)?;
    // Flags Eden/yuzu: -f fullscreen, -g game path.
    let mut args = Vec::new();
    if start_fullscreen {
        args.push("-f".to_string());
    }
    args.push("-g".to_string());
    args.push(content_path.to_string());
    Ok(args)
}

pub fn build_managed_launch_arguments(
    source: RuntimeDataSource,
    emulator_kind: &str,
    paths: &ResolvedEmulatorPaths,
    base_arguments: &[String],
    content_path: &str,
    start_fullscreen: bool,
) -> Result<Vec<String>, LaunchPrepError> {
    // Eden: keys/firmware viven en emulator-data/eden aunque el exe sea manual (Escritorio).
    if emulator_kind == "eden" {
        if let Some(managed) = paths.blaze_managed_root.as_ref() {
            seed_eden_managed_layout(managed)?;
            return eden_launch_arguments(managed, content_path, start_fullscreen);
        }
    }

    if source != RuntimeDataSource::Managed {
        let mut args = base_arguments.to_vec();
        args.push(content_path.to_string());
        return Ok(args);
    }

    ensure_managed_data_layout(source, emulator_kind, paths)?;

    match emulator_kind {
        "pcsx2" => {
            let datapath = paths
                .blaze_managed_root
                .as_ref()
                .expect("managed pcsx2 datapath");
            let internal = paths
                .pcsx2_data_root
                .as_ref()
                .expect("managed pcsx2 internal data root");
            ensure_pcsx2_bios_for_launch(internal)?;

            let mut args = vec![
                "-datapath".to_string(),
                datapath.to_string_lossy().to_string(),
                "-fastboot".to_string(),
            ];
            if start_fullscreen {
                args.push("-fullscreen".to_string());
            }
            args.push(content_path.to_string());
            Ok(args)
        }
        "retroarch" => {
            let cfg = paths
                .retroarch_cfg
                .as_ref()
                .expect("managed retroarch cfg path");
            let mut args = vec!["-c".to_string(), cfg.to_string_lossy().to_string()];
            args.extend(base_arguments.iter().cloned());
            args.push(content_path.to_string());
            Ok(args)
        }
        "eden" => {
            let managed = paths
                .blaze_managed_root
                .as_ref()
                .expect("managed eden root");
            eden_launch_arguments(managed, content_path, start_fullscreen)
        }
        _ => {
            let mut args = base_arguments.to_vec();
            args.push(content_path.to_string());
            Ok(args)
        }
    }
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn prepare_runtime_launch(
    app: AppHandle,
    runtime_source: Option<String>,
    runtime_type: Option<String>,
    executable_path: String,
    content_path: String,
    base_arguments: Vec<String>,
    start_fullscreen: Option<bool>,
) -> RuntimeLaunchPlan {
    let exe = PathBuf::from(&executable_path);
    let kind = crate::ra_status::detect_kind(&exe);
    if kind == "unknown" {
        let mut args = base_arguments;
        args.push(content_path);
        return RuntimeLaunchPlan {
            arguments: args,
            error: None,
            error_code: None,
        };
    }

    let source = RuntimeDataSource::parse(runtime_source.as_deref());
    let app_data = app_data_dir(&app).ok();
    let type_key = if kind == "eden" {
        "eden"
    } else {
        runtime_type.as_deref().unwrap_or(kind)
    };
    // Eden siempre usa keys/firmware managed de Blaze (aunque el runtime sea manual).
    let paths = if type_key == "eden" {
        if let Some(app) = app_data.as_deref() {
            let managed = managed_data_root(app, "eden");
            ResolvedEmulatorPaths {
                blaze_managed_root: Some(managed),
                pcsx2_data_root: None,
                retroarch_cfg: None,
            }
        } else {
            resolve_emulator_paths(None, source, type_key, &exe)
        }
    } else {
        resolve_emulator_paths(app_data.as_deref(), source, type_key, &exe)
    };

    if type_key == "eden" {
        if let Some(managed) = paths.blaze_managed_root.as_ref() {
            if let Err(e) = sync_eden_portable_user(&exe, managed) {
                return e.into_launch_plan();
            }
        }
    }

    // PCSX2 managed: sembrar BIOS del instalador antes de validar.
    if source == RuntimeDataSource::Managed && type_key == "pcsx2" {
        if let Some(internal) = paths.pcsx2_data_root.as_ref() {
            let bios_dir = pcsx2_bios_directory(internal);
            let _ = seed_bundled_directory_if_available(
                &app,
                &["resources/pcsx2/bios", "pcsx2/bios"],
                &bios_dir,
            );
        }
    }

    match build_managed_launch_arguments(
        source,
        type_key,
        &paths,
        &base_arguments,
        &content_path,
        start_fullscreen.unwrap_or(true),
    ) {
        Ok(arguments) => RuntimeLaunchPlan {
            arguments,
            error: None,
            error_code: None,
        },
        Err(e) => e.into_launch_plan(),
    }
}

#[tauri::command]
pub fn open_managed_pcsx2_bios_folder(app: AppHandle) -> Result<String, String> {
    let app_data = app_data_dir(&app)?;
    let datapath = managed_data_root(&app_data, "pcsx2");
    let data_root = pcsx2_internal_data_root(&datapath);
    let bios_dir = pcsx2_bios_directory(&data_root);
    fs::create_dir_all(&bios_dir).map_err(|e| e.to_string())?;
    // No siembra ini aquí: solo abre la carpeta para que el usuario deposite BIOS.
    #[cfg(windows)]
    open_folder_windows(&bios_dir)?;
    #[cfg(not(windows))]
    {
        return Err("Abrir carpeta de BIOS solo está implementado en Windows.".into());
    }
    Ok(bios_dir.to_string_lossy().to_string())
}


/// Busca recursos incluidos en el paquete de Blaze.
/// También contempla la ruta del proyecto durante el desarrollo.
fn resolve_bundled_resource_dir(
    app: &AppHandle,
    relative_paths: &[&str],
) -> Option<PathBuf> {
    for relative in relative_paths {
        // Recursos de la aplicación compilada.
        if let Ok(path) = app.path().resolve(relative, BaseDirectory::Resource) {
            if path.is_dir() {
                return Some(path);
            }
        }

        // Recursos locales durante `tauri dev` / desarrollo.
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(relative);

        if dev_path.is_dir() {
            return Some(dev_path);
        }
    }

    None
}

/// Copia un árbol de recursos sin sobrescribir ningún archivo existente.
/// Ignora enlaces simbólicos y solo copia archivos y directorios normales.
fn copy_directory_missing_only(
    source: &Path,
    destination: &Path,
) -> Result<(), String> {
    if !source.is_dir() {
        return Ok(());
    }

    fs::create_dir_all(destination).map_err(|e| {
        format!(
            "No se pudo crear {}: {e}",
            destination.display()
        )
    })?;

    let entries = fs::read_dir(source).map_err(|e| {
        format!(
            "No se pudo leer {}: {e}",
            source.display()
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;

        // No seguir enlaces simbólicos.
        if file_type.is_symlink() {
            continue;
        }

        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());

        if file_type.is_dir() {
            copy_directory_missing_only(
                &source_path,
                &destination_path,
            )?;
        } else if file_type.is_file() {
            // Mantener intactos los archivos que ya existen.
            if destination_path.exists() {
                continue;
            }

            if let Some(parent) = destination_path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!(
                        "No se pudo crear {}: {e}",
                        parent.display()
                    )
                })?;
            }

            fs::copy(&source_path, &destination_path).map_err(|e| {
                format!(
                    "No se pudo copiar {} a {}: {e}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        }
    }

    Ok(())
}

/// Copia recursos empaquetados a una carpeta administrada por Blaze.
/// Si el recurso no existe en el paquete, no hace nada.
fn seed_bundled_directory_if_available(
    app: &AppHandle,
    resource_paths: &[&str],
    destination: &Path,
) -> Result<(), String> {
    if let Some(source) =
        resolve_bundled_resource_dir(app, resource_paths)
    {
        copy_directory_missing_only(&source, destination)?;
    }

    Ok(())
}

/// Estado de inicialización de los datos administrados por Blaze.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorSetupStatus {
    pub pcsx2_bios_dir: String,
    pub pcsx2_bios_found: bool,
    pub retroarch_system_dir: String,
    pub eden_keys_dir: String,
    pub eden_keys_found: bool,
    pub eden_firmware_found: bool,
}

/// Crea y prepara los datos administrados de PCSX2 y RetroArch.
/// Copia los recursos disponibles sin sobrescribir archivos existentes.
/// No descarga BIOS.
#[tauri::command]
pub fn initialize_emulator_data(
    app: AppHandle,
) -> Result<EmulatorSetupStatus, String> {
    let app_data = app_data_dir(&app)?;

    // ---------------------------------------------------------
    // PCSX2
    // ---------------------------------------------------------

    // PCSX2 recibe -datapath apuntando a emulator-data/pcsx2.
    // Su carpeta interna real es emulator-data/pcsx2/PCSX2.
    let pcsx2_managed = managed_data_root(&app_data, "pcsx2");
    let pcsx2_root = pcsx2_internal_data_root(&pcsx2_managed);

    // Crear la estructura base y el INI solo si no existen.
    seed_pcsx2_ini_if_missing(&pcsx2_root)
        .map_err(|e| {
            format!("Error preparando PCSX2: {:?}", e)
        })?;

    let bios_dir = pcsx2_bios_directory(&pcsx2_root);

    fs::create_dir_all(&bios_dir).map_err(|e| {
        format!(
            "No se pudo crear la carpeta BIOS de PCSX2: {e}"
        )
    })?;

    // BIOS PS2: embebida en el instalador (resources/pcsx2/bios vía vendor bios.7z).
    // Se copia una vez a AppData; no sobrescribe dumps ya presentes.
    seed_bundled_directory_if_available(
        &app,
        &[
            "resources/pcsx2/bios",
            "pcsx2/bios",
        ],
        &bios_dir,
    )
    .map_err(|e| {
        format!("Error copiando recursos de PCSX2: {e}")
    })?;

    // ---------------------------------------------------------
    // RetroArch
    // ---------------------------------------------------------

    let retroarch_root =
        managed_data_root(&app_data, "retroarch");

    // Crear retroarch.cfg y sus carpetas solo si hace falta.
    seed_retroarch_cfg_if_missing(&retroarch_root)
        .map_err(|e| {
            format!("Error preparando RetroArch: {:?}", e)
        })?;

    let system_dir = retroarch_root.join("system");

    fs::create_dir_all(&system_dir).map_err(|e| {
        format!(
            "No se pudo crear la carpeta system de RetroArch: {e}"
        )
    })?;

    // Firmware/BIOS de consolas (p. ej. SCPH*.bin): mismo criterio que PS2.
    // No van en el instalador público; seed opcional solo si existen en resources/.
    seed_bundled_directory_if_available(
        &app,
        &[
            "resources/retroarch/system",
            "retroarch/system",
        ],
        &system_dir,
    )
    .map_err(|e| {
        format!("Error copiando recursos de RetroArch: {e}")
    })?;

    // Detectar BIOS válida de PS2. La inicialización no falla
    // simplemente porque todavía no se haya instalado una BIOS.
    let bios_found =
        find_valid_pcsx2_bios(&bios_dir).is_some();

    // ---------------------------------------------------------
    // Eden (Nintendo Switch)
    // ---------------------------------------------------------
    let eden_root = managed_data_root(&app_data, "eden");
    seed_eden_managed_layout(&eden_root).map_err(|e| {
        format!("Error preparando Eden: {:?}", e)
    })?;
    let eden_keys = eden_keys_dir(&eden_root);
    let eden_fw = eden_firmware_registered_dir(&eden_root);
    // Keys/firmware Switch: NO en instalador público. Seed opcional solo builds privadas.
    seed_bundled_directory_if_available(
        &app,
        &["resources/eden/keys", "eden/keys"],
        &eden_keys,
    )
    .map_err(|e| format!("Error copiando keys Eden: {e}"))?;
    seed_bundled_directory_if_available(
        &app,
        &[
            "resources/eden/nand/system/Contents/registered",
            "eden/nand/system/Contents/registered",
        ],
        &eden_fw,
    )
    .map_err(|e| format!("Error copiando firmware Eden: {e}"))?;

    Ok(EmulatorSetupStatus {
        pcsx2_bios_dir: bios_dir.to_string_lossy().into_owned(),
        pcsx2_bios_found: bios_found,
        retroarch_system_dir: system_dir.to_string_lossy().into_owned(),
        eden_keys_dir: eden_keys.to_string_lossy().into_owned(),
        eden_keys_found: has_eden_prod_keys(&eden_keys),
        eden_firmware_found: has_eden_firmware(&eden_fw),
    })
}

fn open_folder_windows(dir: &Path) -> Result<(), String> {
    // `explorer <path>` a veces tumba el proceso padre en Tauri/dev.
    // `cmd /C start "" <path>` abre Explorer desacoplado.
    let path = dir.to_string_lossy().to_string();
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn()
        .map_err(|e| format!("No se pudo abrir la carpeta: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_managed_eden_keys_folder(app: AppHandle) -> Result<String, String> {
    let app_data = app_data_dir(&app)?;
    let managed = managed_data_root(&app_data, "eden");
    seed_eden_managed_layout(&managed).map_err(|e| format!("{e:?}"))?;
    let keys_dir = eden_keys_dir(&managed);
    fs::create_dir_all(&keys_dir).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    open_folder_windows(&keys_dir)?;
    #[cfg(not(windows))]
    {
        return Err("Abrir carpeta de keys solo está implementado en Windows.".into());
    }
    Ok(keys_dir.to_string_lossy().to_string())
}

fn import_eden_firmware_zip_sync(managed: &Path, zip_path: &Path) -> Result<String, String> {
    seed_eden_managed_layout(managed).map_err(|e| format!("{e:?}"))?;
    let dest = eden_firmware_registered_dir(managed);
    if !zip_path.is_file() {
        return Err("El archivo zip de firmware no existe.".into());
    }

    let file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut imported = 0usize;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let file_name = name
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if !file_name.to_ascii_lowercase().ends_with(".nca") {
            continue;
        }
        let out_path = dest.join(&file_name);
        if out_path.exists() {
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        imported += 1;
    }
    if imported == 0 && !has_eden_firmware(&dest) {
        return Err(
            "No se encontraron archivos .nca en el zip (¿firmware Switch válido?).".into(),
        );
    }
    Ok(format!(
        "Firmware OK ({imported} archivos) en {}",
        dest.display()
    ))
}

/// Extrae un zip de firmware Switch (`.nca`) a la NAND managed (fuera del hilo UI).
#[tauri::command]
pub async fn import_eden_firmware_zip(
    app: AppHandle,
    zip_path: String,
) -> Result<String, String> {
    let app_data = app_data_dir(&app)?;
    let managed = managed_data_root(&app_data, "eden");
    let zip_file = PathBuf::from(zip_path);
    tokio::task::spawn_blocking(move || import_eden_firmware_zip_sync(&managed, &zip_file))
        .await
        .map_err(|e| format!("Importación cancelada: {e}"))?
}

fn try_eden_install_one(eden_exe: &Path, nsp: &Path) -> Result<(), String> {
    let nsp_s = nsp.to_string_lossy().to_string();
    let cli = eden_exe
        .parent()
        .map(|d| d.join("eden-cli.exe"))
        .filter(|p| p.is_file());

    let mut attempts: Vec<(PathBuf, Vec<String>)> = Vec::new();
    // Flags comunes en forks yuzu/Eden (si el build no los tiene, fallan y seguimos).
    attempts.push((
        eden_exe.to_path_buf(),
        vec!["--install".into(), nsp_s.clone()],
    ));
    attempts.push((eden_exe.to_path_buf(), vec!["-i".into(), nsp_s.clone()]));
    if let Some(cli) = cli {
        attempts.push((cli.clone(), vec!["--install".into(), nsp_s.clone()]));
        attempts.push((cli, vec!["-i".into(), nsp_s]));
    }

    let mut last_err = String::from("sin intento");
    for (exe, args) in attempts {
        match std::process::Command::new(&exe).args(&args).status() {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) => {
                last_err = format!("{} {:?} → exit {status}", exe.display(), args);
            }
            Err(e) => {
                last_err = format!("{} {:?} → {e}", exe.display(), args);
            }
        }
    }
    Err(last_err)
}

/// Instala update/DLC (.nsp) en Eden (keys managed + portable sync). Best-effort por CLI.
#[tauri::command]
pub async fn install_eden_title_nsps(
    app: AppHandle,
    eden_executable: String,
    nsp_paths: Vec<String>,
) -> Result<String, String> {
    let app_data = app_data_dir(&app)?;
    let managed = managed_data_root(&app_data, "eden");
    let exe = PathBuf::from(eden_executable);
    if !exe.is_file() {
        return Err("No se encontró eden.exe para instalar update/DLC.".into());
    }
    if nsp_paths.is_empty() {
        return Ok("Sin update/DLC para instalar.".into());
    }

    tokio::task::spawn_blocking(move || {
        seed_eden_managed_layout(&managed).map_err(|e| format!("{e:?}"))?;
        ensure_eden_keys_for_launch(&managed).map_err(|e| format!("{e:?}"))?;
        ensure_eden_firmware_for_launch(&managed).map_err(|e| format!("{e:?}"))?;
        sync_eden_portable_user(&exe, &managed).map_err(|e| format!("{e:?}"))?;

        let pending_dir = managed.join("pending-nsp");
        fs::create_dir_all(&pending_dir).map_err(|e| e.to_string())?;

        let mut ok = 0usize;
        let mut fail = 0usize;
        let mut notes: Vec<String> = Vec::new();

        for raw in &nsp_paths {
            let src = PathBuf::from(raw);
            if !src.is_file() {
                fail += 1;
                notes.push(format!("faltante: {raw}"));
                continue;
            }
            let name = src
                .file_name()
                .map(|n| n.to_os_string())
                .unwrap_or_default();
            let staged = pending_dir.join(&name);
            if !staged.exists() {
                fs::copy(&src, &staged).map_err(|e| {
                    format!("No se pudo copiar {} a pending: {e}", src.display())
                })?;
            }
            let marker = pending_dir.join(format!(
                ".installed-{}",
                name.to_string_lossy().replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_")
            ));
            if marker.is_file() {
                ok += 1;
                continue;
            }
            match try_eden_install_one(&exe, &staged) {
                Ok(()) => {
                    let _ = fs::write(&marker, b"ok");
                    ok += 1;
                }
                Err(e) => {
                    fail += 1;
                    notes.push(format!("{}: {e}", name.to_string_lossy()));
                }
            }
        }

        if ok == 0 && fail > 0 {
            return Err(format!(
                "Eden no aceptó instalar los NSP por CLI ({}). Quedaron en {} — abrí Eden → Archivo → Instalar archivos.",
                notes.join(" | "),
                pending_dir.display()
            ));
        }
        if fail > 0 {
            return Ok(format!(
                "Instalados {ok}; {fail} pendientes en {} (Eden → Archivo → Instalar archivos). {}",
                pending_dir.display(),
                notes.join(" | ")
            ));
        }
        Ok(format!("Update/DLC instalados en Eden ({ok})."))
    })
    .await
    .map_err(|e| format!("Instalación cancelada: {e}"))?
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRaCredentialsResult {
    pub retroarch: bool,
    pub pcsx2: bool,
}

fn escape_retroarch_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Upsert `key = "value"` en un retroarch.cfg (preserva el resto).
fn upsert_retroarch_cfg_keys(content: &str, updates: &[(&str, &str)]) -> String {
    let mut seen = std::collections::HashSet::<String>::new();
    let mut out = String::new();
    for line in content.lines() {
        let trimmed = line.trim();
        let mut replaced = false;
        if let Some((raw_k, _)) = trimmed.split_once('=') {
            let key = raw_k.trim();
            for (k, v) in updates {
                if key.eq_ignore_ascii_case(k) {
                    out.push_str(k);
                    out.push_str(" = \"");
                    out.push_str(&escape_retroarch_value(v));
                    out.push_str("\"\n");
                    seen.insert(k.to_ascii_lowercase());
                    replaced = true;
                    break;
                }
            }
        }
        if !replaced {
            out.push_str(line);
            out.push('\n');
        }
    }
    for (k, v) in updates {
        if !seen.contains(&k.to_ascii_lowercase()) {
            out.push_str(k);
            out.push_str(" = \"");
            out.push_str(&escape_retroarch_value(v));
            out.push_str("\"\n");
        }
    }
    out
}

/// Upsert claves dentro de una sección INI `[Section]`.
fn upsert_ini_section_keys(content: &str, section: &str, updates: &[(&str, &str)]) -> String {
    let section_header = format!("[{section}]");
    let mut out = String::new();
    let mut in_section = false;
    let mut section_seen = false;
    let mut seen = std::collections::HashSet::<String>::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if in_section {
                for (k, v) in updates {
                    if !seen.contains(&k.to_ascii_lowercase()) {
                        out.push_str(k);
                        out.push('=');
                        out.push_str(v);
                        out.push('\n');
                        seen.insert(k.to_ascii_lowercase());
                    }
                }
            }
            in_section = trimmed.eq_ignore_ascii_case(&section_header);
            if in_section {
                section_seen = true;
                seen.clear();
            }
            out.push_str(line);
            out.push('\n');
            continue;
        }
        if in_section {
            if let Some((raw_k, _)) = trimmed.split_once('=') {
                let key = raw_k.trim();
                let mut replaced = false;
                for (k, v) in updates {
                    if key.eq_ignore_ascii_case(k) {
                        out.push_str(k);
                        out.push('=');
                        out.push_str(v);
                        out.push('\n');
                        seen.insert(k.to_ascii_lowercase());
                        replaced = true;
                        break;
                    }
                }
                if replaced {
                    continue;
                }
            }
        }
        out.push_str(line);
        out.push('\n');
    }

    if in_section {
        for (k, v) in updates {
            if !seen.contains(&k.to_ascii_lowercase()) {
                out.push_str(k);
                out.push('=');
                out.push_str(v);
                out.push('\n');
            }
        }
    } else if !section_seen {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&section_header);
        out.push('\n');
        for (k, v) in updates {
            out.push_str(k);
            out.push('=');
            out.push_str(v);
            out.push('\n');
        }
    }
    out
}

fn apply_ra_to_retroarch(managed_root: &Path, username: &str, password: &str) -> Result<(), String> {
    seed_retroarch_cfg_if_missing(managed_root).map_err(|e| format!("{e:?}"))?;
    let cfg_path = managed_root.join("retroarch.cfg");
    let content = fs::read_to_string(&cfg_path).unwrap_or_default();
    let next = upsert_retroarch_cfg_keys(
        &content,
        &[
            ("cheevos_enable", "true"),
            ("cheevos_username", username),
            ("cheevos_password", password),
        ],
    );
    write_atomic(&cfg_path, &next).map_err(|e| format!("{e:?}"))
}

fn apply_ra_to_pcsx2(data_root: &Path, username: &str) -> Result<(), String> {
    seed_pcsx2_ini_if_missing(data_root).map_err(|e| format!("{e:?}"))?;
    let ini_path = data_root.join("inis").join("PCSX2.ini");
    let content = fs::read_to_string(&ini_path).unwrap_or_default();
    let next = upsert_ini_section_keys(
        &content,
        "Achievements",
        &[("Enabled", "true"), ("Username", username)],
    );
    write_atomic(&ini_path, &next).map_err(|e| format!("{e:?}"))
}

/// Escribe el login RA de Blaze en RetroArch/PCSX2 managed (AppData).
/// La contraseña solo se usa para `cheevos_password` local; no se loguea ni se devuelve.
#[tauri::command]
pub fn apply_managed_ra_credentials(
    app: AppHandle,
    username: String,
    password: String,
) -> Result<ApplyRaCredentialsResult, String> {
    let user = username.trim();
    if user.is_empty() {
        return Err("Usuario RA vacío.".into());
    }
    if password.is_empty() {
        return Err("Contraseña RA vacía.".into());
    }

    let app_data = app_data_dir(&app)?;
    let mut retroarch_ok = false;
    let mut pcsx2_ok = false;

    let ra_root = managed_data_root(&app_data, "retroarch");
    match apply_ra_to_retroarch(&ra_root, user, &password) {
        Ok(()) => retroarch_ok = true,
        Err(e) => {
            eprintln!("[Blaze] No se pudo aplicar RA a RetroArch: {e}");
        }
    }

    let pcsx2_managed = managed_data_root(&app_data, "pcsx2");
    let pcsx2_root = pcsx2_internal_data_root(&pcsx2_managed);
    match apply_ra_to_pcsx2(&pcsx2_root, user) {
        Ok(()) => pcsx2_ok = true,
        Err(e) => {
            eprintln!("[Blaze] No se pudo aplicar RA a PCSX2: {e}");
        }
    }

    if !retroarch_ok && !pcsx2_ok {
        return Err("No se pudo escribir el login RA en los emuladores.".into());
    }

    Ok(ApplyRaCredentialsResult {
        retroarch: retroarch_ok,
        pcsx2: pcsx2_ok,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir()
            .join("blaze-emulator-data-tests")
            .join(name)
            .join(format!("{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn write_romdir_bios(path: &Path, with_romver: bool) {
        // Layout: RESET (size 0) + optional ROMVER (size 16) + payload for ROMVER + padding a 4 MiB.
        let mut buf = vec![0u8; BIOS_MIN_BYTES as usize];
        // RESET
        buf[0..5].copy_from_slice(b"RESET");
        // file_size = 0 at offset 12
        if with_romver {
            let off = 16;
            buf[off..off + 6].copy_from_slice(b"ROMVER");
            buf[off + 12..off + 16].copy_from_slice(&16u32.to_le_bytes());
            // ROMVER payload at file_offset 0 (tras RESET size 0) — pero el offset de datos
            // en dumps reales empieza tras la tabla; para el check solo exige 14 bytes legibles
            // en file_offset. Con RESET size 0, file_offset de ROMVER es 0, que solapa la tabla.
            // Ponemos el payload en bytes 0..14 no funciona. Ajustamos RESET.fileSize para
            // apuntar tras la tabla (2 entradas = 32 bytes).
            buf[12..16].copy_from_slice(&32u32.to_le_bytes());
            // ROMVER payload at offset 32
            buf[32..46].copy_from_slice(b"0160A200109270");
        }
        fs::write(path, buf).unwrap();
    }

    #[test]
    fn managed_data_root_per_kind() {
        let app = PathBuf::from(r"C:\Users\x\AppData\Roaming\Blaze");
        assert_eq!(
            managed_data_root(&app, "pcsx2"),
            app.join("emulator-data").join("pcsx2")
        );
        assert_eq!(
            managed_data_root(&app, "eden"),
            app.join("emulator-data").join("eden")
        );
    }

    #[test]
    fn eden_keys_and_firmware_gates() {
        let root = temp("eden-gates");
        seed_eden_managed_layout(&root).unwrap();
        assert!(ensure_eden_keys_for_launch(&root).is_err());
        assert!(ensure_eden_firmware_for_launch(&root).is_err());

        let keys = eden_keys_dir(&root);
        fs::write(keys.join("prod.keys"), vec![b'A'; 64]).unwrap();
        assert!(ensure_eden_keys_for_launch(&root).is_ok());

        let fw = eden_firmware_registered_dir(&root);
        fs::write(fw.join("dummy.nca"), b"nca").unwrap();
        assert!(ensure_eden_firmware_for_launch(&root).is_ok());

        let args = build_managed_launch_arguments(
            RuntimeDataSource::Managed,
            "eden",
            &ResolvedEmulatorPaths {
                blaze_managed_root: Some(root.clone()),
                pcsx2_data_root: None,
                retroarch_cfg: None,
            },
            &[],
            r"C:\games\mk8.nsp",
            true,
        )
        .unwrap();
        assert_eq!(args, vec!["-f".to_string(), "-g".to_string(), r"C:\games\mk8.nsp".to_string()]);
    }

    #[test]
    fn pcsx2_internal_root_under_datapath() {
        let dp = PathBuf::from(r"C:\App\emulator-data\pcsx2");
        assert_eq!(pcsx2_internal_data_root(&dp), dp.join("PCSX2"));
    }

    #[test]
    fn bios_missing_folder() {
        let root = temp("bios-missing-dir");
        let data = root.join("PCSX2");
        assert!(ensure_pcsx2_bios_for_launch(&data).is_err());
        assert!(find_valid_pcsx2_bios(&pcsx2_bios_directory(&data)).is_none());
    }

    #[test]
    fn bios_empty_file_rejected() {
        let root = temp("bios-empty");
        let bios_dir = pcsx2_bios_directory(&root.join("PCSX2"));
        fs::create_dir_all(&bios_dir).unwrap();
        let path = bios_dir.join("empty.bin");
        fs::write(&path, b"").unwrap();
        assert!(!is_valid_pcsx2_bios_file(&path));
        assert!(ensure_pcsx2_bios_for_launch(&root.join("PCSX2")).is_err());
    }

    #[test]
    fn bios_garbage_1mb_rejected() {
        let root = temp("bios-garbage-1mb");
        let bios_dir = pcsx2_bios_directory(&root.join("PCSX2"));
        fs::create_dir_all(&bios_dir).unwrap();
        let path = bios_dir.join("trash.bin");
        fs::write(&path, vec![0xABu8; 1024 * 1024]).unwrap();
        assert!(!is_valid_pcsx2_bios_file(&path));
        assert!(ensure_pcsx2_bios_for_launch(&root.join("PCSX2")).is_err());
    }

    #[test]
    fn bios_valid_romdir_romver_accepted() {
        let root = temp("bios-valid");
        let data = root.join("PCSX2");
        let bios_dir = pcsx2_bios_directory(&data);
        fs::create_dir_all(&bios_dir).unwrap();
        let path = bios_dir.join("scph39001.bin");
        write_romdir_bios(&path, true);
        assert!(is_valid_pcsx2_bios_file(&path));
        assert!(ensure_pcsx2_bios_for_launch(&data).is_ok());
    }

    #[test]
    fn bios_4mb_without_romver_rejected() {
        let root = temp("bios-no-romver");
        let bios_dir = pcsx2_bios_directory(&root.join("PCSX2"));
        fs::create_dir_all(&bios_dir).unwrap();
        let path = bios_dir.join("fake.bin");
        write_romdir_bios(&path, false);
        assert!(!is_valid_pcsx2_bios_file(&path));
    }

    #[test]
    fn seed_pcsx2_ini_only_if_missing() {
        let root = temp("seed-ini");
        let data = root.join("PCSX2");
        seed_pcsx2_ini_if_missing(&data).unwrap();
        let ini = data.join("inis").join("PCSX2.ini");
        assert!(ini.is_file());
        let first = fs::read_to_string(&ini).unwrap();
        fs::write(&ini, "CHANGED").unwrap();
        seed_pcsx2_ini_if_missing(&data).unwrap();
        assert_eq!(fs::read_to_string(&ini).unwrap(), "CHANGED");
        assert!(first.contains("SetupWizardIncomplete=false"));
    }

    #[test]
    fn seed_retroarch_cfg_no_cheevos_keys() {
        let root = temp("seed-ra");
        seed_retroarch_cfg_if_missing(&root).unwrap();
        let cfg = fs::read_to_string(root.join("retroarch.cfg")).unwrap();
        assert!(cfg.contains("config_save_on_exit"));
        assert!(cfg.contains("savefile_directory"));
        assert!(!cfg.to_ascii_lowercase().contains("cheevos"));
        assert!(!cfg.contains("libretro_directory"));
        fs::write(root.join("retroarch.cfg"), "KEEP").unwrap();
        seed_retroarch_cfg_if_missing(&root).unwrap();
        assert_eq!(fs::read_to_string(root.join("retroarch.cfg")).unwrap(), "KEEP");
    }

    #[test]
    fn manual_pcsx2_portable_next_to_exe() {
        let root = temp("manual-portable");
        fs::write(root.join("portable.txt"), b"").unwrap();
        let exe = root.join("pcsx2-qt.exe");
        fs::write(&exe, b"x").unwrap();
        let paths = resolve_emulator_paths(None, RuntimeDataSource::Manual, "pcsx2", &exe);
        assert_eq!(paths.pcsx2_data_root.as_ref(), Some(&root));
    }

    #[test]
    fn upsert_retroarch_cheevos_keys() {
        let base = "config_save_on_exit = \"true\"\ncheevos_enable = \"false\"\n";
        let next = upsert_retroarch_cfg_keys(
            base,
            &[
                ("cheevos_enable", "true"),
                ("cheevos_username", "Player"),
                ("cheevos_password", "secret"),
            ],
        );
        assert!(next.contains("cheevos_enable = \"true\""));
        assert!(next.contains("cheevos_username = \"Player\""));
        assert!(next.contains("cheevos_password = \"secret\""));
        assert!(next.contains("config_save_on_exit"));
        assert!(!next.contains("cheevos_enable = \"false\""));
    }

    #[test]
    fn upsert_pcsx2_achievements_section() {
        let base = "[UI]\nSetupWizardIncomplete=false\n";
        let next = upsert_ini_section_keys(
            base,
            "Achievements",
            &[("Enabled", "true"), ("Username", "Player")],
        );
        assert!(next.contains("[Achievements]"));
        assert!(next.contains("Enabled=true"));
        assert!(next.contains("Username=Player"));
        assert!(next.contains("[UI]"));
    }

    #[test]
    fn apply_ra_writes_managed_files() {
        let root = temp("apply-ra");
        apply_ra_to_retroarch(&root, "PlayerOne", "pw").unwrap();
        let cfg = fs::read_to_string(root.join("retroarch.cfg")).unwrap();
        assert!(cfg.contains("cheevos_username = \"PlayerOne\""));
        assert!(cfg.contains("cheevos_password = \"pw\""));
        assert!(cfg.contains("cheevos_enable = \"true\""));

        let pcsx2 = root.join("PCSX2");
        apply_ra_to_pcsx2(&pcsx2, "PlayerOne").unwrap();
        let ini = fs::read_to_string(pcsx2.join("inis").join("PCSX2.ini")).unwrap();
        assert!(ini.contains("[Achievements]"));
        assert!(ini.contains("Username=PlayerOne"));
        assert!(ini.contains("Enabled=true"));
    }

    #[test]
    fn sync_eden_portable_copies_keys() {
        let managed = temp("eden-sync-managed");
        let runtime = temp("eden-sync-runtime");
        seed_eden_managed_layout(&managed).unwrap();
        fs::write(eden_keys_dir(&managed).join("prod.keys"), vec![b'P'; 40]).unwrap();
        fs::write(
            eden_firmware_registered_dir(&managed).join("sys.nca"),
            b"nca",
        )
        .unwrap();
        let exe = runtime.join("eden.exe");
        fs::write(&exe, b"x").unwrap();
        let user = sync_eden_portable_user(&exe, &managed).unwrap();
        assert!(user.join("keys").join("prod.keys").is_file());
        assert!(user
            .join("nand")
            .join("system")
            .join("Contents")
            .join("registered")
            .join("sys.nca")
            .is_file());
    }

}
