// Settings (one small JSON file) and the "Start with Windows" entry.
use std::ffi::c_void;
use std::sync::Mutex;

use serde_json::{json, Map, Value};
use windows::core::HSTRING;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::*;

use windows::Win32::UI::Input::KeyboardAndMouse::{MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_WIN};

use crate::sys;

static SETTINGS: Mutex<Option<Map<String, Value>>> = Mutex::new(None);
const THEMES: [&str; 9] = ["black", "ember", "venom", "sketch", "iris", "cloud", "water", "lava", "ice"];
const BOOLS: [&str; 19] = ["autoUpdate", "musicReact", "netAlerts", "sensorDot", "smartCopy", "autoHide", "hideVideo", "copyPreview", "clipHistory", "deviceAlerts", "downloadAlerts", "shelf", "visuals", "noteHotkey", "vaultSymbols", "musicShuffle", "musicEnabled", "playerTheme", "toolsFold"];
/// Tool buttons that can be switched off (the gear can not: it is the way back; the track button and the file shelf come and go by themselves).
const HIDEABLE_TOOLS: [&str; 10] = ["play", "screenshot", "ocr", "clips", "music", "notes", "vault", "speedo", "timer", "inbox"];
const EYE_STYLES: [&str; 6] = ["round", "venom", "sleepy", "sad", "robot", "wide"];
const CALENDARS: [&str; 4] = ["gregorian", "shamsi", "shamsi-fa", "both"];

fn defaults() -> Map<String, Value> {
    json!({
        "autoHide": true, "dndHint": false, "toured": false, "calendar": "gregorian", "hideVideo": true,
        "copyPreview": true, "clipHistory": true, "deviceAlerts": true, "downloadAlerts": true, "shelf": true, "visuals": true,
        "notifSeconds": 4,          // how long a notification stays on the pill
        "face": "eyes",             // what the resting pill shows: "eyes" or "clock"
        "eyeStyle": "round",        // the shape of the eyes (any theme can wear any of them)
        "noteHotkey": true,         // the global shortcuts (quick note, text grab) are on
        "keyNote": "Ctrl+Alt+N",    // the quick-note shortcut (can be changed in Settings)
        "keyOcr": "Ctrl+Alt+T",     // the text-grab shortcut
        "musicFolder": "",          // the folder the local player reads
        "musicShuffle": false,
        "musicRepeat": 0,           // local player repeat: 0 off, 1 all, 2 one
        "musicEnabled": true,       // the whole local music player can be switched off
        "toolsOff": [],             // tool buttons switched off in Settings -> Tools (hidden from the pill)
        "toolsFold": true,          // tools beyond the first nine fold behind an arrow (off: the row just grows)
        "playerTheme": true,        // the player window wears the pill's theme (off: plain, in the cover's colour)
        "vaultLength": 18, "vaultSymbols": true, "lastUser": "",
        "monitor": "primary",       // which display the island sits on: "primary" or a display's device name
        "lang": "en",               // the interface language: "en" or "fa"
        "uiScale": 1.0,             // how big the island is: 0.6 to 2.0 (a bigger screen may want it bigger)
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
    // a theme that was taken out of the app (Reactor) must not stay saved: it falls back to plain black / the cover's colours
    if map.get("skin").and_then(|v| v.as_str()).map_or(false, |v| !THEMES.contains(&v)) {
        map.insert("skin".into(), "black".into());
    }
    if map.get("musicTheme").and_then(|v| v.as_str()).map_or(false, |v| v != "sky" && (v == "black" || !THEMES.contains(&v))) {
        map.insert("musicTheme".into(), "sky".into());
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
/// How big the island is drawn (1.0 = the normal size). Always inside 0.6 .. 2.0.
pub fn ui_scale() -> f64 {
    get("uiScale").as_f64().filter(|n| n.is_finite() && (0.6..=2.0).contains(n)).unwrap_or(1.0)
}
/// A shortcut written as "Ctrl+Alt+N": at least one of Ctrl / Alt / Win (plus Shift if wanted) and one key (A-Z, 0-9, F1-F12).
/// Returns the tidy spelling, the modifier bits and the virtual-key code. Anything else is refused.
pub fn parse_combo(text: &str) -> Option<(String, u32, u32)> {
    let (mut ctrl, mut alt, mut shift, mut win) = (false, false, false, false);
    let mut key: Option<(String, u32)> = None;
    for part in text.split('+').map(|p| p.trim()) {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => ctrl = true,
            "alt" => alt = true,
            "shift" => shift = true,
            "win" | "meta" | "super" | "windows" => win = true,
            p if key.is_none() => {
                let up = p.to_ascii_uppercase();
                let b = up.as_bytes();
                if b.len() == 1 && (b[0].is_ascii_uppercase() || b[0].is_ascii_digit()) {
                    key = Some((up.clone(), b[0] as u32));
                } else if b.len() >= 2 && b[0] == b'F' {
                    let n: u32 = up[1..].parse().ok()?;
                    if !(1..=12).contains(&n) {
                        return None;
                    }
                    key = Some((up.clone(), 0x70 + n - 1));
                } else {
                    return None;
                }
            }
            _ => return None,
        }
    }
    let (name, vk) = key?;
    if !(ctrl || alt || win) {
        return None;            // a bare letter (or Shift+letter) would steal normal typing everywhere
    }
    let mut label = String::new();
    let mut bits = 0u32;
    for (on, word, flag) in [(ctrl, "Ctrl", MOD_CONTROL.0), (alt, "Alt", MOD_ALT.0), (shift, "Shift", MOD_SHIFT.0), (win, "Win", MOD_WIN.0)] {
        if on {
            label.push_str(word);
            label.push('+');
            bits |= flag;
        }
    }
    label.push_str(&name);
    Some((label, bits, vk))
}
/// The shortcut saved under `key`, or the default when the saved text is not a valid shortcut.
pub fn combo(key: &str, default: &str) -> (String, u32, u32) {
    get(key).as_str().and_then(parse_combo).or_else(|| parse_combo(default)).unwrap_or_default()
}
pub fn payload() -> Value {
    let mut map = with(|m| m.clone());
    map.insert("keyNoteFail".into(), crate::hit::NOTE_KEY_FAIL.load(std::sync::atomic::Ordering::SeqCst).into());
    map.insert("keyOcrFail".into(), crate::hit::OCR_KEY_FAIL.load(std::sync::atomic::Ordering::SeqCst).into());
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
        "monitor" => {
            if let Some(v) = value.as_str().filter(|v| v.len() < 64 && !v.chars().any(|c| c.is_control())) {
                put(key, v.into());
                crate::hit::REPLACE.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        "uiScale" => {
            // the size of the island: the window grows or shrinks with it (see hit::place) and the page is zoomed to match
            if let Some(n) = value.as_f64().filter(|n| n.is_finite() && (0.6..=2.0).contains(n)) {
                put(key, ((n * 20.0).round() / 20.0).into());
                crate::hit::REPLACE.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        "lang" => {
            if let Some(v) = value.as_str().filter(|v| ["en", "fa"].contains(v)) {
                put(key, v.into());
            }
        }
        "face" => {
            if let Some(v) = value.as_str().filter(|v| ["eyes", "clock"].contains(v)) {
                put(key, v.into());
            }
        }
        "eyeStyle" => {
            if let Some(v) = value.as_str().filter(|v| EYE_STYLES.contains(v)) {
                put(key, v.into());
            }
        }
        "keyNote" | "keyOcr" => {
            // a new shortcut: must be a valid combination and must not be the other shortcut's
            let other = if key == "keyNote" { combo("keyOcr", "Ctrl+Alt+T") } else { combo("keyNote", "Ctrl+Alt+N") };
            if let Some((label, bits, vk)) = value.as_str().and_then(parse_combo) {
                if (bits, vk) != (other.1, other.2) {
                    put(key, label.into());
                }
            }
        }
        "toolOrder" => {
            // the pill's tool row, arranged by its owner (long-press a tool, drag it into place)
            const TOOLS: [&str; 13] = ["track", "play", "screenshot", "ocr", "clips", "music", "notes", "vault", "speedo", "timer", "shelf", "inbox", "settings"];
            if let Some(arr) = value.as_array() {
                let mut seen = std::collections::HashSet::new();
                let list: Vec<Value> = arr.iter().filter_map(|v| v.as_str()).filter(|k| TOOLS.contains(k) && seen.insert(*k)).map(|k| Value::from(k)).collect();
                put(key, Value::Array(list));
            }
        }
        "toolsOff" => {
            // the tool buttons the owner switched off in Settings -> Tools: they simply do not show on the pill
            if let Some(arr) = value.as_array() {
                let mut seen = std::collections::HashSet::new();
                let list: Vec<Value> = arr.iter().filter_map(|v| v.as_str()).filter(|k| HIDEABLE_TOOLS.contains(k) && seen.insert(*k)).map(Value::from).collect();
                put(key, Value::Array(list));
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
            for old in sys::OLD_NAMES {
                let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(RUN_KEY), &HSTRING::from(old));
            }
        }
    }
    if packaged() && get("autoStart") != Value::Bool(false) && !autostart_on() {
        set_autostart(true);
        sys::log(&format!("start-with-Windows entry written -> {}", autostart_on()));
    }
}
