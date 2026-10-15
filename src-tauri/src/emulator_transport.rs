//! Transporte IPC hacia emuladores: PINE (PCSX2), UDP (RetroArch), process mgmt (Eden).
//!
//! Arquitectura:
//! - PCSX2: PINE slot TCP local (puerto 28011 + slot)
//! - RetroArch: Network Commands UDP (puerto 55355)
//! - Eden: Solo gestión de proceso (sin IPC en v0.2.1)

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpStream, UdpSocket};
use std::time::Duration;
use tauri::AppHandle;

const PINE_BASE_PORT: u16 = 28011;
const PINE_TIMEOUT_MS: u64 = 2000;
const RETROARCH_UDP_PORT: u16 = 55355;
const RETROARCH_TIMEOUT_MS: u64 = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransportKind {
    Udp,
    Tcp,
    Stdio,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum AllowlistedCommand {
    Version,
    GetStatus,
    PauseToggle,
    SaveState,
    LoadState,
    PineSaveState { slot: u32 },
    PineLoadState { slot: u32 },
    PineStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransportDelivery {
    Confirmed,
    Sent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "ok", rename_all = "lowercase")]
pub enum TransportResult {
    #[serde(rename = "true")]
    Ok {
        delivery: TransportDelivery,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<String>,
    },
    #[serde(rename = "false")]
    Err {
        code: TransportErrorCode,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportErrorCode {
    Unsupported,
    NotRunning,
    Timeout,
    Unreachable,
    PortInUse,
}

impl TransportResult {
    fn ok(delivery: TransportDelivery, payload: Option<String>) -> Self {
        Self::Ok { delivery, payload }
    }

    fn err(code: TransportErrorCode, message: impl Into<String>) -> Self {
        Self::Err {
            code,
            message: message.into(),
        }
    }
}

/// PINE protocol para PCSX2 (slot TCP).
/// Spec: https://github.com/PCSX2/pcsx2/blob/master/pcsx2/IPC.h
fn send_pine_command(
    slot: u32,
    command: &AllowlistedCommand,
) -> Result<TransportResult, String> {
    let port = PINE_BASE_PORT + slot as u16;
    
    let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port))
        .and_then(|s| {
            s.set_read_timeout(Some(Duration::from_millis(PINE_TIMEOUT_MS)))?;
            s.set_write_timeout(Some(Duration::from_millis(PINE_TIMEOUT_MS)))?;
            Ok(s)
        })
        .map_err(|e| format!("No se pudo conectar a PINE slot {}: {}", slot, e))?;

    let pine_cmd = match command {
        AllowlistedCommand::PineStatus => b"MsgRead\x00".to_vec(),
        AllowlistedCommand::PineSaveState { slot } => {
            format!("MsgSaveState {}\x00", slot).into_bytes()
        }
        AllowlistedCommand::PineLoadState { slot } => {
            format!("MsgLoadState {}\x00", slot).into_bytes()
        }
        _ => return Err("Comando no soportado para PINE".into()),
    };

    stream
        .write_all(&pine_cmd)
        .map_err(|e| format!("Error escribiendo a PINE: {}", e))?;

    let mut response = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => response.extend_from_slice(&buf[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => break,
            Err(e) => return Err(format!("Error leyendo de PINE: {}", e)),
        }
        if response.len() > 64 * 1024 {
            break;
        }
    }

    let payload = String::from_utf8_lossy(&response).trim_end_matches('\0').to_string();
    
    Ok(TransportResult::ok(
        TransportDelivery::Confirmed,
        if payload.is_empty() { None } else { Some(payload) },
    ))
}

/// RetroArch Network Commands (UDP).
/// Spec: https://docs.libretro.com/development/retroarch/network-control-interface/
fn send_retroarch_udp(
    command: &AllowlistedCommand,
) -> Result<TransportResult, String> {
    let socket = UdpSocket::bind("127.0.0.1:0")
        .map_err(|e| format!("No se pudo crear socket UDP: {}", e))?;
    
    socket
        .set_read_timeout(Some(Duration::from_millis(RETROARCH_TIMEOUT_MS)))
        .map_err(|e| format!("Error configurando timeout: {}", e))?;

    let cmd_str = match command {
        AllowlistedCommand::Version => "VERSION",
        AllowlistedCommand::GetStatus => "GET_STATUS",
        AllowlistedCommand::PauseToggle => "PAUSE_TOGGLE",
        AllowlistedCommand::SaveState => "SAVE_STATE",
        AllowlistedCommand::LoadState => "LOAD_STATE",
        _ => return Err("Comando no soportado para RetroArch UDP".into()),
    };

    let cmd_bytes = format!("{}\n", cmd_str).into_bytes();
    
    socket
        .send_to(&cmd_bytes, format!("127.0.0.1:{}", RETROARCH_UDP_PORT))
        .map_err(|e| format!("Error enviando comando a RetroArch: {}", e))?;

    // RetroArch UDP no responde, es fire-and-forget
    Ok(TransportResult::ok(TransportDelivery::Sent, None))
}

/// Probe para verificar si RetroArch está escuchando en UDP.
pub fn probe_retroarch_udp() -> bool {
    if let Ok(socket) = UdpSocket::bind("127.0.0.1:0") {
        let _ = socket.set_read_timeout(Some(Duration::from_millis(100)));
        let _ = socket.send_to(b"VERSION\n", format!("127.0.0.1:{}", RETROARCH_UDP_PORT));
        // RetroArch no responde al VERSION, pero si el puerto está abierto no da error
        true
    } else {
        false
    }
}

/// Eden: Solo gestión de proceso, sin IPC en v0.2.1.
/// Las operaciones de control se manejan a nivel de proceso (kill, ventana).
pub fn check_eden_process(pid: u32) -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        use windows_sys::Win32::Foundation::CloseHandle;
        
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle != 0 {
                CloseHandle(handle);
                true
            } else {
                false
            }
        }
    }
    
    #[cfg(not(windows))]
    {
        use std::process::Command;
        Command::new("ps")
            .args(&["-p", &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

#[tauri::command]
pub async fn emulator_transport_send(
    _app: AppHandle,
    kind: TransportKind,
    command: AllowlistedCommand,
    slot: Option<u32>,
) -> Result<TransportResult, String> {
    tokio::task::spawn_blocking(move || {
        match kind {
            TransportKind::Tcp => {
                let slot = slot.unwrap_or(0);
                send_pine_command(slot, &command)
            }
            TransportKind::Udp => send_retroarch_udp(&command),
            TransportKind::Stdio => Err("Stdio transport no implementado".into()),
        }
    })
    .await
    .map_err(|e| format!("Error en task: {}", e))?
}

#[tauri::command]
pub fn emulator_transport_probe_retroarch() -> bool {
    probe_retroarch_udp()
}

#[tauri::command]
pub fn emulator_transport_check_process(pid: u32) -> bool {
    check_eden_process(pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_result_serialization() {
        let ok = TransportResult::ok(TransportDelivery::Confirmed, Some("test".into()));
        let json = serde_json::to_string(&ok).unwrap();
        assert!(json.contains("\"ok\":\"true\""));
        
        let err = TransportResult::err(TransportErrorCode::Timeout, "test error");
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"ok\":\"false\""));
    }

    #[test]
    fn eden_process_check_invalid_pid() {
        // PID muy alto que probablemente no existe
        assert!(!check_eden_process(9999999));
    }
}
