//! Idioma OSD de la BIOS PS2 vía archivos `.nvm` (PCSX2).
//! Los juegos PAL sin menú propio (ej. God of War 1) leen este valor.

use std::fs;
use std::path::Path;

/// Códigos OSD PS2 (PCSX2 `configParams1.language`).
pub const LANG_JAPANESE: u8 = 0;
pub const LANG_ENGLISH: u8 = 1;
pub const LANG_FRENCH: u8 = 2;
pub const LANG_SPANISH: u8 = 3;
pub const LANG_GERMAN: u8 = 4;
pub const LANG_ITALIAN: u8 = 5;
pub const LANG_DUTCH: u8 = 6;
pub const LANG_PORTUGUESE: u8 = 7;

/// Layout NVM estándar PCSX2 (`config1 = 0x300`).
/// Idioma en `config1 + 0xF + 2` = `0x311` (nibble bajo de params[2]).
const NVM_SIZE: usize = 1024;
const CONFIG1: usize = 0x300;
const LANG_BYTE_OFF: usize = CONFIG1 + 0x11; // params[2]

/// Mapea código Blaze (`es`, `en`, …) → id OSD PS2.
pub fn ps2_lang_from_code(code: &str) -> u8 {
    match code.trim().to_ascii_lowercase().as_str() {
        "ja" | "jp" | "japanese" => LANG_JAPANESE,
        "en" | "english" => LANG_ENGLISH,
        "fr" | "french" => LANG_FRENCH,
        "es" | "es-es" | "es-419" | "spanish" | "español" => LANG_SPANISH,
        "de" | "german" => LANG_GERMAN,
        "it" | "italian" => LANG_ITALIAN,
        "nl" | "dutch" => LANG_DUTCH,
        "pt" | "pt-br" | "portuguese" => LANG_PORTUGUESE,
        _ => LANG_SPANISH, // Blaze: español por defecto
    }
}

fn is_spanish_code(code: &str) -> bool {
    let c = code.trim().to_ascii_lowercase();
    c == "es" || c.starts_with("es-") || c == "spanish" || c == "español"
}

/// Idioma a aplicar: español si el juego lo soporta o no declara idiomas.
pub fn resolve_force_lang_code(
    preferred: Option<&str>,
    available: &[String],
) -> String {
    if let Some(p) = preferred.map(str::trim).filter(|s| !s.is_empty()) {
        if is_spanish_code(p) {
            return "es".into();
        }
        // Preferido explícito no-ES: solo forzar ES si la lista incluye español.
        if available.iter().any(|c| is_spanish_code(c)) {
            return "es".into();
        }
        return p.to_ascii_lowercase();
    }
    if available.is_empty() {
        return "es".into();
    }
    if available.iter().any(|c| is_spanish_code(c)) {
        return "es".into();
    }
    available[0].trim().to_ascii_lowercase()
}

/// Asegura español (u otro idioma) en todos los `.nvm` junto a las BIOS.
/// Crea `.nvm` vacío+idioma si solo existe el `.bin`.
pub fn ensure_pcsx2_bios_language(bios_dir: &Path, lang_code: &str) -> Result<u32, String> {
    if !bios_dir.is_dir() {
        return Ok(0);
    }
    let lang = ps2_lang_from_code(lang_code);
    let mut patched = 0u32;

    let entries = fs::read_dir(bios_dir).map_err(|e| e.to_string())?;
    for ent in entries.flatten() {
        let path = ent.path();
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        if name.ends_with(".nvm") {
            if patch_nvm_file(&path, lang)? {
                patched += 1;
            }
            continue;
        }

        // Pareja .bin → .nvm
        if name.ends_with(".bin") {
            let nvm = path.with_extension("nvm");
            if !nvm.is_file() {
                let mut buf = vec![0u8; NVM_SIZE];
                set_language_byte(&mut buf, lang);
                // Bloque mínimo en config1+0x10 para que PCSX2 no regenere defaults EN.
                seed_lang_block(&mut buf, lang);
                fs::write(&nvm, &buf).map_err(|e| e.to_string())?;
                patched += 1;
            } else if patch_nvm_file(&nvm, lang)? {
                patched += 1;
            }
        }
    }
    Ok(patched)
}

fn patch_nvm_file(path: &Path, lang: u8) -> Result<bool, String> {
    let mut buf = fs::read(path).map_err(|e| e.to_string())?;
    if buf.len() < NVM_SIZE {
        buf.resize(NVM_SIZE, 0);
    }
    let changed = set_language_byte(&mut buf, lang);
    // Si el bloque de idioma estaba vacío, sembrar para no perder el patch.
    let block_start = CONFIG1 + 0x10;
    let empty = buf[block_start..block_start + 16].iter().all(|&b| b == 0);
    if empty {
        seed_lang_block(&mut buf, lang);
        fs::write(path, &buf).map_err(|e| e.to_string())?;
        return Ok(true);
    }
    if changed {
        fs::write(path, &buf).map_err(|e| e.to_string())?;
    }
    Ok(changed)
}

fn set_language_byte(buf: &mut [u8], lang: u8) -> bool {
    if buf.len() <= LANG_BYTE_OFF {
        return false;
    }
    let lang = lang & 0x1F;
    let old = buf[LANG_BYTE_OFF];
    let new = (old & 0xE0) | lang;
    if old == new && (old & 0x1F) == lang {
        return false;
    }
    buf[LANG_BYTE_OFF] = new;
    true
}

/// Escribe un bloque config1+0x10 razonable (Europa) con el idioma pedido.
fn seed_lang_block(buf: &mut [u8], lang: u8) {
    let start = CONFIG1 + 0x10;
    if buf.len() < start + 16 {
        return;
    }
    // Basado en NVM Europa real del usuario; byte[1] = version<<5 | language.
    let lang_byte = 0x20 | (lang & 0x1F); // version 1 + lang
    let block: [u8; 16] = [
        0x00,
        lang_byte,
        0x80,
        0x00,
        0x00,
        0x14, // timezone-ish
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
    ];
    buf[start..start + 16].copy_from_slice(&block);
    // params[2] vive en 0x311 (= start+1) → ya es lang_byte.
}
