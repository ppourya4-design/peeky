// Quick notes (plain JSON) and the password vault (encrypted for this Windows account with DPAPI).
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use windows::core::w;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::*;

use crate::{clip, sys};

fn write_atomic(path: &PathBuf, data: &[u8]) -> bool {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, data).is_ok() && std::fs::rename(&tmp, path).is_ok()
}

// ---------------------------------------------------------------- notes
#[derive(Serialize, Deserialize, Clone)]
struct Note {
    id: u64,
    text: String,
    #[serde(default)]
    pinned: bool,
    at: u64,
    #[serde(default)]
    remind: u64, // when to bring it back as a reminder (ms since 1970), 0 = never
    #[serde(default)]
    fired: bool,
}
static NOTES: Mutex<Option<Vec<Note>>> = Mutex::new(None);

fn notes_file() -> PathBuf {
    sys::data_dir().join("notes.json")
}
fn with_notes<T>(f: impl FnOnce(&mut Vec<Note>) -> T) -> T {
    let mut g = NOTES.lock().unwrap();
    let list = g.get_or_insert_with(|| std::fs::read_to_string(notes_file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default());
    f(list)
}
fn notes_changed(list: &mut Vec<Note>) -> Value {
    list.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.at.cmp(&a.at)));
    write_atomic(&notes_file(), serde_json::to_string(list).unwrap_or_default().as_bytes());
    let v = serde_json::to_value(&*list).unwrap_or(Value::Null);
    sys::emit("notes", v.clone());
    v
}
pub fn notes() -> Value {
    with_notes(|l| serde_json::to_value(&*l).unwrap_or(Value::Null))
}
pub fn note_save(id: Option<u64>, text: &str, remind: u64) -> Value {
    let text = text.trim();
    with_notes(|l| {
        if text.is_empty() || text.len() > 20_000 {
            return serde_json::to_value(&*l).unwrap_or(Value::Null);
        }
        match id.and_then(|id| l.iter_mut().find(|n| n.id == id)) {
            Some(n) => {
                n.text = text.to_string();
                n.remind = remind;
                n.fired = false;
            }
            None => {
                let id = l.iter().map(|n| n.id).max().unwrap_or(0) + 1;
                l.push(Note { id, text: text.to_string(), pinned: false, at: sys::now_ms(), remind, fired: false });
                if l.len() > 300 {
                    if let Some(i) = l.iter().rposition(|n| !n.pinned) {
                        l.remove(i);
                    }
                }
            }
        }
        notes_changed(l)
    })
}
pub fn note_pin(id: u64) -> Value {
    with_notes(|l| {
        if let Some(n) = l.iter_mut().find(|n| n.id == id) {
            n.pinned = !n.pinned;
        }
        notes_changed(l)
    })
}
pub fn note_fired(id: u64) -> Value {
    with_notes(|l| {
        if let Some(n) = l.iter_mut().find(|n| n.id == id) {
            n.fired = true;
        }
        notes_changed(l)
    })
}
pub fn note_remove(id: u64) -> Value {
    with_notes(|l| {
        l.retain(|n| n.id != id);
        notes_changed(l)
    })
}

// ---------------------------------------------------------------- vault
#[derive(Serialize, Deserialize, Clone)]
struct Entry {
    id: u64,
    site: String,
    user: String,
    pass: String,
    at: u64,
}
struct Vault {
    entries: Vec<Entry>,
    unreadable: bool, // a vault file exists but could not be opened: never write over it
}
static VAULT: Mutex<Option<Vault>> = Mutex::new(None);
const ENTROPY: &[u8] = b"island.vault.v1";

fn vault_file() -> PathBuf {
    sys::data_dir().join("vault.bin")
}
fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
}
unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
    let _ = LocalFree(Some(HLOCAL(out.pbData as *mut _)));
    v
}
fn protect(data: &[u8]) -> Option<Vec<u8>> {
    unsafe {
        let mut out = CRYPT_INTEGER_BLOB::default();
        CryptProtectData(&blob(data), w!("Island vault"), Some(&blob(ENTROPY)), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).ok()?;
        Some(take(out))
    }
}
fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
    unsafe {
        let mut out = CRYPT_INTEGER_BLOB::default();
        CryptUnprotectData(&blob(data), None, Some(&blob(ENTROPY)), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).ok()?;
        Some(take(out))
    }
}
fn with_vault<T>(f: impl FnOnce(&mut Vault) -> T) -> T {
    let mut g = VAULT.lock().unwrap();
    let v = g.get_or_insert_with(|| match std::fs::read(vault_file()) {
        Err(_) => Vault { entries: Vec::new(), unreadable: false },
        Ok(raw) => match unprotect(&raw).and_then(|plain| serde_json::from_slice::<Vec<Entry>>(&plain).ok()) {
            Some(entries) => Vault { entries, unreadable: false },
            None => {
                sys::log("the vault file could not be opened with this Windows account; it is left untouched");
                Vault { entries: Vec::new(), unreadable: true }
            }
        },
    });
    f(v)
}
fn vault_changed(v: &mut Vault) -> bool {
    if v.unreadable {
        // keep the file we could not read under another name instead of destroying it
        let keep = sys::data_dir().join(format!("vault.unreadable.{}.bin", sys::now_ms()));
        if std::fs::rename(vault_file(), &keep).is_err() {
            return false;
        }
        v.unreadable = false;
    }
    let plain = serde_json::to_vec(&v.entries).unwrap_or_default();
    let ok = protect(&plain).is_some_and(|enc| write_atomic(&vault_file(), &enc));
    sys::emit("vault", vault_public(v));
    ok
}
/// What the page may see: everything except the passwords themselves.
fn vault_public(v: &Vault) -> Value {
    let mut list: Vec<&Entry> = v.entries.iter().collect();
    list.sort_by(|a, b| a.site.to_lowercase().cmp(&b.site.to_lowercase()));
    json!({
        "locked": v.unreadable,
        "items": list.iter().map(|e| json!({ "id": e.id, "site": e.site, "user": e.user, "len": e.pass.chars().count(), "at": e.at })).collect::<Vec<_>>(),
    })
}
pub fn vault_list() -> Value {
    with_vault(|v| vault_public(v))
}
pub fn vault_save(site: &str, user: &str, pass: &str) -> bool {
    let (site, user) = (site.trim(), user.trim());
    if pass.is_empty() || pass.len() > 1000 || site.len() > 300 || user.len() > 300 {
        return false;
    }
    with_vault(|v| {
        let id = v.entries.iter().map(|e| e.id).max().unwrap_or(0) + 1;
        let site = if site.is_empty() { "Untitled" } else { site };
        v.entries.push(Entry { id, site: site.to_string(), user: user.to_string(), pass: pass.to_string(), at: sys::now_ms() });
        vault_changed(v)
    })
}
pub fn vault_remove(id: u64) -> bool {
    with_vault(|v| {
        v.entries.retain(|e| e.id != id);
        vault_changed(v)
    })
}
pub fn vault_reveal(id: u64) -> Option<String> {
    with_vault(|v| v.entries.iter().find(|e| e.id == id).map(|e| e.pass.clone()))
}
/// Puts a secret on the clipboard for half a minute, hidden from clipboard histories.
pub fn copy_secret(text: &str) -> bool {
    if !clip::write_private(text) {
        return false;
    }
    let seq = clip::sequence();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(30));
        clip::clear_if_unchanged(seq);
    });
    true
}
pub fn vault_copy(id: u64, what: &str) -> bool {
    let Some((user, pass)) = with_vault(|v| v.entries.iter().find(|e| e.id == id).map(|e| (e.user.clone(), e.pass.clone()))) else { return false };
    if what == "user" { clip::write_text(&user) } else { copy_secret(&pass) }
}

/// A random password from the system's cryptographic generator, with every chosen kind of character present.
pub fn generate(len: usize, symbols: bool) -> String {
    const LOWER: &[u8] = b"abcdefghijkmnopqrstuvwxyz";
    const UPPER: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ";
    const DIGIT: &[u8] = b"23456789";
    const SYMBOL: &[u8] = b"!@#$%&*-_=+?";
    let len = len.clamp(8, 40);
    let mut sets: Vec<&[u8]> = vec![LOWER, UPPER, DIGIT];
    if symbols {
        sets.push(SYMBOL);
    }
    let all: Vec<u8> = sets.concat();
    let pick = |set: &[u8]| -> u8 {
        let limit = 256 - (256 % set.len());
        loop {
            let mut b = [0u8; 1];
            unsafe {
                let _ = BCryptGenRandom(None, &mut b, BCRYPT_USE_SYSTEM_PREFERRED_RNG);
            }
            if (b[0] as usize) < limit {
                return set[b[0] as usize % set.len()];
            }
        }
    };
    loop {
        let out: Vec<u8> = (0..len).map(|_| pick(&all)).collect();
        if sets.iter().all(|s| out.iter().any(|c| s.contains(c))) {
            return String::from_utf8(out).unwrap_or_default();
        }
    }
}
