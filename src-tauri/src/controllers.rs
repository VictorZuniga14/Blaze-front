//! Detección de mandos (HID + XInput vía gilrs).
//! DualShock/DualSense aparecen aquí; XInput-only los dejaba invisibles.

use crate::emulator_data::{
    app_data_dir, managed_data_root, pcsx2_internal_data_root,
};
use crate::emulator_full_config::apply_input_backend_policy;
use gilrs::{EventType, Gilrs};
use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameControllerInfo {
    pub id: String,
    pub name: String,
    /// Identificador estable del dispositivo (uuid gilrs / slot).
    pub guid: String,
    /// `playstation` | `xbox` | `generic`
    pub kind: String,
    /// Slot de jugador 1-based (Player 1, Player 2…). `None` si es ítem informativo.
    pub player: Option<u32>,
}

/// Lista mandos reales (sin el ítem informativo “ninguno”), ordenados P1..Pn.
pub fn list_game_controllers_raw() -> Result<Vec<GameControllerInfo>, String> {
    let mut out = match list_via_gilrs() {
        Ok(list) => list,
        Err(_) => list_via_xinput(),
    };
    if out.is_empty() {
        for pad in list_via_xinput() {
            if !out.iter().any(|p| p.id == pad.id || p.name == pad.name) {
                out.push(pad);
            }
        }
    } else {
        // Mezclar XInput si gilrs no los vio.
        for pad in list_via_xinput() {
            if !out.iter().any(|p| p.id == pad.id || p.name == pad.name) {
                out.push(pad);
            }
        }
    }
    let mut out: Vec<_> = out
        .into_iter()
        .filter(|p| p.id != "none" && !p.guid.is_empty())
        .collect();
    assign_player_slots(&mut out, None);
    Ok(out)
}

/// Preferido → Player 1; resto en orden de detección → Player 2…N.
pub fn assign_player_slots(pads: &mut [GameControllerInfo], preferred: Option<&str>) {
    if let Some(want) = preferred.map(str::trim).filter(|s| !s.is_empty()) {
        if let Some(idx) = pads.iter().position(|p| {
            p.guid == want
                || p.id == want
                || p.guid.contains(want)
                || want.contains(&p.guid)
        }) {
            pads.swap(0, idx);
        }
    }
    for (i, p) in pads.iter_mut().enumerate() {
        p.player = Some((i as u32) + 1);
    }
}

fn classify_kind(name: &str) -> String {
    let n = name.to_ascii_lowercase();
    if n.contains("dualshock")
        || n.contains("dualsense")
        || n.contains("wireless controller")
        || n.contains("sony")
        || n.contains("playstation")
        || n.contains("ps4")
        || n.contains("ps5")
        || n.contains("ps3")
    {
        return "playstation".into();
    }
    if n.contains("xbox")
        || n.contains("xinput")
        || n.contains("microsoft")
        || n.contains("360 controller")
        || n.contains("one controller")
    {
        return "xbox".into();
    }
    "generic".into()
}

/// Lista mandos conectados. Vacío → un ítem informativo (no error).
/// Cada mando real trae `player` = 1, 2, 3… según orden (preferido primero si hay prefs).
#[tauri::command]
pub fn list_game_controllers(app: AppHandle) -> Result<Vec<GameControllerInfo>, String> {
    let preferred = load_preferred_guid(&app);
    let mut out = match list_via_gilrs() {
        Ok(list) => list,
        Err(e) => {
            let xinput = list_via_xinput();
            if xinput.is_empty() {
                return Ok(vec![GameControllerInfo {
                    id: "none".into(),
                    name: format!(
                        "Ningún mando detectado ({e}). Si usás PS4/PS5, cerrá Steam Input o reconectá el USB."
                    ),
                    guid: "".into(),
                    kind: "generic".into(),
                    player: None,
                }]);
            }
            xinput
        }
    };

    if out.is_empty() {
        let xinput = list_via_xinput();
        for pad in xinput {
            if !out.iter().any(|p| p.id == pad.id || p.name == pad.name) {
                out.push(pad);
            }
        }
    }

    if out.is_empty() {
        out.push(GameControllerInfo {
            id: "none".into(),
            name: "Ningún mando detectado. Conectá el USB o cerrá Steam si captura el DualShock."
                .into(),
            guid: "".into(),
            kind: "generic".into(),
            player: None,
        });
        return Ok(out);
    }

    out.retain(|p| p.id != "none" && !p.guid.is_empty());
    assign_player_slots(&mut out, preferred.as_deref());
    Ok(out)
}

fn load_preferred_guid(app: &AppHandle) -> Option<String> {
    let app_data = app_data_dir(app).ok()?;
    let path = app_data.join("blaze-controller-prefs.json");
    let raw = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("preferredDeviceGuid")
        .or_else(|| v.get("preferred_device_guid"))
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn list_via_gilrs() -> Result<Vec<GameControllerInfo>, String> {
    let mut gilrs = Gilrs::new().map_err(|e| e.to_string())?;
    // Drenar eventos para que conecte pads ya enchufados.
    while let Some(ev) = gilrs.next_event() {
        if matches!(
            ev.event,
            EventType::Connected | EventType::Disconnected
        ) {
            // seguir drenando
        }
    }

    let mut out = Vec::new();
    for (id, gamepad) in gilrs.gamepads() {
        if !gamepad.is_connected() {
            continue;
        }
        let name = gamepad.name().to_string();
        if name.trim().is_empty() {
            continue;
        }
        let guid = format!("{id:?}");
        let kind = classify_kind(&name);
        out.push(GameControllerInfo {
            id: format!("gilrs-{guid}"),
            name,
            guid,
            kind,
            player: None,
        });
    }
    Ok(out)
}

/// Aplica layout (`auto`|`playstation`|`xbox`) a configs managed PCSX2 + RetroArch.
#[tauri::command]
pub fn apply_controller_layout_prefs(
    app: AppHandle,
    layout: String,
) -> Result<(), String> {
    let layout = match layout.trim().to_ascii_lowercase().as_str() {
        "playstation" | "xbox" | "auto" => layout.trim().to_ascii_lowercase(),
        _ => "auto".into(),
    };
    let app_data = app_data_dir(&app)?;
    let pcsx2_ini = pcsx2_internal_data_root(&managed_data_root(&app_data, "pcsx2"))
        .join("inis")
        .join("PCSX2.ini");
    let ra_cfg = managed_data_root(&app_data, "retroarch").join("retroarch.cfg");
    let _ = apply_input_backend_policy("pcsx2", &pcsx2_ini, &layout);
    let _ = apply_input_backend_policy("retroarch", &ra_cfg, &layout);
    let preferred = load_preferred_guid(&app);
    for eden_ini in crate::eden_input::find_eden_qt_config_paths(&app_data) {
        let _ = crate::eden_input::apply_eden_input_backends(
            &eden_ini,
            &layout,
            preferred.as_deref(),
        );
    }
    Ok(())
}

/// Escucha input ~timeout_ms. `true` si hubo botón/eje en el GUID (o cualquier mando).
#[tauri::command]
pub fn test_game_controller(
    preferred_guid: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<bool, String> {
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(4000).clamp(500, 15_000));
    let mut gilrs = Gilrs::new().map_err(|e| e.to_string())?;
    let want = preferred_guid
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        while let Some(ev) = gilrs.next_event() {
            let guid = format!("{:?}", ev.id);
            let matches = want
                .as_ref()
                .map(|w| guid.contains(w) || w.contains(&guid) || format!("gilrs-{guid}").contains(w))
                .unwrap_or(true);
            if !matches {
                continue;
            }
            match ev.event {
                EventType::ButtonPressed(_, _)
                | EventType::ButtonReleased(_, _)
                | EventType::AxisChanged(_, _, _) => {
                    return Ok(true);
                }
                _ => {}
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(16));
    }
    Ok(false)
}

fn list_via_xinput() -> Vec<GameControllerInfo> {
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};
        for i in 0u32..4 {
            unsafe {
                let mut state: XINPUT_STATE = std::mem::zeroed();
                if XInputGetState(i, &mut state) == 0 {
                    let name = format!("Controlador Xbox / XInput {i}");
                    out.push(GameControllerInfo {
                        id: format!("xinput-{i}"),
                        name: name.clone(),
                        guid: format!("xinput-{i}"),
                        kind: "xbox".into(),
                        player: None,
                    });
                }
            }
        }
    }
    out
}
