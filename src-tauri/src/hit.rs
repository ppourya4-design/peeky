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
use windows::Win32::UI::HiDpi::GetDpiForWindow;
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

/// Top centre of the primary screen, at the size the current scale asks for.
unsafe fn place(h: HWND) {
    let scale = GetDpiForWindow(h).max(96) as f64 / 96.0;
    let (w, hgt) = ((WIN_W * scale).round() as i32, (WIN_H * scale).round() as i32);
    let x = (GetSystemMetrics(SM_CXSCREEN) - w) / 2;
    let y = OFFSET_Y.load(SeqCst) as i32;
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
                if tick % 120 == 0 {
                    place(h);
                }
            }

            let mut pt = POINT::default();
            if GetCursorPos(&mut pt).is_err() {
                continue;
            }
            let r = sys::rect_of(h);
            let scale = GetDpiForWindow(h).max(96) as f64 / 96.0;
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

/// The quick-note shortcut (Ctrl+Alt+N). Registered on its own thread, switched with the setting.
pub static HOTKEY_WANTED: AtomicBool = AtomicBool::new(true);
pub fn start_hotkey() {
    std::thread::spawn(|| unsafe {
        let mut have = false;
        let mut failed = false;
        loop {
            let want = HOTKEY_WANTED.load(SeqCst);
            if want && !have && !failed {
                have = RegisterHotKey(None, 1, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 'N' as u32).is_ok();
                if !have {
                    failed = true;
                    sys::log("Ctrl+Alt+N is taken by another program: quick-note shortcut is off");
                } else if RegisterHotKey(None, 2, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 'T' as u32).is_err() {
                    sys::log("Ctrl+Alt+T is taken by another program: text-grab shortcut is off");
                }
            } else if !want && have {
                let _ = UnregisterHotKey(None, 1);
                let _ = UnregisterHotKey(None, 2);
                have = false;
            }
            if !want {
                failed = false;
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
