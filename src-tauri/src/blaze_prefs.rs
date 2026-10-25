//! Prefs de Blaze en AppData (JSON plano, legible desde Rust en cada launch).

use crate::emulator_data::{
    app_data_dir, managed_data_root, pcsx2_internal_data_root,
};
use crate::emulator_full_config::{
    apply_full_config, apply_input_backend_policy, EmulatorConfig,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const EMULATION_FILE: &str = "blaze-emulation-prefs.json";
const CONTROLLER_FILE: &str = "blaze-controller-prefs.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulationKindPrefs {
    pub fullscreen: bool,
    pub resolution_scale: u32,
    pub renderer: String,
    pub vsync: bool,
    pub audio_engine: String,
    pub volume: u32,
}

impl Default for EmulationKindPrefs {
    fn default() -> Self {
        Self::from_config(&EmulatorConfig::default())
    }
}

impl EmulationKindPrefs {
    fn from_config(cfg: &EmulatorConfig) -> Self {
        Self {
            fullscreen: cfg.fullscreen,
            resolution_scale: cfg.resolution_scale,
            renderer: cfg.renderer.clone(),
            vsync: cfg.vsync,
            audio_engine: cfg.audio_engine.clone(),
            volume: cfg.volume,
        }
    }

    fn merge_into(&self, cfg: &mut EmulatorConfig) {
        cfg.fullscreen = self.fullscreen;
        cfg.resolution_scale = self.resolution_scale.max(1);
        if !self.renderer.trim().is_empty() {
            cfg.renderer = self.renderer.clone();
        }
        cfg.vsync = self.vsync;
        if !self.audio_engine.trim().is_empty() {
            cfg.audio_engine = self.audio_engine.clone();
        }
        cfg.volume = self.volume.min(100);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EmulationPrefsFile {
    #[serde(default)]
    pub pcsx2: Option<EmulationKindPrefs>,
    #[serde(default)]
    pub retroarch: Option<EmulationKindPrefs>,
    #[serde(default)]
    pub eden: Option<EmulationKindPrefs>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerPrefsFile {
    #[serde(default = "default_layout")]
    pub layout: String,
    #[serde(default)]
    pub preferred_device_guid: Option<String>,
}

fn default_layout() -> String {
    "auto".into()
}

impl Default for ControllerPrefsFile {
    fn default() -> Self {
        Self {
            layout: "auto".into(),
            preferred_device_guid: None,
        }
    }
}

fn prefs_path(app_data: &Path, name: &str) -> PathBuf {
    app_data.join(name)
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> T {
    let Ok(raw) = fs::read_to_string(path) else {
        return T::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

pub fn load_emulation_prefs(app_data: &Path) -> EmulationPrefsFile {
    read_json(&prefs_path(app_data, EMULATION_FILE))
}

pub fn load_controller_prefs(app_data: &Path) -> ControllerPrefsFile {
    read_json(&prefs_path(app_data, CONTROLLER_FILE))
}

#[tauri::command]
pub fn save_emulation_prefs(
    app: AppHandle,
    prefs: EmulationPrefsFile,
) -> Result<(), String> {
    let app_data = app_data_dir(&app)?;
    write_json(&prefs_path(&app_data, EMULATION_FILE), &prefs)?;
    // Aplicar ya a configs managed existentes.
    apply_emulation_prefs_to_managed(&app_data, &prefs, &load_controller_prefs(&app_data))?;
    Ok(())
}

#[tauri::command]
pub fn load_emulation_prefs_cmd(app: AppHandle) -> Result<EmulationPrefsFile, String> {
    let app_data = app_data_dir(&app)?;
    Ok(load_emulation_prefs(&app_data))
}

#[tauri::command]
pub fn save_controller_prefs_file(
    app: AppHandle,
    prefs: ControllerPrefsFile,
) -> Result<(), String> {
    let app_data = app_data_dir(&app)?;
    let mut prefs = prefs;
    let layout = match prefs.layout.trim().to_ascii_lowercase().as_str() {
        "playstation" | "xbox" | "auto" => prefs.layout.trim().to_ascii_lowercase(),
        _ => "auto".into(),
    };
    prefs.layout = layout;
    write_json(&prefs_path(&app_data, CONTROLLER_FILE), &prefs)?;
    let pcsx2_ini = pcsx2_internal_data_root(&managed_data_root(&app_data, "pcsx2"))
        .join("inis")
        .join("PCSX2.ini");
    let ra_cfg = managed_data_root(&app_data, "retroarch").join("retroarch.cfg");
    let _ = apply_input_backend_policy("pcsx2", &pcsx2_ini, &prefs.layout);
    let _ = apply_input_backend_policy("retroarch", &ra_cfg, &prefs.layout);
    // BIOS PS2 → español por defecto (GoW 1 y similares).
    let bios_dir = pcsx2_internal_data_root(&managed_data_root(&app_data, "pcsx2")).join("bios");
    let _ = crate::pcsx2_bios_lang::ensure_pcsx2_bios_language(&bios_dir, "es");
    // Eden: asociar DualShock/Xbox al player_0 (qt-config).
    let preferred = prefs.preferred_device_guid.as_deref();
    for eden_ini in crate::eden_input::find_eden_qt_config_paths(&app_data) {
        let _ = crate::eden_input::apply_eden_input_backends(
            &eden_ini,
            &prefs.layout,
            preferred,
        );
    }
    // Sidecar con GUID preferido (los emus no siempre lo leen; Blaze lo usa en tips/test).
    let _ = write_json(
        &prefs_path(&app_data, "blaze-preferred-pad.json"),
        &serde_json::json!({
            "guid": prefs.preferred_device_guid,
            "layout": prefs.layout,
        }),
    );
    Ok(())
}

fn config_for_kind(kind: &str, file: &EmulationPrefsFile, layout: &str) -> EmulatorConfig {
    let mut cfg = match kind {
        "pcsx2" => EmulatorConfig::pcsx2_defaults(),
        "retroarch" => EmulatorConfig::retroarch_defaults(),
        "eden" => EmulatorConfig::eden_defaults(),
        _ => EmulatorConfig {
            runtime_kind: kind.into(),
            ..Default::default()
        },
    };
    let slice = match kind {
        "pcsx2" => file.pcsx2.as_ref(),
        "retroarch" => file.retroarch.as_ref(),
        "eden" => file.eden.as_ref(),
        _ => None,
    };
    if let Some(p) = slice {
        p.merge_into(&mut cfg);
    }
    cfg.controller_profile = layout.to_string();
    cfg
}

fn apply_emulation_prefs_to_managed(
    app_data: &Path,
    emu: &EmulationPrefsFile,
    pad: &ControllerPrefsFile,
) -> Result<(), String> {
    let layout = pad.layout.as_str();
    let pcsx2_ini = pcsx2_internal_data_root(&managed_data_root(app_data, "pcsx2"))
        .join("inis")
        .join("PCSX2.ini");
    let ra_cfg = managed_data_root(app_data, "retroarch").join("retroarch.cfg");
    let eden_ini = managed_data_root(app_data, "eden")
        .join("config")
        .join("qt-config.ini");

    if let Some(parent) = pcsx2_ini.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = apply_full_config(&pcsx2_ini, &config_for_kind("pcsx2", emu, layout));
    let bios_dir = pcsx2_internal_data_root(&managed_data_root(app_data, "pcsx2")).join("bios");
    let _ = crate::pcsx2_bios_lang::ensure_pcsx2_bios_language(&bios_dir, "es");

    if let Some(parent) = ra_cfg.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = apply_full_config(&ra_cfg, &config_for_kind("retroarch", emu, layout));

    // Eden managed puede no tener qt-config aquí; best-effort.
    if eden_ini.parent().map(|p| p.exists()).unwrap_or(false) || eden_ini.exists() {
        let _ = apply_full_config(&eden_ini, &config_for_kind("eden", emu, layout));
        let _ = crate::eden_input::apply_eden_input_backends(
            &eden_ini,
            layout,
            pad.preferred_device_guid.as_deref(),
        );
    }
    for path in crate::eden_input::find_eden_qt_config_paths(app_data) {
        if path != eden_ini {
            let _ = apply_full_config(&path, &config_for_kind("eden", emu, layout));
        }
        let _ = crate::eden_input::apply_eden_input_backends(
            &path,
            layout,
            pad.preferred_device_guid.as_deref(),
        );
    }
    Ok(())
}

/// Aplica prefs Blaze al config path del runtime que se va a lanzar.
pub fn apply_profile_for_launch(
    app_data: &Path,
    runtime_kind: &str,
    config_path: &Path,
    force_lang: Option<&str>,
) -> Result<(), String> {
    let emu = load_emulation_prefs(app_data);
    let pad = load_controller_prefs(app_data);
    let kind = match runtime_kind {
        "pcsx2" | "playstation2" => "pcsx2",
        "retroarch" | "ra" => "retroarch",
        "eden" | "switch" => "eden",
        other => other,
    };
    let mut cfg = config_for_kind(kind, &emu, &pad.layout);
    if let Some(lang) = force_lang.map(str::trim).filter(|s| !s.is_empty()) {
        cfg.ui_language = lang.to_string();
    }
    apply_full_config(config_path, &cfg)?;
    if kind == "eden" {
        let _ = crate::eden_input::apply_eden_input_backends(
            config_path,
            &pad.layout,
            pad.preferred_device_guid.as_deref(),
        );
    }
    if kind == "pcsx2" {
        if let Some(parent) = config_path.parent().and_then(|p| p.parent()) {
            let bios = parent.join("bios");
            let lang = force_lang.unwrap_or("es");
            let _ = crate::pcsx2_bios_lang::ensure_pcsx2_bios_language(&bios, lang);
        }
    }
    Ok(())
}

/// Resuelve la ruta de config a tocar en launch y aplica el perfil.
pub fn apply_launch_profile(
    app: &AppHandle,
    runtime_kind: &str,
    exe: &Path,
    pcsx2_data_root: Option<&Path>,
    retroarch_cfg: Option<&Path>,
    force_lang: Option<&str>,
) {
    let Ok(app_data) = app_data_dir(app) else {
        return;
    };
    let kind = if runtime_kind == "eden" || runtime_kind.contains("eden") {
        "eden"
    } else if runtime_kind.contains("retro") || runtime_kind == "ra" {
        "retroarch"
    } else if runtime_kind.contains("pcsx") || runtime_kind == "playstation2" {
        "pcsx2"
    } else {
        // detect by paths
        if pcsx2_data_root.is_some() {
            "pcsx2"
        } else if retroarch_cfg.is_some() {
            "retroarch"
        } else {
            "eden"
        }
    };

    let path = match kind {
        "pcsx2" => pcsx2_data_root.map(|r| r.join("inis").join("PCSX2.ini")),
        "retroarch" => retroarch_cfg.map(|p| p.to_path_buf()),
        "eden" => {
            let portable = exe
                .parent()
                .unwrap_or(exe)
                .join("user")
                .join("config")
                .join("qt-config.ini");
            Some(portable)
        }
        _ => None,
    };

    if let Some(path) = path {
        let _ = apply_profile_for_launch(&app_data, kind, &path, force_lang);
    }
}

/// Defaults serializables para la UI (si no hay archivo aún).
#[tauri::command]
pub fn default_emulation_prefs() -> EmulationPrefsFile {
    EmulationPrefsFile {
        pcsx2: Some(EmulationKindPrefs::from_config(&EmulatorConfig::pcsx2_defaults())),
        retroarch: Some(EmulationKindPrefs::from_config(
            &EmulatorConfig::retroarch_defaults(),
        )),
        eden: Some(EmulationKindPrefs::from_config(&EmulatorConfig::eden_defaults())),
    }
}
