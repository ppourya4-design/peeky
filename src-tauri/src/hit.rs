// Mouse handling for a window that is click-through almost all the time.
//
// The page decides when it wants the mouse (cursor on the pill or on the list under it) and says so with
// `set_interactive`. Nothing here is edge-triggered: the wanted state is re-applied to the window 60 times a
// second until it sticks, the page repeats its wish twice a second, and a page that went silent loses the
// mouse — so one lost message can never leave the island unclickable (or blocking the app underneath).
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering::SeqCst};
use std::time::{Duration, Instant};

use serde_json::json;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::*;

use crate::sys;

pub const WIN_W: f64 = 700.0;
pub const WIN_H: f64 = 430.0;

pub static INTERACTIVE: AtomicBool = AtomicBool::new(false);
pub static TYPING: AtomicBool = AtomicBool::new(false); // a text field is open: the window may take the keyboard
pub static DRAGGING: AtomicBool = AtomicBool::new(false); // a shelf file is on its way out
static HEARTBEAT: AtomicU64 = AtomicU64::new(0);
static PREV_FG: AtomicIsize = AtomicIsize::new(0);
pub static OFFSET_Y: AtomicIsize = AtomicIsize::new(0); // debug runs sit lower, next to an installed copy

pub fn set_interactive(on: bool) {
    INTERACTIVE.store(on, SeqCst);
    HEARTBEAT.store(sys::now_ms(), SeqCst);
    if !DRAGGING.load(SeqCst) {
        unsafe { apply_style(sys::hwnd()) };
    }
}

/// Brings the wanted state onto the real window. Cheap when nothing changed.
unsafe fn apply_style(h: HWND) {
    if h.0.is_null() {
        return;
    }
    let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
    let through = WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0;
    let mut want = ex | WS_EX_TOOLWINDOW.0;
    if INTERACTIVE.load(SeqCst) { want &= !through } else { want |= through }
    if TYPING.load(SeqCst) { want &= !WS_EX_NOACTIVATE.0 } else { want |= WS_EX_NOACTIVATE.0 }
    if want != ex {
        SetWindowLongPtrW(h, GWL_EXSTYLE, want as isize);
        if want & WS_EX_LAYERED.0 != 0 && ex & WS_EX_LAYERED.0 == 0 {
            let _ = SetLayeredWindowAttributes(h, COLORREF(0), 255, LWA_ALPHA);
        }
    }
}

/// Set when the chosen display changed: the loop moves the island on its next turn instead of waiting for the timer.
pub static REPLACE: AtomicBool = AtomicBool::new(false);

/// One connected display.
pub struct Mon {
    pub id: String, // the device name Windows gives it (\\.\DISPLAY2): stable across restarts
    pub rect: RECT,
    pub primary: bool,
    pub dpi: u32,
}

unsafe extern "system" fn mon_cb(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> windows::core::BOOL {
    let list = &mut *(data.0 as *mut Vec<Mon>);
    let mut mi = MONITORINFOEXW::default();
    mi.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(m, &mut mi as *mut MONITORINFOEXW as *mut MONITORINFO).as_bool() {
        let n = mi.szDevice.iter().position(|&c| c == 0).unwrap_or(mi.szDevice.len());
        let (mut dx, mut dy) = (96u32, 96u32);
        let _ = GetDpiForMonitor(m, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
        list.push(Mon { id: String::from_utf16_lossy(&mi.szDevice[..n]), rect: mi.monitorInfo.rcMonitor, primary: mi.monitorInfo.dwFlags & 1 != 0, dpi: dx.max(96) });
    }
    true.into()
}

/// Every connected display, left to right.
pub fn monitors() -> Vec<Mon> {
    let mut list: Vec<Mon> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(mon_cb), LPARAM(&mut list as *mut Vec<Mon> as isize));
    }
    list.sort_by_key(|m| (m.rect.left, m.rect.top));
    list
}

/// The list the settings page shows: [{ id, label, primary }]. Numbers follow the ones in Windows' display settings.
pub fn monitors_json() -> serde_json::Value {
    let list = monitors();
    json!(list
        .iter()
        .map(|m| {
            let num: String = m.id.chars().filter(|c| c.is_ascii_digit()).collect();
            json!({ "id": m.id, "n": num, "w": m.rect.right - m.rect.left, "h": m.rect.bottom - m.rect.top, "primary": m.primary })
        })
        .collect::<Vec<_>>())
}

/// The display the user picked in the settings; the primary one when "primary" is chosen or the picked one is unplugged.
fn target() -> Option<Mon> {
    let want = crate::settings::get("monitor");
    let want = want.as_str().unwrap_or("primary");
    let mut list = monitors();
    let at = list.iter().position(|m| m.id == want).or_else(|| list.iter().position(|m| m.primary)).or(if list.is_empty() { None } else { Some(0) })?;
    Some(list.swap_remove(at))
}

/// The rectangle of the display the island is on (used to tell whether a full-screen app covers it).
pub fn island_rect() -> Option<RECT> {
    target().map(|m| m.rect)
}

/// The page is zoomed by the island-size setting (the window is made that much bigger or smaller in `place`), so the page
/// keeps its 700 x 430 layout and nothing inside it has to know. Only touched when the wanted zoom changed.
static ZOOM_SET: AtomicU64 = AtomicU64::new(0);
fn apply_zoom() {
    use tauri::Manager;
    let z = crate::settings::ui_scale();
    if ZOOM_SET.load(SeqCst) == z.to_bits() {
        return;
    }
    if let Some(w) = sys::APP.get().and_then(|a| a.get_webview_window("main")) {
        if w.set_zoom(z).is_ok() {
            ZOOM_SET.store(z.to_bits(), SeqCst);
        }
    }
}

/// Top centre of the chosen display, at the size the current scale asks for.
unsafe fn place(h: HWND) {
    apply_zoom();
    let (left, top, width, dpi) = match target() {
        Some(m) => (m.rect.left, m.rect.top, m.rect.right - m.rect.left, m.dpi),
        None => (0, 0, GetSystemMetrics(SM_CXSCREEN), GetDpiForWindow(h)),
    };
    let scale = dpi.max(96) as f64 / 96.0 * crate::settings::ui_scale();      // the screen's scaling times the island-size setting
    let (w, hgt) = ((WIN_W * scale).round() as i32, (WIN_H * scale).round() as i32);
    let x = left + (width - w) / 2;
    let y = top + OFFSET_Y.load(SeqCst) as i32;
    let r = sys::rect_of(h);
    if r.left != x || r.top != y || r.right - r.left != w || r.bottom - r.top != hgt {
        let _ = SetWindowPos(h, None, x, y, w, hgt, SWP_NOZORDER | SWP_NOACTIVATE);
    }
}

/// A text field opened or closed on the pill. While one is open the window is an ordinary focusable window.
pub fn set_typing(on: bool, restore: bool) -> serde_json::Value {
    let h = sys::hwnd();
    let mut ctx = json!({});
    unsafe {
        if on {
            let fg = GetForegroundWindow();
            if sys::root_of(fg) != h {
                PREV_FG.store(fg.0 as isize, SeqCst);
                // what the user was looking at: used to suggest a name when a password is saved
                let exe = sys::exe_of_pid(sys::pid_of(fg)).unwrap_or_default();
                ctx = json!({ "title": sys::title_of(fg), "exe": exe.rsplit('\\').next().unwrap_or("") });
            }
            TYPING.store(true, SeqCst);
            INTERACTIVE.store(true, SeqCst);
            HEARTBEAT.store(sys::now_ms(), SeqCst);
            apply_style(h);
            sys::force_foreground(h);
        } else if TYPING.swap(false, SeqCst) {
            apply_style(h);
            let prev = HWND(PREV_FG.swap(0, SeqCst) as *mut _);
            if restore && !prev.0.is_null() && IsWindow(Some(prev)).as_bool() && sys::root_of(GetForegroundWindow()) == h {
                let _ = SetForegroundWindow(prev);
            }
        }
    }
    ctx
}

pub fn start() {
    std::thread::spawn(|| unsafe {
        let h = sys::hwnd();
        let vk = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
        let (mut last, mut last_emit, mut was_near) = ((i32::MIN, i32::MIN), Instant::now(), false);
        let (mut down, mut ours, mut tick, mut said_at) = (false, false, 0u64, 0u64);
        place(h);
        loop {
            std::thread::sleep(Duration::from_millis(16));
            tick += 1;
            if !IsWindow(Some(h)).as_bool() {
                break;
            }
            let now = sys::now_ms();
            // a page that stopped talking must not keep the mouse
            if INTERACTIVE.load(SeqCst) && !TYPING.load(SeqCst) && now.saturating_sub(HEARTBEAT.load(SeqCst)) > 4000 {
                INTERACTIVE.store(false, SeqCst);
                sys::log("page silent for 4s while holding the mouse: released it");
            }
            if !DRAGGING.load(SeqCst) {
                apply_style(h);
                if tick % 300 == 0 {
                    let _ = SetWindowPos(h, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                }
                if tick % 120 == 0 || REPLACE.swap(false, SeqCst) {
                    place(h);
                }
            }

            let mut pt = POINT::default();
            if GetCursorPos(&mut pt).is_err() {
                continue;
            }
            let r = sys::rect_of(h);
            let scale = GetDpiForWindow(h).max(96) as f64 / 96.0 * crate::settings::ui_scale();      // the page is zoomed by the same amount, so its pixels are this big
            let (x, y) = ((pt.x - r.left) as f64 / scale, (pt.y - r.top) as f64 / scale);
            let near = x > -80.0 && x < WIN_W + 80.0 && y > -80.0 && y < WIN_H + 80.0;
            if (near || was_near) && (pt.x, pt.y) != last && last_emit.elapsed() >= Duration::from_millis(30) {
                last = (pt.x, pt.y);
                last_emit = Instant::now();
                sys::emit("cursor", json!({ "x": (x * 10.0).round() / 10.0, "y": (y * 10.0).round() / 10.0 }));
                was_near = near;
            }

            // The page is told about every press that lands on the island. If its own click event never shows up,
            // it performs the click itself — so a swallowed click still does what the user meant.
            let d = GetAsyncKeyState(vk.0 as i32) < 0;
            if d && !down && INTERACTIVE.load(SeqCst) && near {
                let hit = sys::root_of(WindowFromPoint(pt));
                if hit == h {
                    ours = true;
                    sys::emit("press", json!({ "x": x, "y": y }));
                } else if now.saturating_sub(said_at) > 30_000 {
                    said_at = now;
                    let exe = sys::exe_of_pid(sys::pid_of(hit)).unwrap_or_default();
                    sys::log(&format!("a press on the island went to another window: class={} title={:?} exe={}", sys::class_of(hit), sys::title_of(hit), exe));
                    let _ = SetWindowPos(h, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                }
            }
            if !d && down && ours {
                ours = false;
                sys::emit("release", json!({ "x": x, "y": y }));
            }
            down = d;
        }
    });
}

/// The two global shortcuts: quick note and text grab (Ctrl+Alt+N / Ctrl+Alt+T unless changed in Settings).
/// Registered on their own thread, switched with the setting, and re-registered when a shortcut is changed.
/// A shortcut another program already owns is reported to the page (NOTE_KEY_FAIL / OCR_KEY_FAIL), not silently lost.
pub static HOTKEY_WANTED: AtomicBool = AtomicBool::new(true);
pub static NOTE_KEY_FAIL: AtomicBool = AtomicBool::new(false);
pub static OCR_KEY_FAIL: AtomicBool = AtomicBool::new(false);
pub fn start_hotkey() {
    std::thread::spawn(|| unsafe {
        // what is registered right now: (label, modifier bits, key) per id, None = nothing
        let mut have: [Option<(String, u32, u32)>; 2] = [None, None];
        loop {
            let want = HOTKEY_WANTED.load(SeqCst);
            let mut changed = false;
            for (slot, id, key, default, fail, name) in [(0usize, 1i32, "keyNote", "Ctrl+Alt+N", &NOTE_KEY_FAIL, "quick-note"), (1, 2, "keyOcr", "Ctrl+Alt+T", &OCR_KEY_FAIL, "text-grab")] {
                let wanted = if want { Some(crate::settings::combo(key, default)) } else { None };
                if wanted == have[slot] {
                    continue;
                }
                if have[slot].is_some() {
                    let _ = UnregisterHotKey(None, id);
                }
                let ok = match &wanted {
                    Some((label, bits, vk)) => {
                        let ok = RegisterHotKey(None, id, HOT_KEY_MODIFIERS(*bits) | MOD_NOREPEAT, *vk).is_ok();
                        if !ok {
                            sys::log(&format!("{label} is taken by another program: {name} shortcut is off"));
                        }
                        ok
                    }
                    None => true,
                };
                fail.store(!ok, SeqCst);
                have[slot] = wanted;
                changed = true;
            }
            if changed {
                crate::settings::broadcast();
            }
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                if msg.message == WM_HOTKEY && msg.wParam.0 == 2 {
                    crate::ocr::start();
                } else if msg.message == WM_HOTKEY {
                    sys::emit("hotkey", "note");
                }
            }
            std::thread::sleep(Duration::from_millis(40));
        }
    });
}
