//! Config audio/control desde Blaze para Eden, PCSX2 y RetroArch.

use crate::emulator_data::{
    app_data_dir, ensure_managed_data_layout, managed_data_root, resolve_emulator_paths,
    sync_eden_portable_user, RuntimeDataSource,
};
use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameControllerInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAudioSettings {
    pub runtime_kind: String,
    pub output_engine: String,
    pub output_device: String,
    pub volume: u32,
    /// Motores disponibles para el combo de la UI.
    pub engines: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeVideoSettings {
    pub runtime_kind: String,
    pub fullscreen: bool,
    /// Escala interna 1–4 (Native / 2x / 3x / 4x).
    pub resolution_scale: u32,
    pub scale_options: Vec<u32>,
}

fn default_scale_options() -> Vec<u32> {
    vec![1, 2, 3, 4]
}

fn clamp_scale(scale: u32) -> u32 {
    scale.clamp(1, 4)
}

fn parse_boolish(raw: &str) -> Option<bool> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn parse_scale_number(raw: &str) -> Option<u32> {
    let t = raw.trim();
    if let Ok(n) = t.parse::<u32>() {
        return Some(clamp_scale(n.max(1)));
    }
    if let Ok(f) = t.parse::<f32>() {
        if f.is_finite() && f >= 1.0 {
            return Some(clamp_scale(f.round() as u32));
        }
    }
    None
}

fn normalize_kind(kind: &str) -> Result<&'static str, String> {
    match kind.trim().to_ascii_lowercase().as_str() {
        "eden" | "switch" => Ok("eden"),
        "pcsx2" | "ps2" => Ok("pcsx2"),
        "retroarch" | "ra" => Ok("retroarch"),
        other => Err(format!("Runtime no soportado: {other}")),
    }
}

/// Lee valor de clave en sección INI estilo Qt (líneas `key=value`).
fn ini_get(content: &str, section: &str, key: &str) -> Option<String> {
    let mut in_section = false;
    let section_hdr = format!("[{section}]");
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with('[') && t.ends_with(']') {
            in_section = t.eq_ignore_ascii_case(&section_hdr);
            continue;
        }
        if !in_section || t.is_empty() || t.starts_with('#') || t.starts_with(';') {
            continue;
        }
        if let Some((k, v)) = t.split_once('=') {
            if k.trim().eq_ignore_ascii_case(key) {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

fn ini_set_section_keys(content: &str, section: &str, pairs: &[(&str, String)]) -> String {
    let section_hdr = format!("[{section}]");
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let mut section_start: Option<usize> = None;
    let mut section_end: Option<usize> = None;

    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        if t.eq_ignore_ascii_case(&section_hdr) {
            section_start = Some(i);
            continue;
        }
        if section_start.is_some() && section_end.is_none() && t.starts_with('[') && t.ends_with(']')
        {
            section_end = Some(i);
            break;
        }
    }
    if let Some(start) = section_start {
        let end = section_end.unwrap_or(lines.len());
        let mut keys_done = std::collections::HashSet::new();
        let mut replacements: Vec<(usize, String)> = Vec::new();
        for i in (start + 1)..end {
            let Some((k, _)) = lines[i].split_once('=') else {
                continue;
            };
            let ktrim = k.trim().to_string();
            for (pk, pv) in pairs {
                if ktrim.eq_ignore_ascii_case(pk) {
                    replacements.push((i, format!("{pk}={pv}")));
                    keys_done.insert(pk.to_lowercase());
                }
                let def_key = format!("{pk}\\default");
                if ktrim.eq_ignore_ascii_case(&def_key) {
                    replacements.push((i, format!("{pk}\\default=false")));
                    keys_done.insert(def_key.to_lowercase());
                }
            }
        }
        for (i, line) in replacements {
            lines[i] = line;
        }
        let mut insert_at = end;
        for (pk, pv) in pairs {
            if !keys_done.contains(&pk.to_lowercase()) {
                lines.insert(insert_at, format!("{pk}={pv}"));
                insert_at += 1;
            }
            let def_key = format!("{pk}\\default");
            if !keys_done.contains(&def_key.to_lowercase()) {
                lines.insert(insert_at, format!("{pk}\\default=false"));
                insert_at += 1;
            }
        }
        return lines.join("\n") + if content.ends_with('\n') { "\n" } else { "" };
    }

    let mut out = content.to_string();
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&section_hdr);
    out.push('\n');
    for (pk, pv) in pairs {
        out.push_str(&format!("{pk}\\default=false\n"));
        out.push_str(&format!("{pk}={pv}\n"));
    }
    out
}

fn cfg_get(content: &str, key: &str) -> Option<String> {
    for line in content.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let Some((k, v)) = t.split_once('=') else {
            continue;
        };
        if k.trim().eq_ignore_ascii_case(key) {
            let mut val = v.trim().to_string();
            if val.starts_with('"') && val.ends_with('"') && val.len() >= 2 {
                val = val[1..val.len() - 1].to_string();
            }
            return Some(val);
        }
    }
    None
}

fn cfg_set(content: &str, pairs: &[(&str, String)]) -> String {
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let mut done = std::collections::HashSet::new();
    let mut replacements: Vec<(usize, String)> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        let Some((k, _)) = t.split_once('=') else {
            continue;
        };
        let ktrim = k.trim();
        for (pk, pv) in pairs {
            if ktrim.eq_ignore_ascii_case(pk) {
                replacements.push((i, format!("{pk} = \"{pv}\"")));
                done.insert(pk.to_lowercase());
            }
        }
    }
    for (i, line) in replacements {
        lines[i] = line;
    }
    for (pk, pv) in pairs {
        if !done.contains(&pk.to_lowercase()) {
            lines.push(format!("{pk} = \"{pv}\""));
        }
    }
    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn eden_user_config_ini(executable_path: &Path) -> PathBuf {
    executable_path
        .parent()
        .unwrap_or(executable_path)
        .join("user")
        .join("config")
        .join("qt-config.ini")
}

fn resolve_paths(
    app: &AppHandle,
    kind: &str,
    exe: &Path,
    runtime_source: Option<&str>,
) -> Result<(PathBuf, Option<PathBuf>), String> {
    let app_data = app_data_dir(app)?;
    let source = RuntimeDataSource::parse(runtime_source);
    let resolved = resolve_emulator_paths(Some(&app_data), source, kind, exe);
    let _ = ensure_managed_data_layout(source, kind, &resolved);
    match kind {
        "eden" => Ok((eden_user_config_ini(exe), None)),
        "pcsx2" => {
            let root = resolved
                .pcsx2_data_root
                .ok_or_else(|| "No se encontró la carpeta de datos de PCSX2.".to_string())?;
            Ok((root.join("inis").join("PCSX2.ini"), None))
        }
        "retroarch" => {
            let cfg = resolved
                .retroarch_cfg
                .ok_or_else(|| "No se encontró retroarch.cfg.".to_string())?;
            Ok((cfg, None))
        }
        _ => Err("Runtime no soportado.".into()),
    }
}

fn read_eden(path: &Path) -> RuntimeAudioSettings {
    let defaults = RuntimeAudioSettings {
        runtime_kind: "eden".into(),
        output_engine: "cubeb".into(),
        output_device: "auto".into(),
        volume: 100,
        engines: vec!["cubeb".into(), "sdl2".into(), "auto".into()],
    };
    if !path.is_file() {
        return defaults;
    }
    let Ok(raw) = fs::read_to_string(path) else {
        return defaults;
    };
    RuntimeAudioSettings {
        runtime_kind: "eden".into(),
        output_engine: ini_get(&raw, "Audio", "output_engine")
            .unwrap_or(defaults.output_engine),
        output_device: ini_get(&raw, "Audio", "output_device")
            .unwrap_or(defaults.output_device),
        volume: ini_get(&raw, "Audio", "volume")
            .and_then(|v| v.parse().ok())
            .unwrap_or(100)
            .min(100),
        engines: defaults.engines,
    }
}

fn write_eden(path: &Path, engine: &str, device: &str, volume: u32) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let existing = if path.is_file() {
        fs::read_to_string(path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let pairs = [
        ("output_engine", engine.to_string()),
        ("output_device", device.to_string()),
        ("volume", volume.min(100).to_string()),
    ];
    let next = ini_set_section_keys(&existing, "Audio", &pairs);
    fs::write(path, next).map_err(|e| e.to_string())
}

fn read_pcsx2(path: &Path) -> RuntimeAudioSettings {
    let defaults = RuntimeAudioSettings {
        runtime_kind: "pcsx2".into(),
        output_engine: "cubeb".into(),
        output_device: "auto".into(),
        volume: 100,
        engines: vec!["cubeb".into(), "sdl".into(), "xaudio2".into()],
    };
    if !path.is_file() {
        return defaults;
    }
    let Ok(raw) = fs::read_to_string(path) else {
        return defaults;
    };
    let engine = ini_get(&raw, "SPU2/Output", "Backend")
        .or_else(|| ini_get(&raw, "SPU2/Output", "OutputModule"))
        .or_else(|| ini_get(&raw, "Audio", "OutputModule"))
        .unwrap_or(defaults.output_engine);
    // PCSX2: StandardVolume (builds nuevas) / OutputVolume (anteriores), 0–200 (100 = normal).
    let volume = ini_get(&raw, "SPU2/Output", "StandardVolume")
        .or_else(|| ini_get(&raw, "SPU2/Output", "OutputVolume"))
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(100)
        .min(100);
    RuntimeAudioSettings {
        runtime_kind: "pcsx2".into(),
        output_engine: engine,
        output_device: "auto".into(),
        volume,
        engines: defaults.engines,
    }
}

fn write_pcsx2(path: &Path, engine: &str, _device: &str, volume: u32) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let existing = if path.is_file() {
        fs::read_to_string(path).map_err(|e| e.to_string())?
    } else {
        String::from("[UI]\nSetupWizardIncomplete=false\n")
    };
    let vol = volume.min(100).to_string();
    let pairs = [
        ("Backend", engine.to_string()),
        ("OutputModule", engine.to_string()),
        ("StandardVolume", vol.clone()),
        ("OutputVolume", vol),
    ];
    let mut next = ini_set_section_keys(&existing, "SPU2/Output", &pairs);
    // También espejo en [Audio] por builds Qt recientes.
    next = ini_set_section_keys(&next, "Audio", &[("OutputModule", engine.to_string())]);
    fs::write(path, next).map_err(|e| e.to_string())
}

fn read_retroarch(path: &Path) -> RuntimeAudioSettings {
    let defaults = RuntimeAudioSettings {
        runtime_kind: "retroarch".into(),
        output_engine: "xaudio".into(),
        output_device: "".into(),
        volume: 100,
        engines: vec![
            "xaudio".into(),
            "wasapi".into(),
            "dsound".into(),
            "sdl2".into(),
        ],
    };
    if !path.is_file() {
        return defaults;
    }
    let Ok(raw) = fs::read_to_string(path) else {
        return defaults;
    };
    let engine = cfg_get(&raw, "audio_driver").unwrap_or(defaults.output_engine);
    let device = cfg_get(&raw, "audio_device").unwrap_or_default();
    // RetroArch audio_volume está en dB (0 = 100%). Aprox lineal.
    let volume = cfg_get(&raw, "audio_volume")
        .and_then(|v| v.parse::<f32>().ok())
        .map(|db| {
            if db <= -80.0 {
                0
            } else {
                (((db + 80.0) / 80.0) * 100.0).round() as u32
            }
            .min(100)
        })
        .unwrap_or(100);
    RuntimeAudioSettings {
        runtime_kind: "retroarch".into(),
        output_engine: engine,
        output_device: if device.is_empty() {
            "auto".into()
        } else {
            device
        },
        volume,
        engines: defaults.engines,
    }
}

fn write_retroarch(path: &Path, engine: &str, device: &str, volume: u32) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let existing = if path.is_file() {
        fs::read_to_string(path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let vol = volume.min(100);
    let db = if vol == 0 {
        -80.0
    } else {
        (vol as f32 / 100.0) * 80.0 - 80.0
    };
    let device_val = if device == "auto" || device.is_empty() {
        String::new()
    } else {
        device.to_string()
    };
    let pairs = [
        ("audio_driver", engine.to_string()),
        ("audio_device", device_val),
        ("audio_volume", format!("{db:.6}")),
    ];
    let next = cfg_set(&existing, &pairs);
    fs::write(path, next).map_err(|e| e.to_string())
}

fn read_eden_video(path: &Path) -> RuntimeVideoSettings {
    let defaults = RuntimeVideoSettings {
        runtime_kind: "eden".into(),
        fullscreen: true,
        resolution_scale: 1,
        scale_options: default_scale_options(),
    };
    if !path.is_file() {
        return defaults;
    }
    let Ok(raw) = fs::read_to_string(path) else {
        return defaults;
    };
    let fullscreen = ini_get(&raw, "UI", "fullscreen")
        .and_then(|v| parse_boolish(&v))
        .unwrap_or(true);
    // resolution_setup: 0=1x … 3=4x. Fallback resolution_factor: 1=1x.
    let resolution_scale = ini_get(&raw, "Renderer", "resolution_setup")
        .and_then(|v| v.parse::<u32>().ok())
        .map(|v| clamp_scale(v + 1))
        .or_else(|| {
            ini_get(&raw, "Renderer", "resolution_factor").and_then(|v| parse_scale_number(&v))
        })
        .unwrap_or(1);
    RuntimeVideoSettings {
        runtime_kind: "eden".into(),
        fullscreen,
        resolution_scale,
        scale_options: defaults.scale_options,
    }
}

fn write_eden_video(path: &Path, fullscreen: bool, resolution_scale: u32) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let existing = if path.is_file() {
        fs::read_to_string(path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let scale = clamp_scale(resolution_scale);
    let setup = (scale - 1).to_string();
    let factor = scale.to_string();
    let mut next = ini_set_section_keys(
        &existing,
        "UI",
        &[("fullscreen", if fullscreen { "true" } else { "false" }.into())],
    );
    next = ini_set_section_keys(
        &next,
        "Renderer",
        &[
            ("resolution_setup", setup),
            ("resolution_factor", factor),
        ],
    );
    fs::write(path, next).map_err(|e| e.to_string())
}

fn read_pcsx2_video(path: &Path) -> RuntimeVideoSettings {
    let defaults = RuntimeVideoSettings {
        runtime_kind: "pcsx2".into(),
        fullscreen: true,
        resolution_scale: 1,
        scale_options: default_scale_options(),
    };
    if !path.is_file() {
        return defaults;
    }
    let Ok(raw) = fs::read_to_string(path) else {
        return defaults;
    };
    let fullscreen = ini_get(&raw, "UI", "StartFullscreen")
        .and_then(|v| parse_boolish(&v))
        .unwrap_or(true);
    let resolution_scale = ini_get(&raw, "EmuCore/GS", "upscale_multiplier")
        .or_else(|| ini_get(&raw, "EmuCore/GS", "UpscaleMultiplier"))
        .and_then(|v| parse_scale_number(&v))
        .unwrap_or(1);
    RuntimeVideoSettings {
        runtime_kind: "pcsx2".into(),
        fullscreen,
        resolution_scale,
        scale_options: defaults.scale_options,
    }
}

fn write_pcsx2_video(path: &Path, fullscreen: bool, resolution_scale: u32) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let existing = if path.is_file() {
        fs::read_to_string(path).map_err(|e| e.to_string())?
    } else {
        String::from("[UI]\nSetupWizardIncomplete=false\n")
    };
    let scale = clamp_scale(resolution_scale).to_string();
    let mut next = ini_set_section_keys(
        &existing,
        "UI",
        &[(
            "StartFullscreen",
            if fullscreen { "true" } else { "false" }.into(),
        )],
    );
    next = ini_set_section_keys(
        &next,
        "EmuCore/GS",
        &[("upscale_multiplier", scale)],
    );
    fs::write(path, next).map_err(|e| e.to_string())
}

fn retroarch_core_options_path(cfg_path: &Path) -> PathBuf {
    cfg_path
        .parent()
        .unwrap_or(cfg_path)
        .join("retroarch-core-options.cfg")
}

fn read_retroarch_video(cfg_path: &Path) -> RuntimeVideoSettings {
    let defaults = RuntimeVideoSettings {
        runtime_kind: "retroarch".into(),
        fullscreen: true,
        resolution_scale: 1,
        scale_options: default_scale_options(),
    };
    if !cfg_path.is_file() {
        return defaults;
    }
    let Ok(raw) = fs::read_to_string(cfg_path) else {
        return defaults;
    };
    let fullscreen = cfg_get(&raw, "video_fullscreen")
        .and_then(|v| parse_boolish(&v))
        .unwrap_or(true);
    let mut resolution_scale = cfg_get(&raw, "video_scale")
        .and_then(|v| parse_scale_number(&v))
        .unwrap_or(1);
    let core_opts = retroarch_core_options_path(cfg_path);
    if let Ok(core_raw) = fs::read_to_string(&core_opts) {
        if let Some(s) = cfg_get(&core_raw, "swanstation_GPU_ResolutionScale")
            .or_else(|| cfg_get(&core_raw, "beetle_psx_hw_internal_resolution"))
            .and_then(|v| parse_scale_number(&v))
        {
            resolution_scale = s;
        }
    }
    RuntimeVideoSettings {
        runtime_kind: "retroarch".into(),
        fullscreen,
        resolution_scale,
        scale_options: defaults.scale_options,
    }
}

fn write_retroarch_video(
    cfg_path: &Path,
    fullscreen: bool,
    resolution_scale: u32,
) -> Result<(), String> {
    if let Some(parent) = cfg_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let existing = if cfg_path.is_file() {
        fs::read_to_string(cfg_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let scale = clamp_scale(resolution_scale);
    let pairs = [
        (
            "video_fullscreen",
            if fullscreen { "true" } else { "false" }.into(),
        ),
        ("video_windowed_fullscreen", "true".into()),
        ("video_scale", scale.to_string()),
        ("video_scale_integer", "true".into()),
    ];
    let next = cfg_set(&existing, &pairs);
    fs::write(cfg_path, next).map_err(|e| e.to_string())?;

    // Escala interna del core PS1 (SwanStation / Beetle).
    let core_path = retroarch_core_options_path(cfg_path);
    let core_existing = if core_path.is_file() {
        fs::read_to_string(&core_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let scale_s = scale.to_string();
    let core_next = cfg_set(
        &core_existing,
        &[
            ("swanstation_GPU_ResolutionScale", scale_s.clone()),
            ("beetle_psx_hw_internal_resolution", scale_s),
        ],
    );
    fs::write(core_path, core_next).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_runtime_video_settings(
    app: AppHandle,
    executable_path: String,
    runtime_kind: String,
    runtime_source: Option<String>,
) -> Result<RuntimeVideoSettings, String> {
    let kind = normalize_kind(&runtime_kind)?;
    let exe = PathBuf::from(executable_path.trim());
    if !exe.is_file() {
        return Err("No se encontró el ejecutable del emulador.".into());
    }
    let (config_path, _) = resolve_paths(&app, kind, &exe, runtime_source.as_deref())?;
    Ok(match kind {
        "eden" => read_eden_video(&config_path),
        "pcsx2" => read_pcsx2_video(&config_path),
        "retroarch" => read_retroarch_video(&config_path),
        _ => return Err("Runtime no soportado.".into()),
    })
}

#[tauri::command]
pub fn write_runtime_video_settings(
    app: AppHandle,
    executable_path: String,
    runtime_kind: String,
    runtime_source: Option<String>,
    fullscreen: bool,
    resolution_scale: u32,
) -> Result<(), String> {
    let kind = normalize_kind(&runtime_kind)?;
    let exe = PathBuf::from(executable_path.trim());
    if !exe.is_file() {
        return Err("No se encontró el ejecutable del emulador.".into());
    }
    let scale = clamp_scale(resolution_scale);
    let (config_path, _) = resolve_paths(&app, kind, &exe, runtime_source.as_deref())?;
    match kind {
        "eden" => write_eden_video(&config_path, fullscreen, scale),
        "pcsx2" => write_pcsx2_video(&config_path, fullscreen, scale),
        "retroarch" => write_retroarch_video(&config_path, fullscreen, scale),
        _ => Err("Runtime no soportado.".into()),
    }
}

#[tauri::command]
pub fn list_audio_output_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    let host = cpal::default_host();
    let mut devices = Vec::new();
    devices.push(AudioDeviceInfo {
        id: "auto".into(),
        name: "Automático (sistema)".into(),
    });
    let Ok(iter) = host.output_devices() else {
        return Ok(devices);
    };
    for (i, dev) in iter.enumerate() {
        let name = dev
            .name()
            .unwrap_or_else(|_| format!("Dispositivo {i}"));
        devices.push(AudioDeviceInfo {
            id: name.clone(),
            name,
        });
    }
    Ok(devices)
}

#[tauri::command]
pub fn list_game_controllers() -> Result<Vec<GameControllerInfo>, String> {
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};
        for i in 0u32..4 {
            unsafe {
                let mut state: XINPUT_STATE = std::mem::zeroed();
                if XInputGetState(i, &mut state) == 0 {
                    out.push(GameControllerInfo {
                        id: format!("xinput-{i}"),
                        name: format!("Controlador XInput {i}"),
                    });
                }
            }
        }
    }
    if out.is_empty() {
        out.push(GameControllerInfo {
            id: "none".into(),
            name: "Ningún mando XInput detectado".into(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn read_runtime_audio_settings(
    app: AppHandle,
    executable_path: String,
    runtime_kind: String,
    runtime_source: Option<String>,
) -> Result<RuntimeAudioSettings, String> {
    let kind = normalize_kind(&runtime_kind)?;
    let exe = PathBuf::from(executable_path.trim());
    if !exe.is_file() {
        return Err("No se encontró el ejecutable del emulador.".into());
    }
    let (config_path, _) = resolve_paths(&app, kind, &exe, runtime_source.as_deref())?;
    Ok(match kind {
        "eden" => read_eden(&config_path),
        "pcsx2" => read_pcsx2(&config_path),
        "retroarch" => read_retroarch(&config_path),
        _ => return Err("Runtime no soportado.".into()),
    })
}

#[tauri::command]
pub fn write_runtime_audio_settings(
    app: AppHandle,
    executable_path: String,
    runtime_kind: String,
    runtime_source: Option<String>,
    output_engine: String,
    output_device: String,
    volume: u32,
) -> Result<(), String> {
    let kind = normalize_kind(&runtime_kind)?;
    let exe = PathBuf::from(executable_path.trim());
    if !exe.is_file() {
        return Err("No se encontró el ejecutable del emulador.".into());
    }
    let engine = output_engine.trim();
    let device = output_device.trim();
    if engine.is_empty() {
        return Err("Motor de audio inválido.".into());
    }
    let (config_path, _) = resolve_paths(&app, kind, &exe, runtime_source.as_deref())?;
    match kind {
        "eden" => write_eden(&config_path, engine, device, volume),
        "pcsx2" => write_pcsx2(&config_path, engine, device, volume),
        "retroarch" => write_retroarch(&config_path, engine, device, volume),
        _ => Err("Runtime no soportado.".into()),
    }
}

#[tauri::command]
pub fn launch_runtime_config_ui(
    app: AppHandle,
    executable_path: String,
    runtime_kind: String,
    runtime_source: Option<String>,
) -> Result<(), String> {
    let kind = normalize_kind(&runtime_kind)?;
    let exe = PathBuf::from(executable_path.trim());
    if !exe.is_file() {
        return Err("No se encontró el ejecutable del emulador.".into());
    }
    if kind == "eden" {
        let app_data = app_data_dir(&app)?;
        let managed = managed_data_root(&app_data, "eden");
        sync_eden_portable_user(&exe, &managed).map_err(|e| format!("{e:?}"))?;
    } else {
        let _ = resolve_paths(&app, kind, &exe, runtime_source.as_deref())?;
    }
    let cwd = exe
        .parent()
        .ok_or_else(|| "Ruta de emulador inválida.".to_string())?;
    Command::new(&exe)
        .current_dir(cwd)
        .spawn()
        .map_err(|e| format!("No se pudo abrir el emulador: {e}"))?;
    Ok(())
}

// Compat: comandos Eden previos.
#[tauri::command]
pub fn read_eden_audio_settings(executable_path: String) -> Result<RuntimeAudioSettings, String> {
    let exe = PathBuf::from(executable_path.trim());
    if !exe.is_file() {
        return Err("No se encontró eden.exe.".into());
    }
    Ok(read_eden(&eden_user_config_ini(&exe)))
}

#[tauri::command]
pub fn write_eden_audio_settings(
    executable_path: String,
    output_engine: String,
    output_device: String,
    volume: u32,
) -> Result<(), String> {
    let exe = PathBuf::from(executable_path.trim());
    if !exe.is_file() {
        return Err("No se encontró eden.exe.".into());
    }
    write_eden(
        &eden_user_config_ini(&exe),
        output_engine.trim(),
        output_device.trim(),
        volume,
    )
}

#[tauri::command]
pub fn launch_eden_config_ui(app: AppHandle, executable_path: String) -> Result<(), String> {
    launch_runtime_config_ui(app, executable_path, "eden".into(), Some("managed".into()))
}

#[tauri::command]
pub fn reveal_path_in_explorer(path: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if !p.exists() {
        return Err("La ruta no existe.".into());
    }
    let arg = if p.is_dir() {
        p.to_string_lossy().to_string()
    } else {
        format!("/select,{}", p.to_string_lossy())
    };
    Command::new("explorer")
        .arg(&arg)
        .spawn()
        .map_err(|e| format!("No se pudo abrir el Explorador: {e}"))?;
    Ok(())
}
