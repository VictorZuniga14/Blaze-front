//! Instala update/DLC NSP en la User NAND de Eden (mismo layout que
//! Archivo → Install Files to NAND / ContentManager::InstallNSP).

use nsz_rs::crypto::ctr;
use nsz_rs::format::cnmt::Cnmt;
use nsz_rs::format::nca::{
    self, decrypt_header_bytes, NcaHeader, CONTENT_META, HEADER_ENCRYPTED_SIZE,
};
use nsz_rs::format::pfs0::{Pfs0Entry, Pfs0Reader};
use nsz_rs::keys::Keys;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// ContentRecordType::DeltaFragment (Nintendo).
const CONTENT_TYPE_DELTA_FRAGMENT: u8 = 6;

const META_NCA_MAX_BYTES: u64 = 16 * 1024 * 1024;

pub struct InstallProgress {
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub message: String,
}

/// Instala un NSP (update/DLC) en una o más raíces `nand/` de Eden.
pub fn install_nsp_to_user_nand(
    nsp_path: &Path,
    keys_dir: &Path,
    nand_roots: &[&Path],
    on_progress: &mut dyn FnMut(InstallProgress),
) -> Result<(), String> {
    if nand_roots.is_empty() {
        return Err("No hay rutas NAND de destino.".into());
    }
    let prod_keys = keys_dir.join("prod.keys");
    if !prod_keys.is_file() {
        return Err(format!("Falta prod.keys en {}.", keys_dir.display()));
    }
    let keys = Keys::load(&prod_keys, false)
        .map_err(|e| format!("No se pudieron cargar prod.keys: {e}"))?;

    let mut file = File::open(nsp_path)
        .map_err(|e| format!("No se pudo abrir {}: {e}", nsp_path.display()))?;
    let mut pfs0 = Pfs0Reader::new(&mut file)
        .map_err(|e| format!("NSP inválido ({}): {e}", nsp_path.display()))?;
    let entries = pfs0.entries.clone();

    let mut title_keys = load_title_keys_file(keys_dir)?;
    let from_tik = collect_title_keys(&mut pfs0, &entries)?;
    for (k, v) in from_tik {
        title_keys.insert(k, v);
    }
    merge_title_keys_file(keys_dir, &title_keys)?;

    let (meta_entry, meta_id, cnmt) =
        read_meta_cnmt(&mut pfs0, &entries, &keys, &title_keys, nsp_path)?;
    // Drop borrow on the NSP file before streaming copies reopen it.
    drop(pfs0);
    drop(file);

    let title_id = u64::from_str_radix(&cnmt.title_id, 16).map_err(|_| {
        format!(
            "Title ID inválido en CNMT de {}: {}",
            nsp_path.display(),
            cnmt.title_id
        )
    })?;
    if title_id == base_title_id(title_id) && cnmt.version == 0 {
        return Err(format!(
            "{} es un NSP base; Blaze solo instala update/DLC a NAND.",
            file_name(nsp_path)
        ));
    }

    let mut to_install: Vec<([u8; 16], Pfs0Entry)> = Vec::new();
    to_install.push((meta_id, meta_entry));

    for rec in &cnmt.content_entries {
        if rec.content_type == CONTENT_TYPE_DELTA_FRAGMENT {
            continue;
        }
        let entry = find_nca_entry(&entries, &rec.nca_id).ok_or_else(|| {
            format!(
                "{}: falta NCA {} listado en el CNMT.",
                file_name(nsp_path),
                hex::encode(rec.nca_id)
            )
        })?;
        if to_install.iter().any(|(id, _)| id == &rec.nca_id) {
            continue;
        }
        to_install.push((rec.nca_id, entry));
    }

    let bytes_total: u64 = to_install.iter().map(|(_, e)| e.size).sum::<u64>()
        * (nand_roots.len() as u64).max(1);
    let mut bytes_done = 0u64;
    on_progress(InstallProgress {
        bytes_done,
        bytes_total,
        message: format!("Instalando {}…", file_name(nsp_path)),
    });

    for nand_root in nand_roots {
        let registered = user_registered_dir(nand_root)?;
        for (nca_id, entry) in &to_install {
            let dest = registered_nca_path(&registered, nca_id);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("No se pudo crear {}: {e}", parent.display()))?;
            }
            if dest.exists() {
                let _ = fs::remove_file(&dest);
            }
            copy_nsp_member_to_path(nsp_path, entry, &dest, &mut |n| {
                bytes_done = bytes_done.saturating_add(n);
                on_progress(InstallProgress {
                    bytes_done: bytes_done.min(bytes_total),
                    bytes_total,
                    message: format!(
                        "Instalando {} → {}",
                        file_name(nsp_path),
                        dest.file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("nca")
                    ),
                });
            })?;
        }
    }

    on_progress(InstallProgress {
        bytes_done: bytes_total,
        bytes_total,
        message: format!("Instalado {}", file_name(nsp_path)),
    });
    Ok(())
}

fn user_registered_dir(nand_root: &Path) -> Result<PathBuf, String> {
    let dir = nand_root
        .join("user")
        .join("Contents")
        .join("registered");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Layout Eden/yuzu: `/000000XX/{nca_id}.nca` donde XX = SHA256(nca_id)[0].
fn registered_nca_path(registered: &Path, nca_id: &[u8; 16]) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(nca_id);
    let hash = hasher.finalize();
    let bucket = format!("000000{:02X}", hash[0]);
    let name = format!("{}.nca", hex::encode(nca_id));
    registered.join(bucket).join(name)
}

fn base_title_id(title_id: u64) -> u64 {
    title_id & 0xFFFF_FFFF_FFFF_E000
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn collect_title_keys(
    pfs0: &mut Pfs0Reader<impl Read + Seek>,
    entries: &[Pfs0Entry],
) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    for entry in entries
        .iter()
        .filter(|e| e.name.to_ascii_lowercase().ends_with(".tik"))
    {
        let tik = pfs0
            .read_file(entry)
            .map_err(|e| format!("Error leyendo ticket {}: {e}", entry.name))?;
        if let Some((rights_id, enc_key)) = parse_ticket(&tik) {
            out.insert(
                hex::encode(rights_id).to_lowercase(),
                hex::encode(enc_key).to_lowercase(),
            );
        }
    }
    Ok(out)
}

fn parse_ticket(tik: &[u8]) -> Option<([u8; 16], [u8; 16])> {
    let sig_type = u32::from_le_bytes(tik.get(0..4)?.try_into().ok()?);
    let sig_size = match sig_type {
        0x010000 | 0x010003 => 0x200,
        0x010001 | 0x010004 => 0x100,
        0x010002 | 0x010005 => 0x3C,
        _ => return None,
    };
    let data = 4 + sig_size + (0x40 - (sig_size + 4) % 0x40);
    let key = tik.get(data + 0x40..data + 0x50)?.try_into().ok()?;
    let rights_id = tik.get(data + 0x160..data + 0x170)?.try_into().ok()?;
    Some((rights_id, key))
}

fn load_title_keys_file(keys_dir: &Path) -> Result<HashMap<String, String>, String> {
    let path = keys_dir.join("title.keys");
    let mut map = HashMap::new();
    if !path.is_file() {
        return Ok(map);
    }
    let text =
        fs::read_to_string(&path).map_err(|e| format!("No se pudo leer title.keys: {e}"))?;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            map.insert(k.trim().to_lowercase(), v.trim().to_lowercase());
        }
    }
    Ok(map)
}

fn merge_title_keys_file(
    keys_dir: &Path,
    map: &HashMap<String, String>,
) -> Result<(), String> {
    if map.is_empty() {
        return Ok(());
    }
    let path = keys_dir.join("title.keys");
    let mut lines: Vec<String> = map
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect();
    lines.sort();
    fs::write(&path, lines.join("\n") + "\n")
        .map_err(|e| format!("No se pudo escribir title.keys: {e}"))?;
    Ok(())
}

fn read_meta_cnmt(
    pfs0: &mut Pfs0Reader<impl Read + Seek>,
    entries: &[Pfs0Entry],
    keys: &Keys,
    title_keys: &HashMap<String, String>,
    nsp_path: &Path,
) -> Result<(Pfs0Entry, [u8; 16], Cnmt), String> {
    let mut last_err = String::from("sin Meta NCA");
    for entry in entries.iter().filter(|e| is_nca_name(&e.name)) {
        if entry.size > META_NCA_MAX_BYTES {
            continue;
        }
        match try_parse_meta_cnmt(pfs0, entry, keys, title_keys) {
            Ok((id, cnmt)) => return Ok((entry.clone(), id, cnmt)),
            Err(e) => last_err = e,
        }
    }
    Err(format!(
        "{}: no se encontró Meta NCA/CNMT ({last_err}). Revisá prod.keys.",
        file_name(nsp_path)
    ))
}

fn try_parse_meta_cnmt(
    pfs0: &mut Pfs0Reader<impl Read + Seek>,
    entry: &Pfs0Entry,
    keys: &Keys,
    title_keys: &HashMap<String, String>,
) -> Result<([u8; 16], Cnmt), String> {
    let bytes = pfs0
        .read_file(entry)
        .map_err(|e| format!("{}: {e}", entry.name))?;
    if bytes.len() < HEADER_ENCRYPTED_SIZE {
        return Err(format!("{} demasiado corto", entry.name));
    }

    let header_key = keys
        .header_key()
        .map_err(|e| format!("header_key: {e}"))?;
    let mut hdr = bytes[..HEADER_ENCRYPTED_SIZE].to_vec();
    decrypt_header_bytes(&header_key, &mut hdr);
    if hdr[0x205] != CONTENT_META {
        return Err(format!("{} no es Meta NCA", entry.name));
    }

    let rights_id = &hdr[0x230..0x240];
    let rights_key = if rights_id.iter().any(|&b| b != 0) {
        let rid = hex::encode(rights_id).to_lowercase();
        let hex_key = title_keys.get(&rid).ok_or_else(|| {
            format!(
                "{} requiere title key (rightsId={})",
                entry.name,
                rid.to_uppercase()
            )
        })?;
        let mut key = [0u8; 16];
        let raw = hex::decode(hex_key).map_err(|e| format!("title key inválida: {e}"))?;
        if raw.len() != 16 {
            return Err("title key inválida (largo)".into());
        }
        key.copy_from_slice(&raw);
        Some(key)
    } else {
        None
    };

    let header = NcaHeader::parse(&hdr, keys, rights_key.as_ref())
        .map_err(|e| format!("{} header: {e}", entry.name))?;
    let st = header.section_tables[0];
    if st.end_offset <= st.offset || (st.end_offset as usize) > bytes.len() {
        return Err(format!("{}: sección 0 inválida", entry.name));
    }
    let mut section = bytes[st.offset as usize..st.end_offset as usize].to_vec();
    let fs_hdr = &hdr[nca::fs_header_offset(0)..];
    if nca::is_ctr(fs_hdr[0x4] as i64) {
        let counter = nca::section_counter(&hdr, 0);
        ctr::keystream_xor(&header.title_key_dec, &counter, st.offset, &mut section);
    }

    let pfs0_offset = u64::from_le_bytes(fs_hdr[0x40..0x48].try_into().unwrap()) as usize;
    let pfs0_bytes = section
        .get(pfs0_offset..)
        .ok_or_else(|| format!("{}: PFS0 CNMT fuera de rango", entry.name))?;
    let mut inner = Pfs0Reader::new(std::io::Cursor::new(pfs0_bytes))
        .map_err(|e| format!("{} CNMT PFS0: {e}", entry.name))?;
    let cnmt_entry = inner
        .entries
        .iter()
        .find(|e| e.name.to_ascii_lowercase().ends_with(".cnmt"))
        .cloned()
        .ok_or_else(|| format!("{}: sin archivo .cnmt", entry.name))?;
    let cnmt_bytes = inner
        .read_file(&cnmt_entry)
        .map_err(|e| format!("{}: {e}", entry.name))?;
    let cnmt = Cnmt::parse(&cnmt_bytes).map_err(|e| format!("{} CNMT: {e}", entry.name))?;

    let meta_id = nca_id_from_entry_name(&entry.name).unwrap_or_else(|| {
        let mut id = [0u8; 16];
        id.copy_from_slice(&Sha256::digest(&bytes)[..16]);
        id
    });
    Ok((meta_id, cnmt))
}

fn is_nca_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".nca") && !lower.ends_with(".ncz")
}

fn nca_id_from_entry_name(name: &str) -> Option<[u8; 16]> {
    let lower = name.to_ascii_lowercase();
    let stem = lower
        .strip_suffix(".cnmt.nca")
        .or_else(|| lower.strip_suffix(".nca"))?;
    let stem = stem.rsplit(['/', '\\']).next().unwrap_or(stem);
    if stem.len() != 32 {
        return None;
    }
    let bytes = hex::decode(stem).ok()?;
    if bytes.len() != 16 {
        return None;
    }
    let mut id = [0u8; 16];
    id.copy_from_slice(&bytes);
    Some(id)
}

fn find_nca_entry(entries: &[Pfs0Entry], nca_id: &[u8; 16]) -> Option<Pfs0Entry> {
    let hex_id = hex::encode(nca_id);
    entries
        .iter()
        .find(|e| {
            let n = e.name.to_ascii_lowercase();
            let base = n.rsplit(['/', '\\']).next().unwrap_or(&n);
            base == format!("{hex_id}.nca") || base == format!("{hex_id}.cnmt.nca")
        })
        .cloned()
}

fn copy_nsp_member_to_path(
    nsp_path: &Path,
    entry: &Pfs0Entry,
    dest: &Path,
    on_chunk: &mut dyn FnMut(u64),
) -> Result<(), String> {
    let mut src = File::open(nsp_path)
        .map_err(|e| format!("No se pudo abrir {}: {e}", nsp_path.display()))?;
    src.seek(SeekFrom::Start(entry.offset))
        .map_err(|e| format!("Seek NSP: {e}"))?;
    let mut out =
        File::create(dest).map_err(|e| format!("No se pudo crear {}: {e}", dest.display()))?;
    let mut remaining = entry.size;
    let mut buf = vec![0u8; 1024 * 1024];
    while remaining > 0 {
        let chunk = remaining.min(buf.len() as u64) as usize;
        src.read_exact(&mut buf[..chunk])
            .map_err(|e| format!("Error leyendo {}: {e}", entry.name))?;
        out.write_all(&buf[..chunk])
            .map_err(|e| format!("Error escribiendo {}: {e}", dest.display()))?;
        remaining -= chunk as u64;
        on_chunk(chunk as u64);
    }
    out.flush()
        .map_err(|e| format!("Flush {}: {e}", dest.display()))?;
    Ok(())
}
