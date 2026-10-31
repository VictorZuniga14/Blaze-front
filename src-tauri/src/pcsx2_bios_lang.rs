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

/// PCSX2 usa dos layouts de NVM según la versión de la BIOS (`CDVD.cpp`, `nvmlayouts`):
/// - BIOS < v1.70 → `config1 = 0x300`
/// - BIOS >= v1.70 (SCPH-5000x, 70004, 77004, 90004…) → `config1 = 0x2B0`
/// Idioma en `config1 + 0x11` (bits 0-4; bits 5-7 = versión del bloque).
const NVM_SIZE: usize = 1024;
const CONFIG1_LEGACY: usize = 0x300;
const CONFIG1_V170: usize = 0x2B0;
/// Versión PCSX2 `(major << 8) | minor` a partir de la cual cambia el layout (v1.70).
const BIOS_VER_V170: u32 = (1 << 8) | 70;

fn lang_byte_off(config1: usize) -> usize {
    config1 + 0x11
}

/// Lee ROMVER (`MMmmRRYYYYMMDD`, ej. `0200EC20040614`) y devuelve `(major << 8) | minor`.
/// `None` si el archivo no es una BIOS PS2 (ej. `rom1.bin`).
fn bios_version(bin: &[u8]) -> Option<u32> {
    bin.windows(14).find_map(|w| {
        let ok = w[..4].iter().all(u8::is_ascii_digit)
            && w[4..6].iter().all(u8::is_ascii_uppercase)
            && w[6..].iter().all(u8::is_ascii_digit);
        if !ok {
            return None;
        }
        let major = u32::from(w[0] - b'0') * 10 + u32::from(w[1] - b'0');
        let minor = u32::from(w[2] - b'0') * 10 + u32::from(w[3] - b'0');
        Some((major << 8) | minor)
    })
}

fn config1_for_version(version: u32) -> usize {
    if version >= BIOS_VER_V170 {
        CONFIG1_V170
    } else {
        CONFIG1_LEGACY
    }
}

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

/// Nombre en español de un id OSD PS2.
pub fn lang_label(lang: u8) -> &'static str {
    match lang {
        LANG_JAPANESE => "Japonés",
        LANG_ENGLISH => "Inglés",
        LANG_FRENCH => "Francés",
        LANG_SPANISH => "Español",
        LANG_GERMAN => "Alemán",
        LANG_ITALIAN => "Italiano",
        LANG_DUTCH => "Neerlandés",
        LANG_PORTUGUESE => "Portugués",
        _ => "Desconocido",
    }
}

/// Idioma OSD que leerá el juego con esta BIOS (desde su `.nvm`).
/// `None` si no es BIOS PS2 o todavía no tiene `.nvm`.
pub fn read_bios_language(bios_bin: &Path) -> Option<u8> {
    let version = bios_version(&fs::read(bios_bin).ok()?)?;
    let nvm = fs::read(bios_bin.with_extension("nvm")).ok()?;
    nvm.get(lang_byte_off(config1_for_version(version)))
        .map(|byte| byte & 0x1F)
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

/// Asegura español (u otro idioma) en el `.nvm` de cada BIOS del directorio.
/// El offset depende de la versión de la BIOS, así que se recorren los `.bin`
/// (PCSX2 usa `<bios>.nvm`). Crea `.nvm` vacío+idioma si solo existe el `.bin`.
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
        if !name.ends_with(".bin") {
            continue;
        }

        let Ok(bin) = fs::read(&path) else { continue };
        // rom1.bin / rom2.bin / erom.bin no son BIOS: no tocar.
        let Some(version) = bios_version(&bin) else { continue };
        let config1 = config1_for_version(version);

        let nvm = path.with_extension("nvm");
        if !nvm.is_file() {
            let mut buf = vec![0u8; NVM_SIZE];
            // Bloque mínimo en config1+0x10 para que PCSX2 no regenere defaults EN.
            seed_lang_block(&mut buf, config1, lang);
            fs::write(&nvm, &buf).map_err(|e| e.to_string())?;
            patched += 1;
        } else if patch_nvm_file(&nvm, config1, lang)? {
            patched += 1;
        }
    }
    Ok(patched)
}

fn patch_nvm_file(path: &Path, config1: usize, lang: u8) -> Result<bool, String> {
    let mut buf = fs::read(path).map_err(|e| e.to_string())?;
    if buf.len() < NVM_SIZE {
        buf.resize(NVM_SIZE, 0);
    }
    // Si el bloque de idioma estaba vacío, sembrar para no perder el patch.
    let block_start = config1 + 0x10;
    let empty = buf[block_start..block_start + 16].iter().all(|&b| b == 0);
    if empty {
        seed_lang_block(&mut buf, config1, lang);
        fs::write(path, &buf).map_err(|e| e.to_string())?;
        return Ok(true);
    }
    let changed = set_language_byte(&mut buf, config1, lang);
    if changed {
        fs::write(path, &buf).map_err(|e| e.to_string())?;
    }
    Ok(changed)
}

fn set_language_byte(buf: &mut [u8], config1: usize, lang: u8) -> bool {
    let off = lang_byte_off(config1);
    if buf.len() <= off {
        return false;
    }
    let old = buf[off];
    let new = (old & 0xE0) | (lang & 0x1F);
    if old == new {
        return false;
    }
    buf[off] = new;
    true
}

/// Escribe un bloque config1+0x10 razonable (Europa) con el idioma pedido.
fn seed_lang_block(buf: &mut [u8], config1: usize, lang: u8) {
    let start = config1 + 0x10;
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
    // El byte de idioma vive en config1+0x11 (= start+1) → ya es lang_byte.
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_bios(romver: &[u8]) -> Vec<u8> {
        let mut bin = vec![0u8; 4096];
        bin[1000..1000 + romver.len()].copy_from_slice(romver);
        bin
    }

    #[test]
    fn detects_bios_version_and_layout() {
        let v160 = bios_version(&fake_bios(b"0160EC20011004")).unwrap();
        let v200 = bios_version(&fake_bios(b"0200EC20040614")).unwrap();
        assert_eq!(config1_for_version(v160), CONFIG1_LEGACY);
        assert_eq!(config1_for_version(v200), CONFIG1_V170);
        assert_eq!(config1_for_version(BIOS_VER_V170), CONFIG1_V170);
        assert!(bios_version(&[0u8; 4096]).is_none());
    }

    #[test]
    fn patches_language_keeping_block_version_bits() {
        // NVM real SCPH-70004 v2.00: 0x2C0 = 31 23 … (versión 1, idioma 3).
        let mut buf = vec![0u8; NVM_SIZE];
        buf[0x2C0] = 0x31;
        buf[0x2C1] = 0x21; // inglés
        assert!(set_language_byte(&mut buf, CONFIG1_V170, LANG_SPANISH));
        assert_eq!(buf[0x2C1], 0x23);
        assert!(!set_language_byte(&mut buf, CONFIG1_V170, LANG_SPANISH));
        assert_eq!(buf[0x311], 0, "no tocar el offset del layout viejo");
    }
}
