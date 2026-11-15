// The file shelf (files parked on the pill, dragged out again later) and the "download finished" watcher.
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering::SeqCst;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2};
use webview2_com::WebMessageReceivedEventHandler;
use windows::core::{Interface, HSTRING, PWSTR};
use windows::Win32::Foundation::*;
use windows::Win32::Storage::FileSystem::*;
use windows::Win32::System::Com::Urlmon::URLDownloadToFileW;
use windows::Win32::System::Com::{IBindCtx, IDataObject};
use windows::Win32::System::Ole::{IDropSource, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::*;

use crate::{hit, settings, sys};

struct Item {
    path: String,
    name: String,
    icon: Option<String>,
}
static SHELF: Mutex<Vec<Item>> = Mutex::new(Vec::new());
const MAX_BYTES: u64 = 200 * 1024 * 1024;

fn payload(list: &[Item]) -> Value {
    Value::Array(list.iter().map(|f| json!({ "path": f.path, "name": f.name, "icon": f.icon })).collect())
}
pub fn list() -> Value {
    prune();
    payload(&SHELF.lock().unwrap())
}
/// Files that were moved or deleted since they were parked are dropped from the shelf.
pub fn prune() {
    let mut s = SHELF.lock().unwrap();
    let n = s.len();
    s.retain(|f| Path::new(&f.path).exists());
    if s.len() != n {
        sys::emit("shelf", payload(&s));
    }
}
fn put(path: &str) -> bool {
    if path.is_empty() || !Path::new(path).exists() {
        return false;
    }
    let icon = sys::file_icon_b64(path);
    let mut s = SHELF.lock().unwrap();
    if s.iter().any(|f| f.path.eq_ignore_ascii_case(path)) {
        return false;
    }
    let name = Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string());
    s.push(Item { path: path.to_string(), name, icon });
    if s.len() > 40 {
        s.remove(0);
    }
    true
}
pub fn add(paths: Vec<String>) -> Value {
    for p in paths {
        // what the browser engine hands over for something dragged out of an app is its own temporary copy:
        // keep a copy of our own, because that one disappears
        let temp = std::env::temp_dir().to_string_lossy().to_lowercase();
        if p.to_lowercase().starts_with(&temp) && !p.to_lowercase().starts_with(&sys::temp_dir().to_string_lossy().to_lowercase()) {
            let name = Path::new(&p).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let dest = temp_path(&name, "");
            if std::fs::copy(&p, &dest).is_ok() {
                put(&dest.to_string_lossy());
                continue;
            }
        }
        put(&p);
    }
    payload(&SHELF.lock().unwrap())
}

// Things dragged out of an app (a picture from a chat, an image on a web page) are not files on disk yet.
// They are written to a private temp folder first, and that copy goes on the shelf.
fn ext_for(mime: &str) -> &'static str {
    match mime {
        "image/png" => ".png",
        "image/jpeg" => ".jpg",
        "image/gif" => ".gif",
        "image/webp" => ".webp",
        "image/bmp" => ".bmp",
        "image/svg+xml" => ".svg",
        "image/avif" => ".avif",
        _ => "",
    }
}
fn temp_path(name: &str, mime: &str) -> PathBuf {
    let dir = sys::temp_dir();
    let _ = std::fs::create_dir_all(&dir);
    let mut base: String = name.chars().map(|c| if "<>:\"/\\|?*".contains(c) || (c as u32) < 32 { '_' } else { c }).collect();
    base = base.trim_start_matches('.').trim().chars().take(120).collect();
    if base.is_empty() {
        base = "dropped".into();
    }
    if Path::new(&base).extension().is_none() {
        base.push_str(ext_for(mime));
    }
    let p = Path::new(&base);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let mut out = dir.join(&base);
    let mut i = 2;
    while out.exists() {
        out = dir.join(format!("{stem} ({i}){ext}"));
        i += 1;
    }
    out
}
pub fn add_data(name: &str, mime: &str, data: &[u8]) -> Value {
    if !data.is_empty() && (data.len() as u64) <= MAX_BYTES {
        let p = temp_path(name, mime);
        if std::fs::write(&p, data).is_ok() {
            put(&p.to_string_lossy());
        }
    }
    payload(&SHELF.lock().unwrap())
}
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
fn sniff_image(head: &[u8]) -> &'static str {
    if head.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if head.starts_with(b"GIF8") {
        "image/gif"
    } else if head.len() > 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        "image/webp"
    } else if head.starts_with(b"BM") {
        "image/bmp"
    } else if head.len() > 12 && &head[4..8] == b"ftyp" && (&head[8..12] == b"avif" || &head[8..12] == b"avis") {
        "image/avif"
    } else if head.starts_with(b"<svg") || head.starts_with(b"<?xml") {
        "image/svg+xml"
    } else {
        ""
    }
}
pub fn add_url(url: &str) -> Value {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("file:") {
        let p = percent_decode(url[5..].trim_start_matches('/')).replace('/', "\\");
        put(&p);
    } else if lower.starts_with("data:image/") {
        if let Some((head, body)) = url.split_once(',') {
            let mime = head[5..].split(';').next().unwrap_or("").to_ascii_lowercase();
            let bytes = if head.ends_with(";base64") { sys::unb64(body) } else { Some(percent_decode(body).into_bytes()) };
            if let Some(bytes) = bytes {
                return add_data("image", &mime, &bytes);
            }
        }
    } else if lower.starts_with("http://") || lower.starts_with("https://") {
        // a picture dragged from a web page: fetch that one image
        let name = url.split(['?', '#']).next().unwrap_or("").rsplit('/').next().map(percent_decode).filter(|n| !n.is_empty()).unwrap_or_else(|| "image".into());
        let dest = temp_path(&name, "");
        sys::com_init();
        let ok = unsafe { URLDownloadToFileW(None, &HSTRING::from(url), &HSTRING::from(dest.as_os_str()), 0, None) }.is_ok();
        let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        let mut head = [0u8; 16];
        let got = std::fs::File::open(&dest).and_then(|mut f| std::io::Read::read(&mut f, &mut head)).unwrap_or(0);
        let mime = sniff_image(&head[..got]);
        if ok && size > 0 && size <= MAX_BYTES && !mime.is_empty() {
            let mut fin = dest.clone();
            if dest.extension().is_none() {
                fin = temp_path(&name, mime);
                let _ = std::fs::rename(&dest, &fin);
            }
            put(&fin.to_string_lossy());
        } else {
            let _ = std::fs::remove_file(&dest); // unreachable, or not a picture
        }
    }
    payload(&SHELF.lock().unwrap())
}
pub fn remove(path: &str) {
    let mut s = SHELF.lock().unwrap();
    s.retain(|f| f.path != path);
    sys::emit("shelf", payload(&s));
}
pub fn clear() {
    let mut s = SHELF.lock().unwrap();
    s.clear();
    sys::emit("shelf", payload(&s));
}
pub fn reveal(path: &str) {
    if SHELF.lock().unwrap().iter().any(|f| f.path == path) && Path::new(path).exists() {
        sys::reveal_in_folder(path);
    }
}

/// Runs a real Explorer-style drag with the given shelf files. Blocks until the files are dropped (or the drag
/// is cancelled), so it must be called on the main thread; nothing touches the window's styles meanwhile.
pub fn drag(paths: Vec<String>) {
    let items: Vec<String> = SHELF.lock().unwrap().iter().filter(|f| paths.contains(&f.path) && Path::new(&f.path).exists()).map(|f| f.path.clone()).collect();
    if items.is_empty() {
        prune();
        return;
    }
    hit::DRAGGING.store(true, SeqCst);
    sys::emit("shelf-dragging", true);
    unsafe {
        let mut pidls: Vec<*mut ITEMIDLIST> = Vec::new();
        for p in &items {
            let mut pidl = std::ptr::null_mut();
            if SHParseDisplayName(&HSTRING::from(p.as_str()), None::<&IBindCtx>, &mut pidl, 0, None).is_ok() && !pidl.is_null() {
                pidls.push(pidl);
            }
        }
        let consts: Vec<*const ITEMIDLIST> = pidls.iter().map(|p| *p as *const ITEMIDLIST).collect();
        let res = (|| -> windows::core::Result<()> {
            let arr = SHCreateShellItemArrayFromIDLists(&consts)?;
            let data: IDataObject = arr.BindToHandler(None::<&IBindCtx>, &BHID_DataObject)?;
            SHDoDragDrop(None, &data, None::<&IDropSource>, DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK)?;
            Ok(())
        })();
        if let Err(e) = res {
            sys::log(&format!("drag out failed: {e}"));
        }
        for p in pidls {
            ILFree(Some(p as *const ITEMIDLIST));
        }
    }
    hit::DRAGGING.store(false, SeqCst);
    sys::emit("shelf-dragging", false);
    // moved files are gone from their old place: drop them from the shelf
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(800));
        prune();
        std::thread::sleep(Duration::from_millis(3200));
        prune();
    });
}

/// Files dropped on the page arrive there without their paths. The page hands the file objects back through
/// WebView2 ("additional objects"), and here they turn into real paths again.
pub fn hook_webview(win: &tauri::WebviewWindow) {
    let _ = win.with_webview(|wv| unsafe {
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let handler = WebMessageReceivedEventHandler::create(Box::new(|_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut msg = PWSTR::null();
            if args.TryGetWebMessageAsString(&mut msg).is_err() {
                return Ok(());
            }
            let text = sys::pwstr_take(msg);
            let Some(token) = text.strip_prefix("island-drop:") else { return Ok(()) };
            let mut paths: Vec<String> = Vec::new();
            if let Ok(objs) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>().and_then(|a| a.AdditionalObjects()) {
                let mut n = 0u32;
                let _ = objs.Count(&mut n);
                for i in 0..n {
                    let mut path = String::new();
                    if let Ok(file) = objs.GetValueAtIndex(i).and_then(|u| u.cast::<ICoreWebView2File>()) {
                        let mut p = PWSTR::null();
                        if file.Path(&mut p).is_ok() {
                            path = sys::pwstr_take(p);
                        }
                    }
                    paths.push(path);
                }
            }
            sys::emit("drop-paths", json!({ "token": token, "paths": paths }));
            Ok(())
        }));
        let mut token = Default::default();
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    });
}

// ---------------------------------------------------------------- downloads
// A browser download is a temporary file (.crdownload, .part, â€¦) that gets renamed when it completes.
const TEMP_EXT: [&str; 10] = ["crdownload", "part", "partial", "download", "opdownload", "fdmdownload", "!ut", "aria2", "td", "tmp"];
const RISKY_EXT: [&str; 16] = ["exe", "msi", "msix", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "jse", "wsf", "lnk", "reg", "hta", "jar"];
static FINISHED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn ext_in(name: &str, list: &[&str]) -> bool {
    name.rsplit_once('.').is_some_and(|(_, e)| list.contains(&e.to_ascii_lowercase().as_str()))
}
fn fmt_size(n: u64) -> String {
    let f = n as f64;
    if n >= 1 << 30 {
        format!("{:.1} GB", f / (1u64 << 30) as f64)
    } else if n >= 1 << 20 {
        format!("{:.1} MB", f / (1u64 << 20) as f64)
    } else {
        format!("{} KB", ((f / 1024.0).round() as u64).max(1))
    }
}
pub fn start_downloads() {
    std::thread::spawn(|| unsafe {
        let Ok(p) = SHGetKnownFolderPath(&FOLDERID_Downloads, KNOWN_FOLDER_FLAG(0), None) else { return };
        let dir = PathBuf::from(sys::pwstr_take(p));
        let Ok(h) = CreateFileW(&HSTRING::from(dir.as_os_str()), FILE_LIST_DIRECTORY.0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, None, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, None) else { return };
        let mut buf = vec![0u32; 16 * 1024];
        let mut temp_at: HashMap<PathBuf, Instant> = HashMap::new();
        let mut recent: HashMap<PathBuf, Instant> = HashMap::new();
        loop {
            let mut got = 0u32;
            let filter = FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_SIZE;
            if ReadDirectoryChangesW(h, buf.as_mut_ptr() as *mut c_void, (buf.len() * 4) as u32, true, filter, Some(&mut got), None, None).is_err() {
                std::thread::sleep(Duration::from_secs(5));
                continue;
            }
            let base = buf.as_ptr() as *const u8;
            let mut off = 0usize;
            while got > 0 {
                let info = &*(base.add(off) as *const FILE_NOTIFY_INFORMATION);
                let name = String::from_utf16_lossy(std::slice::from_raw_parts(info.FileName.as_ptr(), info.FileNameLength as usize / 2));
                let full = dir.join(&name);
                let folder = full.parent().map(|p| p.to_path_buf()).unwrap_or_default();
                if ext_in(&name, &TEMP_EXT) {
                    temp_at.insert(folder, Instant::now());
                } else if info.Action != FILE_ACTION_MODIFIED
                    && settings::flag("downloadAlerts")
                    && temp_at.get(&folder).is_some_and(|t| t.elapsed() < Duration::from_secs(4))
                    && !recent.get(&full).is_some_and(|t| t.elapsed() < Duration::from_secs(15))
                {
                    recent.insert(full.clone(), Instant::now());
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(900));
                        let Ok(meta) = std::fs::metadata(&full) else { return };
                        if !meta.is_file() || meta.len() == 0 {
                            return; // a placeholder, not the finished file
                        }
                        let path = full.to_string_lossy().to_string();
                        FINISHED.lock().unwrap().get_or_insert_with(HashSet::new).insert(path.clone());
                        let name = full.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                        sys::emit("download", json!({ "path": path, "name": name, "size": fmt_size(meta.len()), "icon": sys::file_icon_b64(&path), "risky": ext_in(&name, &RISKY_EXT) }));
                    });
                }
                if info.NextEntryOffset == 0 {
                    break;
                }
                off += info.NextEntryOffset as usize;
            }
            recent.retain(|_, t| t.elapsed() < Duration::from_secs(60));
        }
    });
}
pub fn open_download(path: &str) {
    let known = FINISHED.lock().unwrap().as_ref().is_some_and(|s| s.contains(path));
    if !known || !Path::new(path).exists() {
        return; // only files this watcher announced
    }
    if ext_in(path, &RISKY_EXT) { sys::reveal_in_folder(path) } else { sys::shell_open(path, None) }
}
