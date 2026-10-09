use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum ProcessStatus {
    #[default]
    Idle,
    Starting,
    Running,
    Exited,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveProcessInfo {
    pub status: ProcessStatus,
    pub pid: Option<u32>,
    pub game_id: Option<String>,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessExitedPayload {
    pub game_id: String,
    pub pid: u32,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Default)]
pub struct ProcessSharedState {
    pub status: ProcessStatus,
    pub pid: Option<u32>,
    pub game_id: Option<String>,
    pub last_exit_code: Option<i32>,
}

pub struct ProcessManagerState {
    pub shared: Mutex<ProcessSharedState>,
}

impl Default for ProcessManagerState {
    fn default() -> Self {
        Self {
            shared: Mutex::new(ProcessSharedState::default()),
        }
    }
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

#[tauri::command]
pub fn path_check(path: String, kind: String) -> bool {
    let p = Path::new(&path);
    match kind.as_str() {
        "file" => p.is_file(),
        "dir" => p.is_dir(),
        _ => false,
    }
}

#[tauri::command]
pub fn get_active_process(state: State<'_, Arc<ProcessManagerState>>) -> ActiveProcessInfo {
    let shared = state.shared.lock().expect("process state lock");
    ActiveProcessInfo {
        status: shared.status.clone(),
        pid: shared.pid,
        game_id: shared.game_id.clone(),
        exit_code: shared.last_exit_code,
    }
}

#[tauri::command]
pub fn launch_native(
    app: AppHandle,
    state: State<'_, Arc<ProcessManagerState>>,
    game_id: String,
    executable_path: String,
    working_directory: Option<String>,
    arguments: Vec<String>,
) -> Result<ActiveProcessInfo, String> {
    {
        let shared = state
            .shared
            .lock()
            .map_err(|_| "No se pudo acceder al estado del proceso.".to_string())?;
        if matches!(
            shared.status,
            ProcessStatus::Starting | ProcessStatus::Running
        ) {
            return Err("Ya hay otro juego en ejecución.".to_string());
        }
    }

    let exe = Path::new(&executable_path);
    if !exe.is_file() {
        return Err("El ejecutable configurado ya no existe.".to_string());
    }
    if is_blocked_script(exe) {
        return Err("No se permiten scripts (.bat, .cmd, .ps1, .vbs).".to_string());
    }
    if !is_exe(exe) {
        return Err("El ejecutable debe ser un archivo .exe.".to_string());
    }

    if let Some(ref cwd) = working_directory {
        if !cwd.trim().is_empty() && !Path::new(cwd).is_dir() {
            return Err("El directorio de trabajo configurado ya no existe.".to_string());
        }
    }

    {
        let mut shared = state
            .shared
            .lock()
            .map_err(|_| "No se pudo acceder al estado del proceso.".to_string())?;
        shared.status = ProcessStatus::Starting;
        shared.pid = None;
        shared.game_id = Some(game_id.clone());
        shared.last_exit_code = None;
    }

    let mut command = Command::new(&executable_path);
    if let Some(ref cwd) = working_directory {
        if !cwd.trim().is_empty() {
            command.current_dir(cwd);
        }
    }
    command.args(&arguments);

    let child = match command.spawn() {
        Ok(child) => child,
        Err(_) => {
            let mut shared = state
                .shared
                .lock()
                .map_err(|_| "No se pudo acceder al estado del proceso.".to_string())?;
            shared.status = ProcessStatus::Error;
            shared.pid = None;
            shared.game_id = None;
            return Err("No se pudo iniciar el juego.".to_string());
        }
    };

    let pid = child.id();

    {
        let mut shared = state
            .shared
            .lock()
            .map_err(|_| "No se pudo acceder al estado del proceso.".to_string())?;
        shared.status = ProcessStatus::Running;
        shared.pid = Some(pid);
        shared.game_id = Some(game_id.clone());
        shared.last_exit_code = None;
    }

    let monitor_state = Arc::clone(&state);
    let monitor_game_id = game_id.clone();
    thread::spawn(move || {
        monitor_child(app, monitor_state, child, monitor_game_id, pid);
    });

    Ok(ActiveProcessInfo {
        status: ProcessStatus::Running,
        pid: Some(pid),
        game_id: Some(game_id),
        exit_code: None,
    })
}

fn monitor_child(
    app: AppHandle,
    state: Arc<ProcessManagerState>,
    mut child: Child,
    game_id: String,
    pid: u32,
) {
    let exit_code = match child.wait() {
        Ok(status) => status.code(),
        Err(_) => None,
    };

    {
        if let Ok(mut shared) = state.shared.lock() {
            if shared.pid == Some(pid) {
                shared.status = ProcessStatus::Exited;
                shared.last_exit_code = exit_code;
            }
        }
    }

    let _ = app.emit(
        "process-exited",
        ProcessExitedPayload {
            game_id,
            pid,
            exit_code,
        },
    );

    {
        if let Ok(mut shared) = state.shared.lock() {
            if shared.pid == Some(pid) {
                shared.status = ProcessStatus::Idle;
                shared.pid = None;
                shared.game_id = None;
            }
        }
    }
}
