use crate::emulator_data::{resolve_emulator_paths, RuntimeDataSource};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorRaStatus {
    pub emulator_kind: String,
    pub executable_found: bool,
    pub executable_path: Option<String>,
    pub config_dir: Option<String>,
    pub config_path: Option<String>,
    pub config_found: bool,
    pub secrets_found: bool,
    pub achievements_enabled: bool,
    pub has_username: bool,
    pub has_token: bool,
    pub username: Option<String>,
    pub login_timestamp: Option<String>,
    /// unavailable | not_configured | disabled | ready | unsupported
    pub status: String,
    pub status_label: String,
    pub notes: Vec<String>,
}

fn is_blocked_script(path: &Path) -> bool {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
    {
        Some(ext) => matches!(ext.as_str(), "bat" | "cmd" | "ps1" | "vbs"),
        None => false,
    }
}

fn is_exe(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("exe"))
        .unwrap_or(false)
}

fn validate_exe(executable_path: &str) -> Result<PathBuf, String> {
    let exe = PathBuf::from(executable_path);
    if !exe.is_file() {
        return Err("El ejecutable no existe.".to_string());
    }
    if is_blocked_script(&exe) {
        return Err("No se permiten scripts (.bat, .cmd, .ps1, .vbs).".to_string());
    }
    if !is_exe(&exe) {
        return Err("El ejecutable debe ser un archivo .exe.".to_string());
    }
    Ok(exe)
}

pub fn detect_kind(exe: &Path) -> &'static str {
    let name = exe
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name.contains("pcsx2") {
        "pcsx2"
    } else if name.contains("retroarch") {
        "retroarch"
    } else {
        "unknown"
    }
}

fn parse_ini_section(content: &str, section: &str) -> Vec<(String, String)> {
    let mut in_section = false;
    let mut pairs = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let name = &trimmed[1..trimmed.len() - 1];
            in_section = name.eq_ignore_ascii_case(section);
            continue;
        }
        if !in_section {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            pairs.push((k.trim().to_string(), v.trim().to_string()));
        }
    }
    pairs
}

fn parse_retroarch_cfg(content: &str) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((k, rest)) = trimmed.split_once('=') else {
            continue;
        };
        let mut v = rest.trim().to_string();
        if v.starts_with('"') && v.ends_with('"') && v.len() >= 2 {
            v = v[1..v.len() - 1].to_string();
        }
        pairs.push((k.trim().to_string(), v));
    }
    pairs
}

fn cfg_get(pairs: &[(String, String)], key: &str) -> Option<String> {
    pairs
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.clone())
}

fn cfg_get_bool(pairs: &[(String, String)], key: &str) -> bool {
    matches!(
        cfg_get(pairs, key).as_deref().map(|v| v.to_ascii_lowercase()),
        Some(ref v) if v == "true" || v == "1" || v == "yes"
    )
}

fn has_nonempty(pairs: &[(String, String)], key: &str) -> bool {
    cfg_get(pairs, key)
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false)
}

#[allow(clippy::too_many_arguments)]
fn build_status(
    emulator_kind: &str,
    executable_path: Option<String>,
    executable_found: bool,
    config_dir: Option<String>,
    config_path: Option<String>,
    config_found: bool,
    secrets_found: bool,
    achievements_enabled: bool,
    username: Option<String>,
    login_timestamp: Option<String>,
    has_token: bool,
    notes: Vec<String>,
) -> EmulatorRaStatus {
    let has_username = username
        .as_ref()
        .map(|u| !u.trim().is_empty())
        .unwrap_or(false);

    let kind_label = match emulator_kind {
        "pcsx2" => "PCSX2",
        "retroarch" => "RetroArch",
        _ => "Emulador",
    };

    let (status, status_label) = if emulator_kind == "unknown" {
        (
            "unsupported".to_string(),
            "Emulador sin detector RA específico".to_string(),
        )
    } else if !executable_found {
        (
            "unavailable".to_string(),
            format!("{kind_label} no encontrado"),
        )
    } else if !config_found {
        (
            "unavailable".to_string(),
            format!("Configuración de {kind_label} no encontrada"),
        )
    } else if !has_username || !has_token {
        ("not_configured".to_string(), "No configurado".to_string())
    } else if !achievements_enabled {
        (
            "disabled".to_string(),
            "Credenciales guardadas (logros desactivados)".to_string(),
        )
    } else {
        ("ready".to_string(), "Conectado".to_string())
    };

    EmulatorRaStatus {
        emulator_kind: emulator_kind.to_string(),
        executable_found,
        executable_path,
        config_dir,
        config_path,
        config_found,
        secrets_found,
        achievements_enabled,
        has_username,
        has_token,
        username,
        login_timestamp,
        status,
        status_label,
        notes,
    }
}

fn inspect_pcsx2(
    exe: &Path,
    app_data: Option<&Path>,
    source: RuntimeDataSource,
    runtime_type: &str,
) -> Result<EmulatorRaStatus, String> {
    let paths = resolve_emulator_paths(app_data, source, runtime_type, exe);
    let data_root = paths
        .pcsx2_data_root
        .ok_or_else(|| "No se pudo resolver el directorio de configuración de PCSX2.".to_string())?;
    let settings_dir = data_root.join("inis");
    let ini_path = settings_dir.join("PCSX2.ini");
    let secrets_path = settings_dir.join("secrets.ini");
    let mut notes = vec![format!("Fuente: PCSX2 · {}", data_root.display())];

    if !ini_path.is_file() {
        notes.push("PCSX2.ini no existe. Abrí PCSX2 al menos una vez.".to_string());
        return Ok(build_status(
            "pcsx2",
            Some(exe.display().to_string()),
            true,
            Some(data_root.display().to_string()),
            Some(ini_path.display().to_string()),
            false,
            secrets_path.is_file(),
            false,
            None,
            None,
            false,
            notes,
        ));
    }

    let ini_content =
        fs::read_to_string(&ini_path).map_err(|_| "No se pudo leer PCSX2.ini.".to_string())?;
    let achievements = parse_ini_section(&ini_content, "Achievements");
    let achievements_enabled = cfg_get_bool(&achievements, "Enabled");
    let username = cfg_get(&achievements, "Username").filter(|u| !u.trim().is_empty());
    let login_timestamp =
        cfg_get(&achievements, "LoginTimestamp").filter(|t| !t.trim().is_empty());

    let mut has_token = has_nonempty(&achievements, "Token");
    let secrets_found = secrets_path.is_file();
    if !has_token && secrets_found {
        let secrets_content = fs::read_to_string(&secrets_path)
            .map_err(|_| "No se pudo leer secrets.ini.".to_string())?;
        let secrets_achievements = parse_ini_section(&secrets_content, "Achievements");
        has_token = has_nonempty(&secrets_achievements, "Token");
        notes.push("Token detectado en secrets.ini (no se expone).".to_string());
    }

    if username.is_none() {
        notes.push("Sin Username. Iniciá sesión en PCSX2 → Logros.".to_string());
    }
    if !has_token {
        notes.push("Sin token RA. Iniciá sesión en PCSX2.".to_string());
    }
    if !achievements_enabled {
        notes.push("Logros desactivados en PCSX2.".to_string());
    }

    Ok(build_status(
        "pcsx2",
        Some(exe.display().to_string()),
        true,
        Some(data_root.display().to_string()),
        Some(ini_path.display().to_string()),
        true,
        secrets_found,
        achievements_enabled,
        username,
        login_timestamp,
        has_token,
        notes,
    ))
}

fn inspect_retroarch(
    exe: &Path,
    app_data: Option<&Path>,
    source: RuntimeDataSource,
    runtime_type: &str,
) -> Result<EmulatorRaStatus, String> {
    let paths = resolve_emulator_paths(app_data, source, runtime_type, exe);
    let cfg_path = paths
        .retroarch_cfg
        .ok_or_else(|| "No se pudo resolver retroarch.cfg.".to_string())?;
    let config_dir = cfg_path
        .parent()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let mut notes = vec![format!("Fuente: RetroArch · {}", cfg_path.display())];

    if !cfg_path.is_file() {
        notes.push("retroarch.cfg no existe. Abrí RetroArch al menos una vez.".to_string());
        return Ok(build_status(
            "retroarch",
            Some(exe.display().to_string()),
            true,
            Some(config_dir),
            Some(cfg_path.display().to_string()),
            false,
            false,
            false,
            None,
            None,
            false,
            notes,
        ));
    }

    let content =
        fs::read_to_string(&cfg_path).map_err(|_| "No se pudo leer retroarch.cfg.".to_string())?;
    let pairs = parse_retroarch_cfg(&content);

    let achievements_enabled = cfg_get_bool(&pairs, "cheevos_enable");
    let username = cfg_get(&pairs, "cheevos_username").filter(|u| !u.trim().is_empty());
    // RetroArch often keeps password until a successful login mints cheevos_token.
    // Treat either as credentials; never read or expose the password value.
    let has_password = has_nonempty(&pairs, "cheevos_password");
    let has_token = has_nonempty(&pairs, "cheevos_token");
    let has_credentials = has_token || has_password;

    if username.is_none() {
        notes.push("Sin cheevos_username. Ajustes → Logros en RetroArch.".to_string());
    }
    if !has_credentials {
        notes.push(
            "Sin login RA. Completá usuario y contraseña en RetroArch → Logros.".to_string(),
        );
    } else if has_password && !has_token {
        notes.push(
            "Credenciales presentes (password en cfg; token aún vacío).".to_string(),
        );
    }
    if !achievements_enabled {
        notes.push("cheevos_enable = false. Activá Logros en RetroArch.".to_string());
    }
    notes.push("La contraseña de RA no se lee ni se copia a Blaze.".to_string());

    Ok(build_status(
        "retroarch",
        Some(exe.display().to_string()),
        true,
        Some(config_dir),
        Some(cfg_path.display().to_string()),
        true,
        has_password,
        achievements_enabled,
        username,
        None,
        has_credentials,
        notes,
    ))
}

pub fn inspect_path(
    executable_path: &str,
    app_data: Option<&Path>,
    runtime_source: Option<&str>,
    runtime_type: Option<&str>,
) -> Result<EmulatorRaStatus, String> {
    let source = RuntimeDataSource::parse(runtime_source);
    let exe = match validate_exe(executable_path) {
        Ok(p) => p,
        Err(_) => {
            return Ok(build_status(
                "unknown",
                Some(executable_path.to_string()),
                false,
                None,
                None,
                false,
                false,
                false,
                None,
                None,
                false,
                vec!["El ejecutable configurado en Runtime no existe.".to_string()],
            ));
        }
    };

    let kind = detect_kind(&exe);
    let type_key = runtime_type.unwrap_or(kind);

    match kind {
        "pcsx2" => inspect_pcsx2(&exe, app_data, source, type_key),
        "retroarch" => inspect_retroarch(&exe, app_data, source, type_key),
        _ => Ok(build_status(
            "unknown",
            Some(exe.display().to_string()),
            true,
            None,
            None,
            false,
            false,
            false,
            None,
            None,
            false,
            vec![
                "Este runtime no tiene detector RA integrado todavía.".to_string(),
                "Si tenés RA en PCSX2 o RetroArch, Blaze puede usar ese usuario para el progreso.".to_string(),
            ],
        )),
    }
}

#[tauri::command]
pub fn inspect_emulator_retroachievements(
    app: AppHandle,
    executable_path: String,
    runtime_source: Option<String>,
    runtime_type: Option<String>,
) -> Result<EmulatorRaStatus, String> {
    let app_data_buf = app.path().app_data_dir().ok();
    inspect_path(
        &executable_path,
        app_data_buf.as_deref(),
        runtime_source.as_deref(),
        runtime_type.as_deref(),
    )
}

#[tauri::command]
pub fn open_emulator_for_configuration(executable_path: String) -> Result<(), String> {
    let exe = validate_exe(&executable_path)?;
    let mut cmd = Command::new(&exe);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    cmd.spawn()
        .map_err(|_| "No se pudo abrir el emulador.".to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::emulator_data::{
        seed_retroarch_cfg_if_missing, RuntimeDataSource,
    };

    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir()
            .join("blaze-ra-status-tests")
            .join(name)
            .join(format!("{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn managed_retroarch_seeded_cfg_without_credentials_is_not_configured() {
        let app = temp("ra-no-creds");
        let exe = app.join("retroarch.exe");
        fs::write(&exe, b"fake").unwrap();
        let managed = crate::emulator_data::managed_data_root(&app, "retroarch");
        seed_retroarch_cfg_if_missing(&managed).unwrap();

        let status = inspect_path(
            exe.to_str().unwrap(),
            Some(&app),
            Some("managed"),
            Some("retroarch"),
        )
        .unwrap();
        assert_eq!(status.status, "not_configured");
        assert!(!status.has_username);
        assert!(!status.has_token);
        assert!(status.config_found);
        let cfg = fs::read_to_string(managed.join("retroarch.cfg")).unwrap();
        assert!(!cfg.to_ascii_lowercase().contains("cheevos"));
    }

    #[test]
    fn managed_retroarch_cfg_with_credentials_is_ready() {
        let app = temp("ra-creds");
        let exe = app.join("retroarch.exe");
        fs::write(&exe, b"fake").unwrap();
        let managed = crate::emulator_data::managed_data_root(&app, "retroarch");
        fs::create_dir_all(&managed).unwrap();
        let cfg = managed.join("retroarch.cfg");
        fs::write(
            &cfg,
            format!(
                "config_save_on_exit = \"true\"\n\
                 savefile_directory = \"{0}/saves\"\n\
                 savestate_directory = \"{0}/states\"\n\
                 system_directory = \"{0}/system\"\n\
                 core_assets_directory = \"{0}/assets\"\n\
                 cheevos_enable = \"true\"\n\
                 cheevos_username = \"blaze_user\"\n\
                 cheevos_token = \"tok_abc\"\n",
                managed.display()
            ),
        )
        .unwrap();

        let status = inspect_path(
            exe.to_str().unwrap(),
            Some(&app),
            Some("managed"),
            Some("retroarch"),
        )
        .unwrap();
        assert_eq!(status.status, "ready");
        assert_eq!(status.username.as_deref(), Some("blaze_user"));
        assert!(status.has_token);
        assert!(status.achievements_enabled);

        // La resolución managed no debe apuntar al cfg del exe.
        let paths = resolve_emulator_paths(
            Some(&app),
            RuntimeDataSource::Managed,
            "retroarch",
            &exe,
        );
        assert_eq!(paths.retroarch_cfg.as_ref(), Some(&cfg));
    }
}
