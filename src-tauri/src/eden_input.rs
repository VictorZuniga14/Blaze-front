//! Asocia mandos detectados a Eden (qt-config.ini player_0..player_N).
//! Eden/yuzu guarda bindings como `engine:sdl,port:<i>,guid:<SDL_GUID>,…`.

use crate::controllers::{list_game_controllers_raw, GameControllerInfo};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_EDEN_PLAYERS: usize = 8;

#[derive(Debug, Clone)]
struct SdlPad {
    guid: String,
    kind: String,
    /// Índice SDL / puerto (0 = P1).
    port: u32,
}

/// Aplica Pro Controller + bindings SDL para todos los mandos conectados.
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

    let pads = resolve_sdl_pads(layout, preferred_gilrs_guid, &existing);
    let mut next = ensure_controls_section(&existing);

    for i in 0..MAX_EDEN_PLAYERS {
        if let Some(pad) = pads.get(i) {
            next = set_player_meta(&next, i, true);
            next = write_player_sdl_template(&next, i, &pad.guid, pad.port, &pad.kind);
        } else {
            next = set_player_meta(&next, i, false);
        }
    }

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

/// Ordena mandos: preferido primero, luego el resto (hasta MAX_EDEN_PLAYERS).
fn resolve_sdl_pads(
    layout: &str,
    preferred: Option<&str>,
    existing: &str,
) -> Vec<SdlPad> {
    let default_kind = resolve_pad_kind(layout, preferred);
    let mut discovered = discover_all_sdl_pads();

    // Preferido al frente si podemos mapearlo a un GUID conocido.
    if let Some(pref) = preferred.map(str::trim).filter(|s| !s.is_empty()) {
        if let Ok(gilrs_pads) = list_game_controllers_raw() {
            if let Some(p) = pick_preferred(&gilrs_pads, Some(pref)) {
                // Buscar HID del mismo tipo y ponerlo primero; si no, insertar fallback.
                if let Some(idx) = discovered.iter().position(|d| d.kind == p.kind) {
                    let pad = discovered.remove(idx);
                    discovered.insert(0, pad);
                } else if discovered.is_empty() {
                    let kind = if layout.eq_ignore_ascii_case("auto") {
                        p.kind.clone()
                    } else {
                        default_kind.clone()
                    };
                    let guid = fallback_guid_for_kind(&kind)
                        .or_else(|| extract_player0_guid(existing))
                        .unwrap_or_else(|| fallback_guid_for_kind("playstation").unwrap());
                    discovered.push(SdlPad {
                        guid,
                        kind,
                        port: 0,
                    });
                }
            }
        }
    }

    // Completar hasta la cantidad que ve gilrs/XInput (2 mandos iguales, etc.).
    if let Ok(pads) = list_game_controllers_raw() {
        while discovered.len() < pads.len().min(MAX_EDEN_PLAYERS) {
            let i = discovered.len();
            let p = &pads[i];
            let kind = if layout.eq_ignore_ascii_case("auto") {
                p.kind.clone()
            } else {
                default_kind.clone()
            };
            let guid = fallback_guid_for_kind(&kind)
                .or_else(|| extract_player0_guid(existing))
                .unwrap_or_else(|| "030000004c050000c405000000016800".into());
            discovered.push(SdlPad {
                guid,
                kind,
                port: i as u32,
            });
        }
    }

    // Reasignar ports 0..N-1 en el orden final.
    for (i, pad) in discovered.iter_mut().enumerate() {
        pad.port = i as u32;
        if !layout.eq_ignore_ascii_case("auto")
            && (layout.eq_ignore_ascii_case("playstation") || layout.eq_ignore_ascii_case("xbox"))
        {
            pad.kind = default_kind.clone();
        }
    }

    discovered.truncate(MAX_EDEN_PLAYERS);
    discovered
}

fn fallback_guid_for_kind(kind: &str) -> Option<String> {
    Some(match kind {
        "xbox" => "030000005e040000e002000000007801".into(),
        "playstation" | "generic" => "030000004c050000c405000000016800".into(),
        _ => return None,
    })
}

fn discover_all_sdl_pads() -> Vec<SdlPad> {
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        let pads = list_hid_gamepads();
        for (i, p) in pads.into_iter().enumerate() {
            let kind = if p.vendor == 0x054c {
                "playstation".into()
            } else if p.vendor == 0x045e {
                "xbox".into()
            } else if p.vendor == 0x057e {
                "generic".into() // Switch Pro-ish
            } else {
                "generic".into()
            };
            out.push(SdlPad {
                guid: sdl_guid_usb(p.vendor, p.product, p.version, b'h'),
                kind,
                port: i as u32,
            });
        }
        // XInput slots no vistos como HID (Xbox pads virtuales).
        if out.iter().all(|p| p.kind != "xbox") {
            use windows_sys::Win32::UI::Input::XboxController::XInputGetState;
            unsafe {
                for i in 0u32..4 {
                    let mut state = std::mem::zeroed();
                    if XInputGetState(i, &mut state) == 0 {
                        out.push(SdlPad {
                            guid: "030000005e040000e002000000007801".into(),
                            kind: "xbox".into(),
                            port: out.len() as u32,
                        });
                    }
                }
            }
        }
    }
    let _ = &out;
    out
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

fn set_player_meta(content: &str, player: usize, connected: bool) -> String {
    let p = format!("player_{player}");
    let pairs = vec![
        (format!("{p}_type\\default"), "false".into()),
        (format!("{p}_type"), "0".into()),
        (format!("{p}_connected\\default"), "false".into()),
        (
            format!("{p}_connected"),
            if connected { "true" } else { "false" }.into(),
        ),
        (format!("{p}_vibration_enabled\\default"), "false".into()),
        (format!("{p}_vibration_enabled"), "true".into()),
    ];
    ini_set_controls_owned(content, &pairs)
}

fn write_player_sdl_template(
    content: &str,
    player: usize,
    guid: &str,
    port: u32,
    kind: &str,
) -> String {
    let pairs = player_sdl_pairs(player, guid, port, kind);
    ini_set_controls_owned(content, &pairs)
}

fn player_sdl_pairs(player: usize, guid: &str, port: u32, kind: &str) -> Vec<(String, String)> {
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

    let q = |s: String| format!("\"{s}\"");
    let bind = |suffix: &str| {
        q(format!(
            "engine:sdl,port:{port},guid:{guid},{suffix}"
        ))
    };
    let stick = |axes: &str| {
        q(format!(
            "engine:sdl,port:{port},guid:{guid},{axes},offset_x:-0.000000,offset_y:0.000000,invert_x:+,invert_y:+,deadzone:0.150000"
        ))
    };
    let motion = || q(format!("engine:sdl,motion:0,port:{port},guid:{guid}"));
    let p = format!("player_{player}");

    let mut out: Vec<(String, String)> = Vec::new();
    let mut add = |k: &str, v: String| out.push((k.to_string(), v));
    add(&format!("{p}_button_a\\default"), "false".into());
    add(&format!("{p}_button_a"), bind(a));
    add(&format!("{p}_button_b\\default"), "false".into());
    add(&format!("{p}_button_b"), bind(b));
    add(&format!("{p}_button_x\\default"), "false".into());
    add(&format!("{p}_button_x"), bind(x));
    add(&format!("{p}_button_y\\default"), "false".into());
    add(&format!("{p}_button_y"), bind(y));
    add(&format!("{p}_button_lstick\\default"), "false".into());
    add(&format!("{p}_button_lstick"), bind(lstick));
    add(&format!("{p}_button_rstick\\default"), "false".into());
    add(&format!("{p}_button_rstick"), bind(rstick));
    add(&format!("{p}_button_l\\default"), "false".into());
    add(&format!("{p}_button_l"), bind(l));
    add(&format!("{p}_button_r\\default"), "false".into());
    add(&format!("{p}_button_r"), bind(r));
    add(&format!("{p}_button_zl\\default"), "false".into());
    add(&format!("{p}_button_zl"), bind(zl));
    add(&format!("{p}_button_zr\\default"), "false".into());
    add(&format!("{p}_button_zr"), bind(zr));
    add(&format!("{p}_button_plus\\default"), "false".into());
    add(&format!("{p}_button_plus"), bind(plus));
    add(&format!("{p}_button_minus\\default"), "false".into());
    add(&format!("{p}_button_minus"), bind(minus));
    add(&format!("{p}_button_dleft\\default"), "false".into());
    add(&format!("{p}_button_dleft"), bind(dleft));
    add(&format!("{p}_button_dup\\default"), "false".into());
    add(&format!("{p}_button_dup"), bind(dup));
    add(&format!("{p}_button_dright\\default"), "false".into());
    add(&format!("{p}_button_dright"), bind(dright));
    add(&format!("{p}_button_ddown\\default"), "false".into());
    add(&format!("{p}_button_ddown"), bind(ddown));
    add(&format!("{p}_button_home\\default"), "false".into());
    add(&format!("{p}_button_home"), bind(home));
    add(&format!("{p}_button_screenshot\\default"), "false".into());
    add(&format!("{p}_button_screenshot"), "[empty]".into());
    add(&format!("{p}_button_slleft\\default"), "false".into());
    add(&format!("{p}_button_slleft"), bind(l));
    add(&format!("{p}_button_srleft\\default"), "false".into());
    add(&format!("{p}_button_srleft"), bind(r));
    add(&format!("{p}_button_slright\\default"), "false".into());
    add(&format!("{p}_button_slright"), bind(l));
    add(&format!("{p}_button_srright\\default"), "false".into());
    add(&format!("{p}_button_srright"), bind(r));
    add(&format!("{p}_lstick\\default"), "false".into());
    add(&format!("{p}_lstick"), stick("axis_x:0,axis_y:1"));
    add(&format!("{p}_rstick\\default"), "false".into());
    add(&format!("{p}_rstick"), stick("axis_x:2,axis_y:3"));
    add(&format!("{p}_motionleft\\default"), "false".into());
    add(&format!("{p}_motionleft"), motion());
    add(&format!("{p}_motionright\\default"), "false".into());
    add(&format!("{p}_motionright"), motion());
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
