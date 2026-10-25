//! Compatibilidad Fase 4B-1: API PCSX2 reutiliza el inspector unificado.
use crate::ra_status::{
    inspect_path, open_emulator_for_configuration, EmulatorRaStatus,
};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pcsx2RaStatus {
    pub executable_found: bool,
    pub executable_path: Option<String>,
    pub config_dir: Option<String>,
    pub ini_path: Option<String>,
    pub ini_found: bool,
    pub secrets_found: bool,
    pub achievements_enabled: bool,
    pub has_username: bool,
    pub has_token: bool,
    pub username: Option<String>,
    pub login_timestamp: Option<String>,
    pub status: String,
    pub status_label: String,
    pub notes: Vec<String>,
}

fn to_pcsx2(status: EmulatorRaStatus) -> Pcsx2RaStatus {
    Pcsx2RaStatus {
        executable_found: status.executable_found,
        executable_path: status.executable_path,
        config_dir: status.config_dir,
        ini_path: status.config_path,
        ini_found: status.config_found,
        secrets_found: status.secrets_found,
        achievements_enabled: status.achievements_enabled,
        has_username: status.has_username,
        has_token: status.has_token,
        username: status.username,
        login_timestamp: status.login_timestamp,
        status: status.status,
        status_label: status.status_label,
        notes: status.notes,
    }
}

#[tauri::command]
pub fn inspect_pcsx2_retroachievements(executable_path: String) -> Result<Pcsx2RaStatus, String> {
    Ok(to_pcsx2(inspect_path(
        &executable_path,
        None,
        None,
        None,
    )?))
}

#[tauri::command]
pub fn open_pcsx2_for_configuration(
    app: tauri::AppHandle,
    executable_path: String,
) -> Result<(), String> {
    use crate::emulator_data::{
        app_data_dir, managed_data_root, pcsx2_bios_directory, pcsx2_internal_data_root,
    };
    use crate::pcsx2_bios_lang::ensure_pcsx2_bios_language;
    use crate::ra_status::{
        open_emulator_for_configuration, open_emulator_for_configuration_with_args,
    };

    let app_data = app_data_dir(&app)?;
    let datapath = managed_data_root(&app_data, "pcsx2");
    let bios_dir = pcsx2_bios_directory(&pcsx2_internal_data_root(&datapath));
    let _ = ensure_pcsx2_bios_language(&bios_dir, "es");

    if datapath.is_dir() {
        open_emulator_for_configuration_with_args(
            executable_path,
            &[
                "-datapath".to_string(),
                datapath.to_string_lossy().to_string(),
            ],
        )
    } else {
        open_emulator_for_configuration(executable_path)
    }
}
