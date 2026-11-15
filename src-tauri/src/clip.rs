// The clipboard: a short "Copied" preview, and a history of copied texts and pictures (pinned ones are kept).
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering::SeqCst};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use windows::core::w;
use windows::Win32::Foundation::{HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::*;
use windows::Win32::System::Memory::*;
use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

use crate::settings;
use crate::sys;

const CF_UNICODETEXT: u32 = 13;
const CF_DIB: u32 = 8;
const CF_HDROP: u32 = 15;
const CLIP_MAX: usize = 30;
const IMG_MAX: usize = 10;
const CLIP_MAX_CHARS: usize = 100_000;

pub static QUIET_UNTIL: AtomicU64 = AtomicU64::new(0); // our own copies: no preview, no new entry

enum Body {
    Text(String),
    Image { png: Vec<u8>, w: u32, h: u32, thumb: String, hash: u64 },
}
struct Clip {
    id: u64,
    body: Body,
    pinned: bool,
    at: u64,
}
struct State {
    clips: Vec<Clip>,
    seq: u64,
}
static STATE: Mutex<State> = Mutex::new(State { clips: Vec::new(), seq: 0 });

// ---------------------------------------------------------------- raw clipboard access
struct Clipboard;
impl Clipboard {
    fn open() -> Option<Self> {
        for _ in 0..10 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                return Some(Self);
            }
            std::thread::sleep(Duration::from_millis(15)); // another program has it open right now
        }
        None
    }
}
impl Drop for Clipboard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}
fn has(fmt: u32) -> bool {
    unsafe { IsClipboardFormatAvailable(fmt).is_ok() }
}
unsafe fn get_bytes(fmt: u32) -> Option<Vec<u8>> {
    let h = GetClipboardData(fmt).ok()?;
    let g = HGLOBAL(h.0);
    let p = GlobalLock(g);
    if p.is_null() {
        return None;
    }
    let v = std::slice::from_raw_parts(p as *const u8, GlobalSize(g)).to_vec();
    let _ = GlobalUnlock(g);
    Some(v)
}
unsafe fn set_bytes(fmt: u32, data: &[u8]) -> bool {
    let Ok(g) = GlobalAlloc(GMEM_MOVEABLE, data.len().max(1)) else { return false };
    let p = GlobalLock(g);
    if p.is_null() {
        return false;
    }
    std::ptr::copy_nonoverlapping(data.as_ptr(), p as *mut u8, data.len());
    let _ = GlobalUnlock(g);
    SetClipboardData(fmt, Some(HANDLE(g.0))).is_ok()
}
fn utf16_bytes(text: &str) -> Vec<u8> {
    text.encode_utf16().chain(std::iter::once(0)).flat_map(|c| c.to_le_bytes()).collect()
}
fn png_format() -> u32 {
    unsafe { RegisterClipboardFormatW(w!("PNG")) }
}

pub fn write_text(text: &str) -> bool {
    QUIET_UNTIL.store(sys::now_ms() + 1500, SeqCst);
    let Some(_c) = Clipboard::open() else { return false };
    unsafe {
        let _ = EmptyClipboard();
        set_bytes(CF_UNICODETEXT, &utf16_bytes(text))
    }
}
/// For secrets: marked so that Windows' own clipboard history, cloud sync and other watchers leave it alone.
pub fn write_private(text: &str) -> bool {
    QUIET_UNTIL.store(sys::now_ms() + 1500, SeqCst);
    let Some(_c) = Clipboard::open() else { return false };
    unsafe {
        let _ = EmptyClipboard();
        let ok = set_bytes(CF_UNICODETEXT, &utf16_bytes(text));
        set_bytes(RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing")), &[0]);
        set_bytes(RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory")), &0u32.to_le_bytes());
        set_bytes(RegisterClipboardFormatW(w!("CanUploadToCloudClipboard")), &0u32.to_le_bytes());
        ok
    }
}
/// Empties the clipboard if it still holds exactly what we put there (used to forget a copied password).
pub fn clear_if_unchanged(seq: u32) {
    unsafe {
        if GetClipboardSequenceNumber() == seq {
            QUIET_UNTIL.store(sys::now_ms() + 1500, SeqCst);
            if let Some(_c) = Clipboard::open() {
                let _ = EmptyClipboard();
            }
        }
    }
}
pub fn sequence() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}
fn write_image(png: &[u8]) -> bool {
    let Ok(img) = image::load_from_memory(png) else { return false };
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    // a bottom-up 32-bit DIB for programs that only take bitmaps, plus the PNG itself for those that keep transparency
    let mut dib = Vec::with_capacity(40 + (w * h * 4) as usize);
    dib.extend_from_slice(&40u32.to_le_bytes());
    dib.extend_from_slice(&(w as i32).to_le_bytes());
    dib.extend_from_slice(&(h as i32).to_le_bytes());
    dib.extend_from_slice(&1u16.to_le_bytes());
    dib.extend_from_slice(&32u16.to_le_bytes());
    dib.extend_from_slice(&[0u8; 24]);
    for y in (0..h).rev() {
        for x in 0..w {
            let p = rgba.get_pixel(x, y).0;
            dib.extend_from_slice(&[p[2], p[1], p[0], p[3]]);
        }
    }
    QUIET_UNTIL.store(sys::now_ms() + 1500, SeqCst);
    let Some(_c) = Clipboard::open() else { return false };
    unsafe {
        let _ = EmptyClipboard();
        let ok = set_bytes(CF_DIB, &dib);
        set_bytes(png_format(), png);
        ok
    }
}

// ---------------------------------------------------------------- reading what was copied
fn fnv(data: &[u8]) -> u64 {
    let mut h = 0xcbf29ce484222325u64;
    for b in data {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}
fn make_image(png: Vec<u8>) -> Option<Body> {
    let img = image::load_from_memory(&png).ok()?;
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 || (w as u64) * (h as u64) > 40_000_000 {
        return None;
    }
    let small = img.thumbnail(200, 60).to_rgba8();
    let thumb = sys::b64(&sys::encode_png(&small, small.width(), small.height())?);
    Some(Body::Image { hash: fnv(&png), png, w, h, thumb })
}
fn read_image() -> Option<Body> {
    unsafe {
        if has(png_format()) {
            if let Some(b) = get_bytes(png_format()).and_then(make_image) {
                return Some(b);
            }
        }
        let dib = get_bytes(CF_DIB)?;
        let dec = image::codecs::bmp::BmpDecoder::new_without_file_header(Cursor::new(dib)).ok()?;
        let img = image::DynamicImage::from_decoder(dec).ok()?.to_rgba8();
        make_image(sys::encode_png(&img, img.width(), img.height())?)
    }
}

/// Called when the clipboard sequence number moved.
pub fn changed() {
    unsafe {
        let private = has(RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"))) || has(RegisterClipboardFormatW(w!("Clipboard Viewer Ignore")));
        if private || sys::now_ms() < QUIET_UNTIL.load(SeqCst) {
            return; // password managers / our own copies
        }
    }
    let (keep, preview) = (settings::flag("clipHistory"), settings::flag("copyPreview"));
    let (text, image, files);
    {
        let Some(_c) = Clipboard::open() else { return };
        text = if has(CF_UNICODETEXT) {
            unsafe { get_bytes(CF_UNICODETEXT) }.map(|b| sys::from_wide(&b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect::<Vec<_>>())).unwrap_or_default()
        } else {
            String::new()
        };
        image = if text.trim().is_empty() && keep && (has(CF_DIB) || has(png_format())) { read_image() } else { None };
        files = if has(CF_HDROP) { unsafe { GetClipboardData(CF_HDROP).map(|h| DragQueryFileW(HDROP(h.0), u32::MAX, None)).unwrap_or(0) } } else { 0 };
    }
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let msg = if !flat.is_empty() {
        let chars = flat.chars().count();
        let short: String = if chars > 90 { flat.chars().take(90).collect::<String>() + "…" } else { flat.clone() };
        json!({ "kind": "text", "preview": short, "chars": chars, "text": if chars <= 300 { flat.clone() } else { String::new() } })
    } else if image.is_some() || has(CF_DIB) {
        json!({ "kind": "image", "preview": "", "chars": 0 })
    } else if files > 0 {
        json!({ "kind": "files", "preview": "", "chars": 0 })
    } else if unsafe { CountClipboardFormats() } == 0 {
        return; // the clipboard was emptied
    } else {
        json!({ "kind": "other", "preview": "", "chars": 0 })
    };
    if keep {
        if !text.trim().is_empty() && text.len() <= CLIP_MAX_CHARS {
            add(Body::Text(text));
        } else if let Some(img) = image {
            add(img);
        }
    }
    if preview {
        sys::emit("clip", msg);
    }
}

// ---------------------------------------------------------------- history
fn same(a: &Body, b: &Body) -> bool {
    match (a, b) {
        (Body::Text(x), Body::Text(y)) => x == y,
        (Body::Image { hash: x, .. }, Body::Image { hash: y, .. }) => x == y,
        _ => false,
    }
}
fn sort(st: &mut State) {
    st.clips.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.at.cmp(&a.at)));
}
fn payload(st: &State) -> Value {
    Value::Array(
        st.clips
            .iter()
            .map(|c| match &c.body {
                Body::Text(t) => {
                    let flat = t.chars().take(400).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
                    json!({ "id": c.id, "kind": "text", "preview": flat, "len": t.chars().count(), "pinned": c.pinned })
                }
                Body::Image { w, h, thumb, .. } => json!({ "id": c.id, "kind": "image", "preview": format!("{w} × {h}"), "len": 0, "pinned": c.pinned, "thumb": thumb }),
            })
            .collect(),
    )
}
fn file() -> PathBuf {
    sys::data_dir().join("clips.json")
}
fn img_dir() -> PathBuf {
    sys::data_dir().join("clips")
}
/// Only pinned entries are written to disk; the rest live in memory and are gone when the app closes.
fn save(st: &State) {
    let _ = std::fs::create_dir_all(img_dir());
    let mut keep = Vec::new();
    let list: Vec<Value> = st
        .clips
        .iter()
        .filter(|c| c.pinned)
        .map(|c| match &c.body {
            Body::Text(t) => Value::String(t.clone()),
            Body::Image { png, hash, .. } => {
                let name = format!("{hash:016x}.png");
                let p = img_dir().join(&name);
                if !p.exists() {
                    let _ = std::fs::write(&p, png);
                }
                keep.push(name.clone());
                json!({ "image": name })
            }
        })
        .collect();
    let _ = std::fs::write(file(), serde_json::to_string(&list).unwrap_or_default());
    if let Ok(rd) = std::fs::read_dir(img_dir()) {
        for e in rd.flatten() {
            if !keep.contains(&e.file_name().to_string_lossy().to_string()) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}
fn changed_state(st: &mut State, pins: bool) {
    sort(st);
    if pins {
        save(st);
    }
    sys::emit("clips", payload(st));
}
fn add(body: Body) {
    let mut st = STATE.lock().unwrap();
    let now = sys::now_ms();
    if let Some(hit) = st.clips.iter_mut().find(|c| same(&c.body, &body)) {
        hit.at = now;
    } else {
        st.seq += 1;
        let id = st.seq;
        st.clips.push(Clip { id, body, pinned: false, at: now });
    }
    sort(&mut st);
    // the oldest loose entries make room: 30 in all, and at most 10 pictures (they are the heavy ones)
    let mut loose = 0;
    let mut pics = 0;
    st.clips.retain(|c| {
        if c.pinned {
            return true;
        }
        loose += 1;
        if matches!(c.body, Body::Image { .. }) {
            pics += 1;
            if pics > IMG_MAX {
                return false;
            }
        }
        loose <= CLIP_MAX
    });
    changed_state(&mut st, false);
}

pub fn load() {
    let mut st = STATE.lock().unwrap();
    let Ok(text) = std::fs::read_to_string(file()) else { return };
    let Ok(Value::Array(list)) = serde_json::from_str::<Value>(&text) else { return };
    let now = sys::now_ms();
    for (i, v) in list.into_iter().enumerate() {
        let body = match &v {
            Value::String(t) if !t.is_empty() => Some(Body::Text(t.clone())),
            Value::Object(o) => o.get("image").and_then(|n| n.as_str()).and_then(|n| std::fs::read(img_dir().join(n)).ok()).and_then(make_image),
            _ => None,
        };
        if let Some(body) = body {
            st.seq += 1;
            let id = st.seq;
            st.clips.push(Clip { id, body, pinned: true, at: now - i as u64 });
        }
    }
}
pub fn list() -> Value {
    payload(&STATE.lock().unwrap())
}
pub fn copy(id: u64) -> bool {
    let mut st = STATE.lock().unwrap();
    let Some(c) = st.clips.iter_mut().find(|c| c.id == id) else { return false };
    c.at = sys::now_ms();
    let ok = match &c.body {
        Body::Text(t) => write_text(t),
        Body::Image { png, .. } => write_image(png),
    };
    changed_state(&mut st, false);
    ok
}
pub fn pin(id: u64) {
    let mut st = STATE.lock().unwrap();
    if let Some(c) = st.clips.iter_mut().find(|c| c.id == id) {
        c.pinned = !c.pinned;
        changed_state(&mut st, true);
    }
}
pub fn remove(id: u64) {
    let mut st = STATE.lock().unwrap();
    let n = st.clips.len();
    st.clips.retain(|c| c.id != id);
    if st.clips.len() != n {
        changed_state(&mut st, true);
    }
}
pub fn clear() {
    let mut st = STATE.lock().unwrap();
    st.clips.retain(|c| c.pinned); // pins stay
    changed_state(&mut st, false);
}
