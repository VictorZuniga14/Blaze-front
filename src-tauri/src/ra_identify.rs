//! Identificación de contenido vía rhash (rcheevos oficial).
//! Read-only: no modifica archivos ni configs de emulador.
//! La consola la decide Blaze (Game.platform / runtime), no la extensión sola.

use serde::Serialize;
use std::ffi::CString;
use std::os::raw::c_char;
use std::path::{Path, PathBuf};
use std::sync::Once;

static INIT_RHASH: Once = Once::new();

extern "C" {
    /// Obligatorio para consolas CD/DVD (PS1/PS2/etc.).
    fn rc_hash_init_default_cdreader();

    fn rc_hash_generate_from_file(
        hash: *mut c_char,
        console_id: u32,
        path: *const c_char,
    ) -> i32;
}

fn ensure_rhash_ready() {
    INIT_RHASH.call_once(|| unsafe {
        rc_hash_init_default_cdreader();
    });
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaContentIdentification {
    pub emulator: String,
    pub platform: String,
    pub console_id: u32,
    pub hash: String,
    pub content_path: String,
}

#[derive(Debug)]
struct ConsoleSpec {
    key: &'static str,
    id: u32,
    extensions: &'static [&'static str],
}

/// IDs alineados con front/back raConsoles + rc_consoles.h
fn console_spec(key: &str) -> Option<&'static ConsoleSpec> {
    match key {
        "nes" => Some(&ConsoleSpec {
            key: "nes",
            id: 7,
            extensions: &["nes", "unf", "fds", "nez"],
        }),
        "snes" => Some(&ConsoleSpec {
            key: "snes",
            id: 3,
            extensions: &["smc", "sfc", "fig", "swc"],
        }),
        "gameboy" => Some(&ConsoleSpec {
            key: "gameboy",
            id: 4,
            extensions: &["gb"],
        }),
        "gbc" => Some(&ConsoleSpec {
            key: "gbc",
            id: 6,
            extensions: &["gbc", "gb"],
        }),
        "gba" => Some(&ConsoleSpec {
            key: "gba",
            id: 5,
            extensions: &["gba", "agb", "mb"],
        }),
        "genesis" => Some(&ConsoleSpec {
            key: "genesis",
            id: 1,
            extensions: &["md", "gen", "smd", "bin"],
        }),
        "ps1" => Some(&ConsoleSpec {
            key: "ps1",
            id: 12,
            extensions: &["cue", "bin", "iso", "img", "mdf", "pbp"],
        }),
        "n64" => Some(&ConsoleSpec {
            key: "n64",
            id: 2,
            extensions: &["n64", "z64", "v64"],
        }),
        "psp" => Some(&ConsoleSpec {
            key: "psp",
            id: 41,
            extensions: &["iso", "cso", "pbp"],
        }),
        "ps2" => Some(&ConsoleSpec {
            key: "ps2",
            id: 21,
            extensions: &["iso", "bin", "cue", "img", "mdf", "nrg"],
        }),
        _ => None,
    }
}

fn file_ext(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

fn is_blocked_script(path: &Path) -> bool {
    matches!(
        file_ext(path).as_deref(),
        Some("bat" | "cmd" | "ps1" | "vbs")
    )
}

fn resolve_console(
    emulator: &str,
    console_key: Option<&str>,
    console_id: Option<u32>,
) -> Result<&'static ConsoleSpec, String> {
    let emu = emulator.trim().to_ascii_lowercase();
    match emu.as_str() {
        "pcsx2" => Ok(console_spec("ps2").unwrap()),
        "retroarch" => {
            let key = console_key
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_ascii_lowercase());
            let key = key.ok_or_else(|| {
                "RetroArch requiere consola (Game.platform). No se deduce solo por la extensión."
                    .to_string()
            })?;
            let spec = console_spec(&key).ok_or_else(|| {
                format!(
                    "Consola '{key}' no soportada para identificación automática."
                )
            })?;
            if let Some(id) = console_id {
                if id != spec.id {
                    return Err(format!(
                        "consoleId {id} no coincide con la consola '{key}' (esperado {}).",
                        spec.id
                    ));
                }
            }
            Ok(spec)
        }
        _ => Err(format!(
            "Identificación automática no disponible para emulador '{emulator}'. Usá PCSX2 o RetroArch."
        )),
    }
}

fn validate_content_path(path: &str, spec: &ConsoleSpec) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if path.trim().is_empty() {
        return Err("Ruta de contenido vacía.".to_string());
    }
    if !p.exists() {
        return Err("El archivo de contenido no existe.".to_string());
    }
    if !p.is_file() {
        return Err("La ruta de contenido debe ser un archivo.".to_string());
    }
    if is_blocked_script(&p) {
        return Err("No se permiten scripts como contenido.".to_string());
    }

    let ext = file_ext(&p);
    if ext.as_deref() == Some("chd") {
        return Err(
            "CHD aún no está soportado para identificación automática. Usá ISO/BIN/CUE/ROM o mapping manual."
                .to_string(),
        );
    }
    if ext.as_deref() == Some("zip") || ext.as_deref() == Some("7z") || ext.as_deref() == Some("rar")
    {
        return Err(
            "Archivos comprimidos aún no estánortados para hash RA. Extraé la ROM/ISO o usá mapping manual."
                .to_string(),
        );
    }

    let Some(ext) = ext else {
        return Err(format!(
            "El contenido no tiene extensión reconocida para {}.",
            spec.key
        ));
    };
    if !spec.extensions.iter().any(|e| *e == ext) {
        return Err(format!(
            "Extensión .{ext} no compatible con {} (esperadas: {}).",
            spec.key,
            spec.extensions.join(", ")
        ));
    }

    std::fs::File::open(&p).map_err(|_| "No se pudo leer el archivo de contenido.".to_string())?;
    Ok(p)
}

fn hash_file(path: &Path, console_id: u32) -> Result<String, String> {
    ensure_rhash_ready();

    let path_str = path
        .to_str()
        .ok_or_else(|| "La ruta del contenido no es UTF-8 válida.".to_string())?;
    let c_path =
        CString::new(path_str).map_err(|_| "La ruta del contenido contiene bytes nulos.".to_string())?;

    let mut hash_buf = [0u8; 33];
    let ok = unsafe {
        rc_hash_generate_from_file(
            hash_buf.as_mut_ptr() as *mut c_char,
            console_id,
            c_path.as_ptr(),
        )
    };
    if ok == 0 {
        return Err(
            "No se pudo calcular el hash oficial RA (contenido inválido para esta consola o dump no legible)."
                .to_string(),
        );
    }

    let end = hash_buf.iter().position(|&b| b == 0).unwrap_or(hash_buf.len());
    let hash = String::from_utf8_lossy(&hash_buf[..end]).to_ascii_lowercase();
    if hash.len() != 32 {
        return Err("Hash RA con longitud inesperada.".to_string());
    }
    Ok(hash)
}

/// PCSX2 → PS2. RetroArch → consoleKey/consoleId desde Game.platform (Blaze).
#[tauri::command]
pub fn identify_ra_content(
    path: String,
    emulator: String,
    console_key: Option<String>,
    console_id: Option<u32>,
) -> Result<RaContentIdentification, String> {
    let spec = resolve_console(
        &emulator,
        console_key.as_deref(),
        console_id,
    )?;
    let content = validate_content_path(&path, spec)?;
    let hash = hash_file(&content, spec.id)?;
    let emu = emulator.trim().to_ascii_lowercase();

    Ok(RaContentIdentification {
        emulator: emu,
        platform: spec.key.to_string(),
        console_id: spec.id,
        hash,
        content_path: content.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcsx2_forces_ps2() {
        let spec = resolve_console("pcsx2", None, None).unwrap();
        assert_eq!(spec.key, "ps2");
        assert_eq!(spec.id, 21);
    }

    #[test]
    fn retroarch_requires_console_key() {
        let err = resolve_console("retroarch", None, None).unwrap_err();
        assert!(err.contains("platform") || err.contains("consola"));
    }

    #[test]
    fn retroarch_snes() {
        let spec = resolve_console("retroarch", Some("snes"), Some(3)).unwrap();
        assert_eq!(spec.id, 3);
    }

    #[test]
    fn psp_id_is_41() {
        let spec = resolve_console("retroarch", Some("psp"), None).unwrap();
        assert_eq!(spec.id, 41);
    }

    #[test]
    fn rejects_unknown_emulator() {
        let err = resolve_console("dolphin", Some("gamecube"), None).unwrap_err();
        assert!(err.contains("no disponible"));
    }
}
