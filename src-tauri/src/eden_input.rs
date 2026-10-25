//! Asocia el mando preferido de Blaze a Eden (qt-config.ini player_0).
//! Eden/yuzu guarda bindings como `engine:sdl,port:0,guid:<SDL_GUID>,…`.

use crate::controllers::{list_game_controllers_raw, GameControllerInfo};
use std::fs;
use std::path::{Path, PathBuf};

/// Aplica Pro Controller + bindings SDL de player_0 según layout / mando preferido.
pub fn apply_eden_input_backends(
    config_path: &Path,
    layout: &str,
    preferred_gilrs_guid: Option<&str>,
) -> Result<(), String> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let existing = if config_path.is_file() {
        fs::read_to_string(config_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };

    let kind = resolve_pad_kind(layout, preferred_gilrs_guid);
    let Some(sdl_guid) = resolve_sdl_guid(&kind, &existing) else {
        return Ok(());
    };

    let mut next = existing.clone();
    next = ensure_controls_section(&next);
    next = set_player0_meta(&next);
    next = if player0_uses_sdl(&next) {
        replace_player0_guid(&next, &sdl_guid)
    } else {
        write_player0_sdl_template(&next, &sdl_guid, &kind)
    };

    if next != existing {
        fs::write(config_path, next).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Busca qt-config.ini de Eden (runtimes + emulator-data).
pub fn find_eden_qt_config_paths(app_data: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let runtimes = app_data.join("runtimes").join("eden");
    if let Ok(entries) = fs::read_dir(&runtimes) {
        for e in entries.flatten() {
            let p = e
                .path()
                .join("user")
                .join("config")
                .join("qt-config.ini");
            if p.is_file() {
                out.push(p);
            }
        }
    }
    let managed = app_data
        .join("emulator-data")
        .join("eden")
        .join("config")
        .join("qt-config.ini");
    if managed.is_file() {
        out.push(managed);
    }
    out
}

fn resolve_pad_kind(layout: &str, preferred: Option<&str>) -> String {
    match layout.trim().to_ascii_lowercase().as_str() {
        "playstation" => return "playstation".into(),
        "xbox" => return "xbox".into(),
        _ => {}
    }
    if let Ok(pads) = list_game_controllers_raw() {
        if let Some(p) = pick_preferred(&pads, preferred) {
            return p.kind.clone();
        }
        if let Some(p) = pads.iter().find(|p| !p.guid.is_empty() && p.id != "none") {
            return p.kind.clone();
        }
    }
    "playstation".into()
}

fn pick_preferred<'a>(
    pads: &'a [GameControllerInfo],
    preferred: Option<&str>,
) -> Option<&'a GameControllerInfo> {
    let want = preferred.map(str::trim).filter(|s| !s.is_empty())?;
    pads.iter().find(|p| {
        !p.guid.is_empty()
            && (p.guid == want
                || p.id == want
                || p.guid.contains(want)
                || want.contains(&p.guid))
    })
}

fn resolve_sdl_guid(kind: &str, existing: &str) -> Option<String> {
    if let Some(g) = discover_sdl_guid(kind) {
        return Some(g);
    }
    if let Some(g) = extract_player0_guid(existing) {
        return Some(g);
    }
    // Solo fallback fijo si gilrs/XInput ve un mando de ese tipo (GUID típico DS4/Xbox).
    let has_pad = list_game_controllers_raw()
        .ok()
        .map(|pads| {
            pads.iter().any(|p| {
                p.id != "none"
                    && (kind == "generic"
                        || p.kind == kind
                        || (kind == "playstation" && p.kind == "playstation")
                        || (kind == "xbox" && p.kind == "xbox"))
            })
        })
        .unwrap_or(false);
    if !has_pad {
        return None;
    }
    Some(match kind {
        "xbox" => "030000005e040000e002000000007801".into(),
        _ => "030000004c050000c405000000016800".into(),
    })
}

fn discover_sdl_guid(kind: &str) -> Option<String> {
    #[cfg(windows)]
    {
        let pads = list_hid_gamepads();
        let filtered: Vec<_> = pads
            .into_iter()
            .filter(|p| match kind {
                "playstation" => p.vendor == 0x054c,
                "xbox" => p.vendor == 0x045e,
                _ => true,
            })
            .collect();
        if let Some(p) = filtered.first() {
            return Some(sdl_guid_usb(p.vendor, p.product, p.version, b'h'));
        }
        if kind == "xbox" || kind == "generic" {
            use windows_sys::Win32::UI::Input::XboxController::XInputGetState;
            unsafe {
                let mut state = std::mem::zeroed();
                if XInputGetState(0, &mut state) == 0 {
                    return Some("030000005e040000e002000000007801".into());
                }
            }
        }
    }
    let _ = kind;
    None
}

#[cfg(windows)]
#[derive(Debug, Clone)]
struct HidPad {
    vendor: u16,
    product: u16,
    version: u16,
}

#[cfg(windows)]
fn list_hid_gamepads() -> Vec<HidPad> {
    use windows_sys::Win32::UI::Input::{
        GetRawInputDeviceInfoW, GetRawInputDeviceList, RIDI_DEVICEINFO, RIDI_DEVICENAME,
        RAWINPUTDEVICELIST, RID_DEVICE_INFO, RIM_TYPEHID,
    };

    unsafe {
        let mut count: u32 = 0;
        let size = std::mem::size_of::<RAWINPUTDEVICELIST>() as u32;
        if GetRawInputDeviceList(std::ptr::null_mut(), &mut count, size) == u32::MAX || count == 0
        {
            return Vec::new();
        }
        let mut list = vec![std::mem::zeroed::<RAWINPUTDEVICELIST>(); count as usize];
        if GetRawInputDeviceList(list.as_mut_ptr(), &mut count, size) == u32::MAX {
            return Vec::new();
        }

        let mut out = Vec::new();
        for dev in list.iter().take(count as usize) {
            if dev.dwType != RIM_TYPEHID {
                continue;
            }

            let mut name_len: u32 = 0;
            GetRawInputDeviceInfoW(dev.hDevice, RIDI_DEVICENAME, std::ptr::null_mut(), &mut name_len);
            if name_len == 0 {
                continue;
            }
            let mut name_buf = vec![0u16; name_len as usize];
            if GetRawInputDeviceInfoW(
                dev.hDevice,
                RIDI_DEVICENAME,
                name_buf.as_mut_ptr() as *mut _,
                &mut name_len,
            ) == u32::MAX
            {
                continue;
            }
            let name = String::from_utf16_lossy(&name_buf)
                .trim_end_matches('\0')
                .to_ascii_uppercase();
            if !name.contains("VID_") {
                continue;
            }

            let mut info_size: u32 = std::mem::size_of::<RID_DEVICE_INFO>() as u32;
            let mut info: RID_DEVICE_INFO = std::mem::zeroed();
            info.cbSize = info_size;
            if GetRawInputDeviceInfoW(
                dev.hDevice,
                RIDI_DEVICEINFO,
                &mut info as *mut _ as *mut _,
                &mut info_size,
            ) == u32::MAX
            {
                continue;
            }
            if info.dwType != RIM_TYPEHID {
                continue;
            }
            let hid = info.Anonymous.hid;
            let page = hid.usUsagePage;
            let usage = hid.usUsage;
            // Generic Desktop: Joystick (4) / Game Pad (5)
            if page != 0x01 || (usage != 0x04 && usage != 0x05) {
                continue;
            }
            let vendor = hid.dwVendorId as u16;
            let product = hid.dwProductId as u16;
            let version = if hid.dwVersionNumber == 0 {
                0x0100
            } else {
                hid.dwVersionNumber as u16
            };
            let interesting = vendor == 0x054c
                || vendor == 0x045e
                || vendor == 0x057e
                || usage == 0x05;
            if !interesting {
                continue;
            }
            out.push(HidPad {
                vendor,
                product,
                version,
            });
        }
        out
    }
}

fn sdl_guid_usb(vendor: u16, product: u16, version: u16, driver: u8) -> String {
    let mut g = [0u8; 16];
    g[0] = 0x03;
    g[4] = (vendor & 0xff) as u8;
    g[5] = (vendor >> 8) as u8;
    g[8] = (product & 0xff) as u8;
    g[9] = (product >> 8) as u8;
    g[12] = (version & 0xff) as u8;
    g[13] = (version >> 8) as u8;
    g[14] = driver;
    hex::encode(g)
}

fn extract_player0_guid(content: &str) -> Option<String> {
    for line in content.lines() {
        let t = line.trim();
        if !t.starts_with("player_0_") || !t.contains("engine:sdl") {
            continue;
        }
        if let Some(idx) = t.find("guid:") {
            let rest = &t[idx + 5..];
            let end = rest
                .find(|c: char| !c.is_ascii_hexdigit())
                .unwrap_or(rest.len());
            let g = &rest[..end];
            if g.len() >= 32 {
                return Some(g.to_ascii_lowercase());
            }
        }
    }
    None
}

fn player0_uses_sdl(content: &str) -> bool {
    content.lines().any(|l| {
        let t = l.trim();
        t.starts_with("player_0_button_a=") && t.contains("engine:sdl")
    })
}

fn ensure_controls_section(content: &str) -> String {
    if content
        .lines()
        .any(|l| l.trim().eq_ignore_ascii_case("[Controls]"))
    {
        content.to_string()
    } else if content.is_empty() {
        "[Controls]\n".into()
    } else {
        format!("{}\n[Controls]\n", content.trim_end())
    }
}

fn set_player0_meta(content: &str) -> String {
    let pairs = vec![
        ("player_0_type\\default".into(), "false".into()),
        ("player_0_type".into(), "0".into()),
        ("player_0_connected\\default".into(), "false".into()),
        ("player_0_connected".into(), "true".into()),
        ("player_0_vibration_enabled\\default".into(), "false".into()),
        ("player_0_vibration_enabled".into(), "true".into()),
    ];
    ini_set_controls_owned(content, &pairs)
}

fn replace_player0_guid(content: &str, new_guid: &str) -> String {
    let mut out = String::with_capacity(content.len());
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("player_0_") && trimmed.contains("guid:") {
            if let Some(idx) = trimmed.find("guid:") {
                let start = idx + 5;
                let rest = &trimmed[start..];
                let end = rest
                    .find(|c: char| !c.is_ascii_hexdigit())
                    .unwrap_or(rest.len());
                out.push_str(&trimmed[..start]);
                out.push_str(new_guid);
                out.push_str(&rest[end..]);
                out.push('\n');
                continue;
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn write_player0_sdl_template(content: &str, guid: &str, kind: &str) -> String {
    let pairs = player0_sdl_pairs(guid, kind);
    ini_set_controls_owned(content, &pairs)
}

fn player0_sdl_pairs(guid: &str, kind: &str) -> Vec<(String, String)> {
    let (a, b, x, y, lstick, rstick, l, r, zl, zr, plus, minus, dleft, dup, dright, ddown, home) =
        if kind == "xbox" {
            (
                "button:1",
                "button:0",
                "button:3",
                "button:2",
                "button:8",
                "button:9",
                "button:4",
                "button:5",
                "axis:4,threshold:0.500000,invert:+",
                "axis:5,threshold:0.500000,invert:+",
                "button:7",
                "button:6",
                "hat:0,direction:left",
                "hat:0,direction:up",
                "hat:0,direction:right",
                "hat:0,direction:down",
                "button:10",
            )
        } else {
            (
                "button:1",
                "button:0",
                "button:3",
                "button:2",
                "button:7",
                "button:8",
                "button:9",
                "button:10",
                "axis:4,threshold:0.500000,invert:+",
                "axis:5,threshold:0.500000,invert:+",
                "button:6",
                "button:4",
                "button:13",
                "button:11",
                "button:14",
                "button:12",
                "button:5",
            )
        };

    // Qt INI: valores con comas van entre comillas (como escribe Eden).
    let q = |s: String| format!("\"{s}\"");
    let bind = |suffix: &str| q(format!("engine:sdl,port:0,guid:{guid},{suffix}"));
    let stick = |axes: &str| {
        q(format!(
            "engine:sdl,port:0,guid:{guid},{axes},offset_x:-0.000000,offset_y:0.000000,invert_x:+,invert_y:+,deadzone:0.150000"
        ))
    };
    let motion = || q(format!("engine:sdl,motion:0,port:0,guid:{guid}"));

    let mut out: Vec<(String, String)> = Vec::new();
    let mut add = |k: &str, v: String| out.push((k.to_string(), v));
    add("player_0_button_a\\default", "false".into());
    add("player_0_button_a", bind(a));
    add("player_0_button_b\\default", "false".into());
    add("player_0_button_b", bind(b));
    add("player_0_button_x\\default", "false".into());
    add("player_0_button_x", bind(x));
    add("player_0_button_y\\default", "false".into());
    add("player_0_button_y", bind(y));
    add("player_0_button_lstick\\default", "false".into());
    add("player_0_button_lstick", bind(lstick));
    add("player_0_button_rstick\\default", "false".into());
    add("player_0_button_rstick", bind(rstick));
    add("player_0_button_l\\default", "false".into());
    add("player_0_button_l", bind(l));
    add("player_0_button_r\\default", "false".into());
    add("player_0_button_r", bind(r));
    add("player_0_button_zl\\default", "false".into());
    add("player_0_button_zl", bind(zl));
    add("player_0_button_zr\\default", "false".into());
    add("player_0_button_zr", bind(zr));
    add("player_0_button_plus\\default", "false".into());
    add("player_0_button_plus", bind(plus));
    add("player_0_button_minus\\default", "false".into());
    add("player_0_button_minus", bind(minus));
    add("player_0_button_dleft\\default", "false".into());
    add("player_0_button_dleft", bind(dleft));
    add("player_0_button_dup\\default", "false".into());
    add("player_0_button_dup", bind(dup));
    add("player_0_button_dright\\default", "false".into());
    add("player_0_button_dright", bind(dright));
    add("player_0_button_ddown\\default", "false".into());
    add("player_0_button_ddown", bind(ddown));
    add("player_0_button_home\\default", "false".into());
    add("player_0_button_home", bind(home));
    add("player_0_button_screenshot\\default", "false".into());
    add("player_0_button_screenshot", "[empty]".into());
    add("player_0_button_slleft\\default", "false".into());
    add("player_0_button_slleft", bind(l));
    add("player_0_button_srleft\\default", "false".into());
    add("player_0_button_srleft", bind(r));
    add("player_0_button_slright\\default", "false".into());
    add("player_0_button_slright", bind(l));
    add("player_0_button_srright\\default", "false".into());
    add("player_0_button_srright", bind(r));
    add("player_0_lstick\\default", "false".into());
    add("player_0_lstick", stick("axis_x:0,axis_y:1"));
    add("player_0_rstick\\default", "false".into());
    add("player_0_rstick", stick("axis_x:2,axis_y:3"));
    add("player_0_motionleft\\default", "false".into());
    add("player_0_motionleft", motion());
    add("player_0_motionright\\default", "false".into());
    add("player_0_motionright", motion());
    out
}

fn ini_set_controls_owned(content: &str, pairs: &[(String, String)]) -> String {
    let mut result = String::new();
    let mut in_target = false;
    let mut section_found = false;
    let section_header = "[Controls]";
    let mut keys_to_set: std::collections::HashMap<String, String> = pairs
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if in_target && !keys_to_set.is_empty() {
                for (key, value) in keys_to_set.iter() {
                    result.push_str(&format!("{key}={value}\n"));
                }
                keys_to_set.clear();
            }
            in_target = trimmed.eq_ignore_ascii_case(section_header);
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
                    result.push_str(&format!("{key_trimmed}={new_value}\n"));
                    continue;
                }
            }
        }
        result.push_str(line);
        result.push('\n');
    }

    if !section_found {
        result.push_str(&format!("\n{section_header}\n"));
        for (key, value) in pairs {
            result.push_str(&format!("{key}={value}\n"));
        }
    } else if !keys_to_set.is_empty() {
        for (key, value) in keys_to_set {
            result.push_str(&format!("{key}={value}\n"));
        }
    }
    result
}
