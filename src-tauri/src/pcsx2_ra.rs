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
pub fn open_pcsx2_for_configuration(executable_path: String) -> Result<(), String> {
    open_emulator_for_configuration(executable_path)
}
