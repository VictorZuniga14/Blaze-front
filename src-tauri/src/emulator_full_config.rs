//! Configuración completa automatizada de emuladores para Blaze.
//! El usuario nunca configura manualmente: todo se hace desde Blaze con valores por defecto sensatos.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Configuración completa de un emulador gestionada por Blaze.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorConfig {
    /// Tipo: pcsx2, retroarch, eden
    pub runtime_kind: String,
    
    // Video
    pub fullscreen: bool,
    pub resolution_scale: u32,  // 1=Native, 2=2x, 3=3x, 4=4x
    pub renderer: String,       // d3d11, opengl, vulkan, auto
    pub vsync: bool,
    
    // Audio
    pub audio_engine: String,   // xaudio2, wasapi, auto
    pub audio_device: String,   // "auto" o nombre del dispositivo
    pub volume: u32,            // 0-100
    
    // Controles: layout preferido `auto` | `playstation` | `xbox` (antes default/custom)
    pub controller_profile: String,
    
    // UI
    pub ui_language: String,    // "es", "en", "auto"
    pub show_fps: bool,
    pub show_notifications: bool,
    
    // Hotkeys
    pub hotkey_save_state: String,
    pub hotkey_load_state: String,
    pub hotkey_pause: String,
    pub hotkey_exit: String,
    pub hotkey_fullscreen: String,
}

impl Default for EmulatorConfig {
    fn default() -> Self {
        Self {
            runtime_kind: "unknown".into(),
            fullscreen: true,
            resolution_scale: 2,  // 2x por defecto (buen balance)
            renderer: "auto".into(),
            vsync: true,
            audio_engine: "auto".into(),
            audio_device: "auto".into(),
            volume: 80,
            controller_profile: "auto".into(),
            ui_language: "es".into(),
            show_fps: false,
            show_notifications: true,
            hotkey_save_state: "F1".into(),
            hotkey_load_state: "F3".into(),
            hotkey_pause: "Pause".into(),
            // Salir solo desde Blaze o cerrando la ventana por fuera — Escape no cierra.
            hotkey_exit: "".into(),
            // Escape solo sale de fullscreen; el juego sigue.
            hotkey_fullscreen: "Escape".into(),
        }
    }
}

impl EmulatorConfig {
    /// Configuración por defecto para PCSX2.
    pub fn pcsx2_defaults() -> Self {
        Self {
            runtime_kind: "pcsx2".into(),
            renderer: "d3d11".into(),  // Direct3D 11 (mejor compatibilidad Windows)
            resolution_scale: 2,       // 2x Native (1920x1056)
            ..Default::default()
        }
    }

    /// Configuración por defecto para RetroArch.
    pub fn retroarch_defaults() -> Self {
        Self {
            runtime_kind: "retroarch".into(),
            renderer: "d3d11".into(),
            resolution_scale: 2,  // Variable según el core
            show_fps: false,      // No mostrar FPS por defecto
            ..Default::default()
        }
    }

    /// Configuración por defecto para Eden.
    pub fn eden_defaults() -> Self {
        Self {
            runtime_kind: "eden".into(),
            renderer: "vulkan".into(),  // Vulkan (mejor para Switch)
            resolution_scale: 2,         // 2x Native (1920x1080)
            ui_language: "es".into(),
            ..Default::default()
        }
    }
}

/// Capacidades de configuración por emulador.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorConfigCapabilities {
    pub runtime_kind: String,
    
    // Qué se puede configurar
    pub supports_resolution_scale: bool,
    pub supports_renderer_choice: bool,
    pub supports_vsync: bool,
    pub supports_audio_engine: bool,
    pub supports_ui_language: bool,
    pub supports_hotkeys: bool,
    pub supports_controller_profiles: bool,
    
    // Valores disponibles
    pub available_renderers: Vec<String>,
    pub available_languages: Vec<String>,
    pub max_resolution_scale: u32,
}

impl EmulatorConfigCapabilities {
    pub fn for_pcsx2() -> Self {
        Self {
            runtime_kind: "pcsx2".into(),
            supports_resolution_scale: true,
            supports_renderer_choice: true,
            supports_vsync: true,
            supports_audio_engine: true,
            supports_ui_language: false,  // PCSX2 no tiene config de idioma
            supports_hotkeys: true,
            supports_controller_profiles: true,
            available_renderers: vec![
                "auto".into(),
                "d3d11".into(),
                "d3d12".into(),
                "opengl".into(),
                "vulkan".into(),
            ],
            available_languages: vec![],
            max_resolution_scale: 8,  // PCSX2 soporta hasta 8x
        }
    }

    pub fn for_retroarch() -> Self {
        Self {
            runtime_kind: "retroarch".into(),
            supports_resolution_scale: true,
            supports_renderer_choice: true,
            supports_vsync: true,
            supports_audio_engine: true,
            supports_ui_language: true,
            supports_hotkeys: true,
            supports_controller_profiles: true,
            available_renderers: vec![
                "auto".into(),
                "d3d11".into(),
                "opengl".into(),
                "vulkan".into(),
            ],
            available_languages: vec![
                "en".into(),
                "es".into(),
                "pt".into(),
                "fr".into(),
                "de".into(),
            ],
            max_resolution_scale: 8,
        }
    }

    pub fn for_eden() -> Self {
        Self {
            runtime_kind: "eden".into(),
            supports_resolution_scale: true,
            supports_renderer_choice: true,
            supports_vsync: true,
            supports_audio_engine: false,  // Eden usa audio del sistema
            supports_ui_language: true,
            supports_hotkeys: false,  // Eden 0.2.1 no tiene hotkeys configurables
            supports_controller_profiles: false,
            available_renderers: vec![
                "vulkan".into(),
                "opengl".into(),
            ],
            available_languages: vec![
                "en".into(),
                "es".into(),
                "ja".into(),
            ],
            max_resolution_scale: 4,  // Eden 0.2.1 soporta hasta 4x
        }
    }
}

/// Aplica configuración completa a un emulador.
pub fn apply_full_config(
    config_path: &Path,
    config: &EmulatorConfig,
) -> Result<(), String> {
    match config.runtime_kind.as_str() {
        "pcsx2" => apply_pcsx2_config(config_path, config),
        "retroarch" => apply_retroarch_config(config_path, config),
        "eden" => apply_eden_config(config_path, config),
        other => Err(format!("Emulador no soportado: {}", other)),
    }
}

fn apply_pcsx2_config(path: &Path, cfg: &EmulatorConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let existing = if path.is_file() {
        fs::read_to_string(path).map_err(|e| e.to_string())?
    } else {
        String::from("[UI]\nSetupWizardIncomplete=false\n")
    };

    let mut content = existing;

    // UI
    content = ini_set_section(&content, "UI", &[
        ("SetupWizardIncomplete", "false"),
        ("StartFullscreen", if cfg.fullscreen { "true" } else { "false" }),
        ("ShowFPS", if cfg.show_fps { "true" } else { "false" }),
    ]);

    // GS (Graphics Synthesizer)
    content = ini_set_section(&content, "EmuCore/GS", &[
        ("upscale_multiplier", &cfg.resolution_scale.to_string()),
        ("vsync", if cfg.vsync { "1" } else { "0" }),
        ("Renderer", match cfg.renderer.as_str() {
            "d3d11" => "-1",   // Auto Direct3D
            "d3d12" => "14",
            "opengl" => "12",
            "vulkan" => "13",
            _ => "-1",
        }),
    ]);

    // Audio
    let audio_driver = match cfg.audio_engine.as_str() {
        "xaudio2" => "xaudio2",
        "wasapi" => "wasapi",
        _ => "xaudio2",  // Default en Windows
    };
    
    content = ini_set_section(&content, "SPU2/Mixing", &[
        ("FinalVolume", &cfg.volume.to_string()),
    ]);

    // Escape = solo fullscreen. Exit sin tecla (cerrar desde Blaze / por fuera).
    content = apply_pcsx2_escape_hotkeys(&content);
    content = apply_pcsx2_input_backends(&content, &cfg.controller_profile);

    fs::write(path, content).map_err(|e| e.to_string())
}

/// Activa SDL + XInput y Pad1 DualShock2 (la consola emulada siempre es DS2).
fn apply_pcsx2_input_backends(content: &str, layout: &str) -> String {
    let _ = layout; // layout guía preferencia en UI; PCSX2 recibe el pad vía SDL.
    let mut next = ini_set_section(
        content,
        "InputSources",
        &[
            ("SDL", "true"),
            ("XInput", "true"),
            ("Keyboard", "true"),
            ("Mouse", "true"),
        ],
    );
    next = ini_set_section(
        &next,
        "Pad1",
        &[("Type", "DualShock2")],
    );
    next
}

/// PCSX2: Escape → ToggleFullscreen; Exit sin bind (no menú / no cerrar con Esc).
fn apply_pcsx2_escape_hotkeys(content: &str) -> String {
    ini_set_section(
        content,
        "Hotkeys",
        &[
            ("ToggleFullscreen", "Keyboard/Escape"),
            // Vacío = sin atajo. Alt+Enter queda libre; Blaze es quien cierra el juego.
            ("Exit", ""),
        ],
    )
}

fn apply_retroarch_config(path: &Path, cfg: &EmulatorConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let existing = if path.is_file() {
        fs::read_to_string(path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };

    let volume_db = if cfg.volume == 0 {
        -80.0
    } else {
        (cfg.volume as f32 / 100.0) * 80.0 - 80.0
    };

    let audio_driver = match cfg.audio_engine.as_str() {
        "wasapi" => "wasapi",
        "xaudio2" => "xaudio",
        _ => "wasapi",  // Default en Windows
    };

    let video_driver = match cfg.renderer.as_str() {
        "d3d11" => "d3d11",
        "opengl" => "gl",
        "vulkan" => "vulkan",
        _ => "d3d11",
    };

    let pairs = [
        // Video
        ("video_fullscreen", if cfg.fullscreen { "true" } else { "false" }.to_string()),
        ("video_windowed_fullscreen", "true".to_string()),
        ("video_driver", video_driver.to_string()),
        ("video_vsync", if cfg.vsync { "true" } else { "false" }.to_string()),
        ("fps_show", if cfg.show_fps { "true" } else { "false" }.to_string()),
        
        // Audio
        ("audio_driver", audio_driver.to_string()),
        ("audio_device", cfg.audio_device.clone()),
        ("audio_volume", format!("{:.6}", volume_db)),
        
        // UI
        ("user_language", match cfg.ui_language.as_str() {
            "es" => "2".to_string(),  // Spanish
            "en" => "0".to_string(),  // English
            "pt" => "6".to_string(),  // Portuguese
            _ => "0".to_string(),
        }),
        
        // Network commands (para control)
        ("network_cmd_enable", "true".to_string()),
        ("network_cmd_port", "55355".to_string()),
        
        // Notifications
        ("video_font_enable", if cfg.show_notifications { "true" } else { "false" }.to_string()),
    ];

    let mut content = cfg_set_multiple(&existing, &pairs);
    content = apply_retroarch_escape_hotkeys(&content);
    content = apply_retroarch_input_backends(&content, &cfg.controller_profile);
    fs::write(path, content).map_err(|e| e.to_string())
}

fn apply_retroarch_input_backends(content: &str, layout: &str) -> String {
    let _ = layout;
    let pairs = [
        ("input_joypad_driver", "sdl2".to_string()),
        ("input_autodetect_enable", "true".to_string()),
        ("input_auto_game_focus", "1".to_string()),
    ];
    cfg_set_multiple(content, &pairs)
}

/// RetroArch: Escape → fullscreen; sin exit; sin menú nativo (F1 / desktop).
fn apply_retroarch_escape_hotkeys(content: &str) -> String {
    let pairs = [
        ("input_toggle_fullscreen", "escape".to_string()),
        ("input_exit_emulator", "nul".to_string()),
        ("input_menu_toggle", "nul".to_string()),
        ("input_desktop_menu_toggle", "nul".to_string()),
        ("quit_press_twice", "false".to_string()),
    ];
    cfg_set_multiple(content, &pairs)
}

fn apply_eden_config(path: &Path, cfg: &EmulatorConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let existing = if path.is_file() {
        fs::read_to_string(path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };

    let scale = cfg.resolution_scale.min(4);

    let mut content = existing;

    // UI
    content = ini_set_section(&content, "UI", &[
        ("fullscreen", if cfg.fullscreen { "true" } else { "false" }),
        ("language", match cfg.ui_language.as_str() {
            "es" => "es",
            "ja" => "ja",
            _ => "en",
        }),
    ]);

    // Renderer
    content = ini_set_section(&content, "Renderer", &[
        ("resolution_setup", &(scale - 1).to_string()),
        ("resolution_factor", &scale.to_string()),
        ("backend", match cfg.renderer.as_str() {
            "vulkan" => "vulkan",
            "opengl" => "opengl",
            _ => "vulkan",
        }),
        ("vsync", if cfg.vsync { "true" } else { "false" }),
    ]);

    // Audio (volumen general del sistema)
    content = ini_set_section(&content, "Audio", &[
        ("volume", &((cfg.volume as f32 / 100.0).to_string())),
    ]);

    content = apply_eden_escape_hotkeys(&content);

    fs::write(path, content).map_err(|e| e.to_string())
}

/// Eden/yuzu: Escape = Exit Fullscreen; Exit del emulador sin Esc.
fn apply_eden_escape_hotkeys(content: &str) -> String {
    let mut next = content.to_string();
    // Formato Qt de yuzu/suyu/Eden (secciones con backslash).
    next = ini_set_section(
        &next,
        r"UI\Shortcuts\Exit Fullscreen",
        &[("KeySeq", "Esc"), (r"KeySeq\default", "Esc")],
    );
    next = ini_set_section(
        &next,
        r"UI\Shortcuts\Fullscreen",
        &[("KeySeq", "F11"), (r"KeySeq\default", "F11")],
    );
    // Cerrar emulador: Ctrl+Q (no Escape). Salir real = Blaze / cerrar ventana.
    next = ini_set_section(
        &next,
        r"UI\Shortcuts\Exit",
        &[("KeySeq", "Ctrl+Q"), (r"KeySeq\default", "Ctrl+Q")],
    );
    next
}

/// Aplica la política Escape de Blaze sobre el archivo de config del runtime.
/// Llamar en cada launch para sobrescribir defaults del emulador / installs viejos.
pub fn apply_escape_hotkey_policy(
    runtime_kind: &str,
    config_path: &Path,
) -> Result<(), String> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let existing = if config_path.is_file() {
        fs::read_to_string(config_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let next = match runtime_kind {
        "pcsx2" => apply_pcsx2_escape_hotkeys(&existing),
        "retroarch" => apply_retroarch_escape_hotkeys(&existing),
        "eden" => apply_eden_escape_hotkeys(&existing),
        _ => return Ok(()),
    };
    if next != existing {
        fs::write(config_path, next).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Activa backends de mando (SDL) en PCSX2/RetroArch. Eden: no-op (UI nativa).
/// `layout`: auto | playstation | xbox
pub fn apply_input_backend_policy(
    runtime_kind: &str,
    config_path: &Path,
    layout: &str,
) -> Result<(), String> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let existing = if config_path.is_file() {
        fs::read_to_string(config_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let profile = if layout.is_empty() { "auto" } else { layout };
    let next = match runtime_kind {
        "pcsx2" => apply_pcsx2_input_backends(&existing, profile),
        "retroarch" => apply_retroarch_input_backends(&existing, profile),
        "eden" => return Ok(()),
        _ => return Ok(()),
    };
    if next != existing {
        fs::write(config_path, next).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Helper functions para manipular INI

fn ini_set_section(content: &str, section: &str, pairs: &[(&str, &str)]) -> String {
    let mut result = String::new();
    let mut in_target = false;
    let mut section_found = false;
    let section_header = format!("[{}]", section);
    let mut keys_to_set: std::collections::HashMap<String, String> = 
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();

    for line in content.lines() {
        let trimmed = line.trim();
        
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            // Si salimos de la sección target, agregar keys faltantes
            if in_target && !keys_to_set.is_empty() {
                for (key, value) in keys_to_set.iter() {
                    result.push_str(&format!("{}={}\n", key, value));
                }
                keys_to_set.clear();
            }
            
            in_target = trimmed.eq_ignore_ascii_case(&section_header);
            if in_target {
                section_found = true;
            }
            result.push_str(line);
            result.push('\n');
            continue;
        }

        if in_target {
            if let Some((key, _)) = trimmed.split_once('=') {
                let key_trimmed = key.trim();
                if let Some(new_value) = keys_to_set.remove(key_trimmed) {
                    result.push_str(&format!("{}={}\n", key_trimmed, new_value));
                    continue;
                }
            }
        }

        result.push_str(line);
        result.push('\n');
    }

    // Si la sección no existía, crearla al final
    if !section_found {
        result.push_str(&format!("\n{}\n", section_header));
        for (key, value) in pairs {
            result.push_str(&format!("{}={}\n", key, value));
        }
    } else if !keys_to_set.is_empty() {
        // Keys que no se encontraron en la sección
        for (key, value) in keys_to_set {
            result.push_str(&format!("{}={}\n", key, value));
        }
    }

    result
}

fn cfg_set_multiple(content: &str, pairs: &[(&str, String)]) -> String {
    let mut result = content.to_string();
    for (key, value) in pairs {
        result = cfg_set_pair(&result, key, value);
    }
    result
}

fn cfg_set_pair(content: &str, key: &str, value: &str) -> String {
    let mut result = String::new();
    let mut found = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if let Some((k, _)) = trimmed.split_once('=') {
            if k.trim() == key {
                result.push_str(&format!("{} = \"{}\"\n", key, value));
                found = true;
                continue;
            }
        }
        result.push_str(line);
        result.push('\n');
    }

    if !found {
        result.push_str(&format!("{} = \"{}\"\n", key, value));
    }

    result
}

#[tauri::command]
pub fn get_emulator_config_capabilities(runtime_kind: String) -> Result<EmulatorConfigCapabilities, String> {
    match runtime_kind.as_str() {
        "pcsx2" => Ok(EmulatorConfigCapabilities::for_pcsx2()),
        "retroarch" => Ok(EmulatorConfigCapabilities::for_retroarch()),
        "eden" => Ok(EmulatorConfigCapabilities::for_eden()),
        other => Err(format!("Emulador no soportado: {}", other)),
    }
}

#[tauri::command]
pub fn get_default_emulator_config(runtime_kind: String) -> Result<EmulatorConfig, String> {
    match runtime_kind.as_str() {
        "pcsx2" => Ok(EmulatorConfig::pcsx2_defaults()),
        "retroarch" => Ok(EmulatorConfig::retroarch_defaults()),
        "eden" => Ok(EmulatorConfig::eden_defaults()),
        other => Err(format!("Emulador no soportado: {}", other)),
    }
}

#[tauri::command]
pub fn apply_emulator_config(
    config_path: String,
    config: EmulatorConfig,
) -> Result<(), String> {
    let path = PathBuf::from(config_path);
    apply_full_config(&path, &config)
}
