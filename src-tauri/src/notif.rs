// Windows notifications: read them from the notification center, dismiss them, and "click" them the way
// Windows itself would (so a Telegram notification opens that exact chat).
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::path::Path;
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::json;
use windows::core::{w, Interface, GUID, HSTRING, PCSTR};
use windows::Foundation::Size;
use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus};
use windows::UI::Notifications::{KnownNotificationBindings, NotificationBinding, NotificationKinds, UserNotification};
use windows::Win32::Foundation::*;
use windows::Win32::System::Com::StructuredStorage::{PropVariantToGUID, PropVariantToStringAlloc};
use windows::Win32::System::Com::*;
use windows::Win32::System::Diagnostics::ToolHelp::*;
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::Win32::System::Registry::*;
use windows::Win32::UI::Notifications::INotificationActivationCallback;
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
use windows::Win32::UI::WindowsAndMessaging::*;

use crate::media::{read_stream, wait};
use crate::sys;

pub struct Notifs {
    listener: Option<UserNotificationListener>,
    ok: bool,
    seen: HashSet<u32>,
    first: bool,
    icons: HashMap<String, Option<String>>,
    tg_seen: HashSet<isize>,
    tg_first: bool,
    tg_icon: Option<Option<String>>,
}

fn texts_of(b: &NotificationBinding) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(list) = b.GetTextElements() {
        for i in 0..list.Size().unwrap_or(0) {
            if let Ok(t) = list.GetAt(i).and_then(|e| e.Text()) {
                out.push(t.to_string());
            }
        }
    }
    out
}

impl Notifs {
    pub fn new() -> Self {
        let listener = UserNotificationListener::Current().ok();
        let status = listener.as_ref().and_then(|l| wait(l.RequestAccessAsync(), 6000));
        let ok = status == Some(UserNotificationListenerAccessStatus::Allowed);
        if !ok {
            sys::log(&format!("notification access not granted: {:?}", status.map(|s| s.0)));
        }
        Self { listener, ok, seen: HashSet::new(), first: true, icons: HashMap::new(), tg_seen: HashSet::new(), tg_first: true, tg_icon: None }
    }

    pub fn poll(&mut self) {
        if !self.ok {
            return;
        }
        let Some(listener) = self.listener.clone() else { return };
        let Some(list) = wait(listener.GetNotificationsAsync(NotificationKinds::Toast), 4000) else { return };
        let mut current = HashSet::new();
        for i in 0..list.Size().unwrap_or(0) {
            let Ok(n) = list.GetAt(i) else { continue };
            let Ok(id) = n.Id() else { continue };
            current.insert(id);
            if self.seen.contains(&id) {
                continue;
            }
            self.announce(&n, id);
        }
        // anything that left the Windows notification center (opened or dismissed elsewhere) leaves our list too
        for gone in self.seen.difference(&current) {
            sys::helper(json!({ "t": "notifGone", "id": gone.to_string() }));
        }
        self.seen = current;
        self.first = false;
    }

    fn announce(&mut self, n: &UserNotification, id: u32) {
        let ts = n.CreationTime().map(|d| (d.UniversalTime - 116_444_736_000_000_000) / 10_000).unwrap_or(0).max(0);
        let info = n.AppInfo().ok();
        let display = info.as_ref().and_then(|a| a.DisplayInfo().ok());
        let app = display.as_ref().and_then(|d| d.DisplayName().ok()).map(|s| s.to_string()).unwrap_or_default();
        let aumid = info.as_ref().and_then(|a| a.AppUserModelId().ok()).map(|s| s.to_string()).unwrap_or_default();
        let mut texts = Vec::new();
        if let Ok(visual) = n.Notification().and_then(|x| x.Visual()) {
            if let Ok(b) = KnownNotificationBindings::ToastGeneric().and_then(|name| visual.GetBinding(&name)) {
                texts = texts_of(&b);
            }
            if texts.is_empty() {
                // legacy toast templates (some desktop apps) are not exposed as ToastGeneric
                if let Ok(all) = visual.Bindings() {
                    for i in 0..all.Size().unwrap_or(0) {
                        if let Ok(b) = all.GetAt(i) {
                            texts = texts_of(&b);
                            if !texts.is_empty() {
                                break;
                            }
                        }
                    }
                }
            }
        }
        let title = texts.first().cloned().unwrap_or_default();
        let body = if texts.len() > 1 { texts[1..].join(" ") } else { String::new() };
        let mut icon = None;
        if !app.is_empty() {
            if let Some(cached) = self.icons.get(&app) {
                icon = cached.clone();
            } else {
                icon = display
                    .as_ref()
                    .and_then(|d| d.GetLogo(Size { Width: 48.0, Height: 48.0 }).ok())
                    .and_then(|logo| read_stream(logo.OpenReadAsync()))
                    .map(|b| sys::b64(&b));
                if icon.is_none() && app.contains("Telegram") {
                    icon = self.telegram_icon();
                }
                self.icons.insert(app.clone(), icon.clone());
            }
        }
        // old = it was already in the notification center when we started: list it, don't pop it up
        sys::helper(json!({ "t": "notif", "id": id.to_string(), "aumid": aumid, "app": app, "title": title, "body": body, "icon": icon, "ts": ts, "old": self.first }));
    }

    pub fn dismiss(&self, id: u32) {
        if let Some(l) = &self.listener {
            let _ = l.RemoveNotification(id);
        }
    }
    pub fn clear_all(&mut self) {
        if let Some(l) = &self.listener {
            for id in &self.seen {
                let _ = l.RemoveNotification(*id);
            }
        }
    }

    // ---- Telegram's own popups (when "Use Windows notifications" is off they never reach Windows):
    // small, topmost, frameless tool windows near a screen edge.
    fn telegram_icon(&mut self) -> Option<String> {
        if self.tg_icon.is_none() {
            let icon = processes_named("telegram.exe").first().and_then(|pid| sys::exe_of_pid(*pid)).and_then(|exe| sys::file_icon_b64(&exe));
            self.tg_icon = Some(icon);
        }
        self.tg_icon.clone().flatten()
    }
    pub fn poll_telegram(&mut self) {
        let pids = processes_named("telegram.exe");
        if pids.is_empty() {
            self.tg_seen.clear();
            return;
        }
        let mut current = HashSet::new();
        for (h, r) in topmost_tool_windows(&pids) {
            let (w, hgt) = (r.right - r.left, r.bottom - r.top);
            if !(220..=560).contains(&w) || !(48..=190).contains(&hgt) {
                continue; // popup-sized only
            }
            let mut mi = windows::Win32::Graphics::Gdi::MONITORINFO { cbSize: std::mem::size_of::<windows::Win32::Graphics::Gdi::MONITORINFO>() as u32, ..Default::default() };
            let mon = unsafe { windows::Win32::Graphics::Gdi::MonitorFromWindow(h, windows::Win32::Graphics::Gdi::MONITOR_DEFAULTTONEAREST) };
            if !unsafe { windows::Win32::Graphics::Gdi::GetMonitorInfoW(mon, &mut mi) }.as_bool() {
                continue;
            }
            let b = mi.rcMonitor;
            if r.left - b.left >= 80 && b.right - r.right >= 80 {
                continue; // not near a screen edge
            }
            current.insert(h.0 as isize);
            if !self.tg_seen.contains(&(h.0 as isize)) && !self.tg_first {
                let icon = self.telegram_icon();
                sys::helper(json!({ "t": "notif", "id": format!("tg{}", h.0 as isize), "aumid": "Telegram.TelegramDesktop", "app": "Telegram", "title": "New message", "body": "", "icon": icon }));
            }
        }
        self.tg_seen = current;
        self.tg_first = false;
    }

    /// A click on a notification. Windows keeps each toast's XML (with its "launch" arguments) in the per-user
    /// notification database and hands those arguments to the app's toast activator; we do the same.
    pub fn activate(&self, id: &str, aumid: &str) {
        let numeric = !id.is_empty() && id.chars().all(|c| c.is_ascii_digit());
        let (mut launch, mut kind) = (String::new(), String::new());
        if numeric {
            if let Some(xml) = id.parse::<i64>().ok().and_then(toast_payload) {
                launch = xml_attr(&xml, "launch");
                kind = xml_attr(&xml, "activationType");
            }
        }
        let mut how = "none";
        let scheme = launch.split(':').next().unwrap_or("");
        let is_protocol = kind == "protocol"
            && launch.contains(':')
            && scheme.len() > 1
            && scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
            && scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
            && !scheme.eq_ignore_ascii_case("file");
        if is_protocol {
            sys::allow_foreground();
            sys::shell_open(&launch, None);
            how = "protocol";
        } else {
            // without the stored launch arguments there is nothing exact to activate: just bring the app forward
            if numeric && !aumid.is_empty() {
                if let Some(clsid) = activator_clsid(aumid) {
                    how = match com_activate(clsid, aumid.to_string(), launch.clone()) {
                        1 => "activator",
                        2 => "activator-pending",
                        _ => "none",
                    };
                }
            }
            if how == "none" && !aumid.is_empty() {
                sys::allow_foreground();
                sys::shell_open("explorer.exe", Some(&format!("shell:AppsFolder\\{aumid}")));
                how = "app";
            }
        }
        // like a real click, the notification leaves the notification center
        if how != "none" && numeric {
            if let Ok(n) = id.parse::<u32>() {
                self.dismiss(n);
            }
        }
        sys::helper(json!({ "t": "activated", "id": id, "how": how }));
    }
}

// ---------------------------------------------------------------- processes and windows
pub fn processes_named(name_lower: &str) -> Vec<u32> {
    let mut out = Vec::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                if sys::from_wide(&e.szExeFile).to_ascii_lowercase() == name_lower {
                    out.push(e.th32ProcessID);
                }
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    out
}

fn topmost_tool_windows(pids: &[u32]) -> Vec<(HWND, RECT)> {
    struct Ctx<'a> {
        pids: &'a [u32],
        out: Vec<(HWND, RECT)>,
    }
    unsafe extern "system" fn each(h: HWND, l: LPARAM) -> windows::core::BOOL {
        let ctx = &mut *(l.0 as *mut Ctx);
        if ctx.pids.contains(&sys::pid_of(h)) && IsWindowVisible(h).as_bool() {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            if ex & WS_EX_TOPMOST.0 != 0 && ex & WS_EX_TOOLWINDOW.0 != 0 {
                ctx.out.push((h, sys::rect_of(h)));
            }
        }
        true.into()
    }
    let mut ctx = Ctx { pids, out: Vec::new() };
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut ctx as *mut Ctx as isize));
    }
    ctx.out
}

// ---------------------------------------------------------------- the stored toast (read-only, through the system's own sqlite)
fn toast_payload(id: i64) -> Option<String> {
    type Open = unsafe extern "system" fn(*const u8, *mut *mut c_void, i32, *const c_void) -> i32;
    type Close = unsafe extern "system" fn(*mut c_void) -> i32;
    type Prepare = unsafe extern "system" fn(*mut c_void, *const u8, i32, *mut *mut c_void, *mut c_void) -> i32;
    type Step = unsafe extern "system" fn(*mut c_void) -> i32;
    type Blob = unsafe extern "system" fn(*mut c_void, i32) -> *const u8;
    type Bytes = unsafe extern "system" fn(*mut c_void, i32) -> i32;
    unsafe {
        let lib = LoadLibraryW(w!("winsqlite3.dll")).ok()?;
        macro_rules! sym {
            ($name:literal, $t:ty) => {
                std::mem::transmute::<_, $t>(GetProcAddress(lib, PCSTR(concat!($name, "\0").as_ptr()))?)
            };
        }
        let open: Open = sym!("sqlite3_open_v2", Open);
        let close: Close = sym!("sqlite3_close", Close);
        let prepare: Prepare = sym!("sqlite3_prepare_v2", Prepare);
        let step: Step = sym!("sqlite3_step", Step);
        let finalize: Close = sym!("sqlite3_finalize", Close);
        let blob: Blob = sym!("sqlite3_column_blob", Blob);
        let bytes: Bytes = sym!("sqlite3_column_bytes", Bytes);

        let file = format!("{}\\Microsoft\\Windows\\Notifications\\wpndatabase.db\0", std::env::var("LOCALAPPDATA").ok()?);
        let mut db = std::ptr::null_mut();
        if open(file.as_ptr(), &mut db, 1, std::ptr::null()) != 0 {
            close(db);
            return None;
        }
        let sql = format!("select Payload from Notification where Id={id}\0");
        let mut st = std::ptr::null_mut();
        let mut res = None;
        if prepare(db, sql.as_ptr(), -1, &mut st, std::ptr::null_mut()) == 0 {
            if step(st) == 100 {
                let (p, n) = (blob(st, 0), bytes(st, 0));
                if !p.is_null() && n > 0 {
                    res = Some(String::from_utf8_lossy(std::slice::from_raw_parts(p, n as usize)).into_owned());
                }
            }
            finalize(st);
        }
        close(db);
        res
    }
}

/// One attribute of the root <toast …> element.
fn xml_attr(xml: &str, name: &str) -> String {
    let Some(start) = xml.find("<toast") else { return String::new() };
    let tag = &xml[start..];
    let bytes = tag.as_bytes();
    let (mut i, mut quote, mut end) = (0, 0u8, tag.len());
    while i < bytes.len() {
        let c = bytes[i];
        if quote != 0 {
            if c == quote { quote = 0 }
        } else if c == b'"' || c == b'\'' {
            quote = c
        } else if c == b'>' {
            end = i;
            break;
        }
        i += 1;
    }
    let tag = &tag[..end];
    let mut from = 0;
    while let Some(p) = tag[from..].find(name) {
        let at = from + p;
        let before_ok = at > 0 && tag.as_bytes()[at - 1].is_ascii_whitespace();
        let rest = tag[at + name.len()..].trim_start();
        if before_ok && rest.starts_with('=') {
            let v = rest[1..].trim_start();
            if let Some(q) = v.chars().next().filter(|c| *c == '"' || *c == '\'') {
                if let Some(close) = v[1..].find(q) {
                    return unescape(&v[1..1 + close]);
                }
            }
        }
        from = at + name.len();
    }
    String::new()
}
fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(p) = rest.find('&') {
        out.push_str(&rest[..p]);
        rest = &rest[p..];
        let Some(semi) = rest.find(';').filter(|n| *n <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..semi];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

// ---------------------------------------------------------------- AUMID -> toast activator
// Registered either in the registry or on the app's Start-menu shortcut. The shortcut scan takes a moment,
// so it runs once on its own thread.
static SHORTCUTS: OnceLock<HashMap<String, GUID>> = OnceLock::new();
const FMTID_APPUSERMODEL: GUID = GUID::from_u128(0x9F4C2855_9F79_4B39_A8D0_E1D42DE1D5F3);

pub fn scan_shortcuts() {
    std::thread::spawn(|| {
        sys::com_init();
        let mut map = HashMap::new();
        let roots = [
            std::env::var("APPDATA").map(|p| format!("{p}\\Microsoft\\Windows\\Start Menu\\Programs")),
            std::env::var("ProgramData").map(|p| format!("{p}\\Microsoft\\Windows\\Start Menu\\Programs")),
        ];
        for root in roots.into_iter().flatten() {
            walk_links(Path::new(&root), 0, &mut map);
        }
        let _ = SHORTCUTS.set(map);
    });
}
fn walk_links(dir: &Path, depth: u32, map: &mut HashMap<String, GUID>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth < 6 {
                walk_links(&p, depth + 1, map);
            }
        } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("lnk")) {
            if let Some((id, clsid)) = unsafe { read_link(&p) } {
                map.insert(id, clsid);
            }
        }
    }
}
unsafe fn read_link(path: &Path) -> Option<(String, GUID)> {
    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
    let file: IPersistFile = link.cast().ok()?;
    file.Load(&HSTRING::from(path.as_os_str()), STGM_READ).ok()?;
    let store: IPropertyStore = link.cast().ok()?;
    let key = |pid| PROPERTYKEY { fmtid: FMTID_APPUSERMODEL, pid };
    let clsid = PropVariantToGUID(&store.GetValue(&key(26)).ok()?).ok()?; // System.AppUserModel.ToastActivatorCLSID
    let id = sys::pwstr_take(PropVariantToStringAlloc(&store.GetValue(&key(5)).ok()?).ok()?); // System.AppUserModel.ID
    if id.is_empty() || clsid == GUID::zeroed() { None } else { Some((id, clsid)) }
}

fn reg_string(root: HKEY, key: &str, value: &str) -> Option<String> {
    unsafe {
        let mut buf = [0u16; 260];
        let mut n = (buf.len() * 2) as u32;
        let r = RegGetValueW(root, &HSTRING::from(key), &HSTRING::from(value), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as *mut c_void), Some(&mut n));
        if r == ERROR_SUCCESS { Some(sys::from_wide(&buf)) } else { None }
    }
}
fn parse_guid(text: &str) -> Option<GUID> {
    let hex: String = text.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 32 {
        return None;
    }
    u128::from_str_radix(&hex, 16).ok().map(GUID::from_u128)
}
fn activator_clsid(aumid: &str) -> Option<GUID> {
    let key = format!("Software\\Classes\\AppUserModelId\\{aumid}");
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        if let Some(g) = reg_string(root, &key, "CustomActivator").and_then(|v| parse_guid(&v)) {
            return Some(g);
        }
    }
    SHORTCUTS.get().and_then(|m| m.get(aumid).copied())
}

/// 1 = activated, 0 = failed, 2 = still starting the app's COM server (left running in the background).
/// Runs on its own thread so a slow or broken activator can never stall the polling loop.
fn com_activate(clsid: GUID, aumid: String, args: String) -> i32 {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        sys::com_init();
        let r = unsafe {
            (|| -> windows::core::Result<()> {
                let cb: INotificationActivationCallback = CoCreateInstance(&clsid, None, CLSCTX_LOCAL_SERVER | CLSCTX_INPROC_SERVER)?;
                sys::allow_foreground();
                cb.Activate(&HSTRING::from(aumid), &HSTRING::from(args), &[])
            })()
        };
        let _ = tx.send(r.is_ok());
    });
    match rx.recv_timeout(Duration::from_millis(2500)) {
        Ok(true) => 1,
        Ok(false) => 0,
        Err(_) => 2,
    }
}
