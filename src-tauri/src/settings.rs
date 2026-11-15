// Settings (one small JSON file) and the "Start with Windows" entry.
use std::ffi::c_void;
use std::sync::Mutex;

use serde_json::{json, Map, Value};
use windows::core::HSTRING;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::*;

use crate::sys;

static SETTINGS: Mutex<Option<Map<String, Value>>> = Mutex::new(None);
const THEMES: [&str; 10] = ["black", "nebula", "crystal", "ember", "reactor", "venom", "cloud", "water", "lava", "ice"];
const BOOLS: [&str; 18] = ["autoUpdate", "musicReact", "netAlerts", "sensorDot", "smartCopy", "autoHide", "hideVideo", "copyPreview", "clipHistory", "deviceAlerts", "downloadAlerts", "shelf", "visuals", "noteHotkey", "vaultSymbols", "musicShuffle", "musicEnabled", "playerTheme"];
const CALENDARS: [&str; 4] = ["gregorian", "shamsi", "shamsi-fa", "both"];

fn defaults() -> Map<String, Value> {
    json!({
        "autoHide": true, "dndHint": false, "toured": false, "calendar": "gregorian", "hideVideo": true,
        "copyPreview": true, "clipHistory": true, "deviceAlerts": true, "downloadAlerts": true, "shelf": true, "visuals": true,
        "notifSeconds": 4,          // how long a notification stays on the pill
        "face": "eyes",             // what the resting pill shows: "eyes" or "clock"
        "noteHotkey": true,         // Ctrl+Alt+N opens the quick note from anywhere
        "musicFolder": "",          // the folder the local player reads
        "musicShuffle": false,
        "musicRepeat": 0,           // local player repeat: 0 off, 1 all, 2 one
        "musicEnabled": true,       // the whole local music player can be switched off
        "playerTheme": true,        // the player window wears the pill's theme (off: plain, in the cover's colour)
        "vaultLength": 18, "vaultSymbols": true, "lastUser": "",
        "skin": "black",            // the resting pill: plain black or one of the animated skins
        "musicTheme": "sky",        // what plays behind the track: "sky" (colours of the cover) or a skin
        "netAlerts": true, "sensorDot": true, "smartCopy": true, "musicReact": true, "autoUpdate": true,
    })
    .as_object()
    .cloned()
    .unwrap_or_default()
}
fn file() -> std::path::PathBuf {
    sys::data_dir().join("settings.json")
}
fn with<T>(f: impl FnOnce(&mut Map<String, Value>) -> T) -> T {
    let mut g = SETTINGS.lock().unwrap();
    f(g.get_or_insert_with(defaults))
}

pub fn load() {
    let mut map = defaults();
    if let Ok(Value::Object(saved)) = std::fs::read_to_string(file()).map_err(|_| ()).and_then(|t| serde_json::from_str::<Value>(&t).map_err(|_| ())) {
        for (k, v) in saved {
            map.insert(k, v);
        }
    }
    *SETTINGS.lock().unwrap() = Some(map);
}
fn save() {
    let text = with(|m| serde_json::to_string(m).unwrap_or_default());
    let _ = std::fs::write(file(), text);
}
pub fn get(key: &str) -> Value {
    with(|m| m.get(key).cloned().unwrap_or(Value::Null))
}
pub fn flag(key: &str) -> bool {
    get(key).as_bool().unwrap_or(false)
}
pub fn put(key: &str, value: Value) {
    with(|m| m.insert(key.to_string(), value));
    save();
}
pub fn payload() -> Value {
    let mut map = with(|m| m.clone());
    map.insert("autoStartOn".into(), autostart_on().into());
    map.insert("version".into(), env!("CARGO_PKG_VERSION").into());
    map.insert("appName".into(), sys::APP_NAME.into());
    Value::Object(map)
}
pub fn broadcast() {
    sys::emit("settings", payload());
}

/// A change asked for by the page: only known keys with sane values are accepted.
pub fn apply(key: &str, value: &Value) {
    match key {
        "autoStart" => {
            let on = value.as_bool().unwrap_or(false);
            put("autoStart", on.into());
            set_autostart(on);
        }
        "calendar" => {
            if let Some(v) = value.as_str().filter(|v| CALENDARS.contains(v)) {
                put(key, v.into());
            }
        }
        "face" => {
            if let Some(v) = value.as_str().filter(|v| ["eyes", "clock"].contains(v)) {
                put(key, v.into());
            }
        }
        "skin" => {
            if let Some(v) = value.as_str().filter(|v| THEMES.contains(v)) {
                put(key, v.into());
            }
        }
        "musicTheme" => {
            if let Some(v) = value.as_str().filter(|v| *v == "sky" || (THEMES.contains(v) && *v != "black")) {
                put(key, v.into());
            }
        }
        "notifSeconds" => {
            if let Some(n) = value.as_f64().map(|n| n.round() as i64).filter(|n| (2..=15).contains(n)) {
                put(key, n.into());
            }
        }
        "vaultLength" => {
            if let Some(n) = value.as_f64().map(|n| n.round() as i64).filter(|n| (8..=40).contains(n)) {
                put(key, n.into());
            }
        }
        "musicRepeat" => {
            if let Some(n) = value.as_f64().map(|n| n.round() as i64).filter(|n| (0..=2).contains(n)) {
                put(key, n.into());
            }
        }
        "musicFolder" => {
            // an existing folder, or "" to forget it
            if let Some(v) = value.as_str().filter(|v| v.is_empty() || std::path::Path::new(v).is_dir()) {
                put(key, v.into());
            }
        }
        "dndHint" | "toured" => put(key, true.into()),
        _ if BOOLS.contains(&key) => put(key, value.as_bool().unwrap_or(false).into()),
        _ => return,
    }
    crate::hit::HOTKEY_WANTED.store(flag("noteHotkey"), std::sync::atomic::Ordering::SeqCst);
    broadcast();
}

// ---------------------------------------------------------------- start with Windows
// Our own value under the user's Run key, written and read back directly.
const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

fn exe() -> String {
    std::env::current_exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
}
pub fn packaged() -> bool {
    sys::debug_dir().is_none() && !exe().to_ascii_lowercase().contains("\\target\\")
}
pub fn autostart_on() -> bool {
    unsafe {
        let mut buf = [0u16; 600];
        let mut n = (buf.len() * 2) as u32;
        let r = RegGetValueW(HKEY_CURRENT_USER, &HSTRING::from(RUN_KEY), &HSTRING::from(sys::APP_NAME), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as *mut c_void), Some(&mut n));
        r == ERROR_SUCCESS && sys::from_wide(&buf).to_lowercase().contains(&exe().to_lowercase())
    }
}
pub fn set_autostart(on: bool) {
    unsafe {
        if on {
            let cmd: Vec<u16> = format!("\"{}\"", exe()).encode_utf16().chain(std::iter::once(0)).collect();
            let _ = RegSetKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(RUN_KEY), &HSTRING::from(sys::APP_NAME), REG_SZ.0, Some(cmd.as_ptr() as *const c_void), (cmd.len() * 2) as u32);
        } else {
            let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(RUN_KEY), &HSTRING::from(sys::APP_NAME));
        }
    }
}
/// The installed copy starts with Windows unless the user switched that off. Checked on every launch, so it
/// heals itself if an installer or a cleaner removed the entry (or the app moved to a new folder).
pub fn ensure_autostart() {
    if packaged() {
        unsafe {
            let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(RUN_KEY), &HSTRING::from(sys::OLD_NAME));
        }
    }
    if packaged() && get("autoStart") != Value::Bool(false) && !autostart_on() {
        set_autostart(true);
        sys::log(&format!("start-with-Windows entry written -> {}", autostart_on()));
    }
}
