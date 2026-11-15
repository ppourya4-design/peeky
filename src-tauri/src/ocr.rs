// Text grab: the screen dims, the user drags a box, and the text inside it lands on the clipboard.
// The reading is done by Windows' own OCR (the languages installed in Windows), nothing leaves the machine.
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering::SeqCst};
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::json;
use windows::core::{w, HSTRING};
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture, SetFocus};
use windows::Win32::UI::WindowsAndMessaging::*;

use crate::media::wait;
use crate::{clip, sys};

static BUSY: AtomicBool = AtomicBool::new(false);
static DOWN: AtomicBool = AtomicBool::new(false);
static DONE: AtomicI32 = AtomicI32::new(0); // 0 = choosing, 1 = a box was drawn, 2 = cancelled
static AX: AtomicI32 = AtomicI32::new(0);
static AY: AtomicI32 = AtomicI32::new(0);
static BX: AtomicI32 = AtomicI32::new(0);
static BY: AtomicI32 = AtomicI32::new(0);
const HOLE: u32 = 0x00FF00FF; // this colour is punched out of the dim layer: the chosen box shows the screen as it is

fn chosen() -> RECT {
    let (ax, ay, bx, by) = (AX.load(SeqCst), AY.load(SeqCst), BX.load(SeqCst), BY.load(SeqCst));
    RECT { left: ax.min(bx), top: ay.min(by), right: ax.max(bx), bottom: ay.max(by) }
}
unsafe fn finish(h: HWND, how: i32) {
    if DONE.compare_exchange(0, how, SeqCst, SeqCst).is_ok() {
        DOWN.store(false, SeqCst);
        let _ = ReleaseCapture();
        let _ = DestroyWindow(h);
    }
}
unsafe extern "system" fn wndproc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    let at = || ((lp.0 & 0xFFFF) as i16 as i32, ((lp.0 >> 16) & 0xFFFF) as i16 as i32);
    match msg {
        WM_ERASEBKGND => LRESULT(1),
        WM_SETCURSOR => {
            SetCursor(LoadCursorW(None, IDC_CROSS).ok());
            LRESULT(1)
        }
        WM_LBUTTONDOWN => {
            let (x, y) = at();
            AX.store(x, SeqCst);
            AY.store(y, SeqCst);
            BX.store(x, SeqCst);
            BY.store(y, SeqCst);
            DOWN.store(true, SeqCst);
            SetCapture(h);
            let _ = InvalidateRect(Some(h), None, false);
            LRESULT(0)
        }
        WM_MOUSEMOVE => {
            if DOWN.load(SeqCst) {
                let (x, y) = at();
                BX.store(x, SeqCst);
                BY.store(y, SeqCst);
                let _ = InvalidateRect(Some(h), None, false);
            }
            LRESULT(0)
        }
        WM_LBUTTONUP => {
            if DOWN.load(SeqCst) {
                let (x, y) = at();
                BX.store(x, SeqCst);
                BY.store(y, SeqCst);
                finish(h, 1);
            }
            LRESULT(0)
        }
        WM_RBUTTONDOWN => {
            finish(h, 2);
            LRESULT(0)
        }
        WM_KEYDOWN => {
            if wp.0 == 0x1B {
                finish(h, 2); // Esc
            }
            LRESULT(0)
        }
        WM_PAINT => {
            let mut ps = PAINTSTRUCT::default();
            let dc = BeginPaint(h, &mut ps);
            let mut rc = RECT::default();
            let _ = GetClientRect(h, &mut rc);
            let mem = CreateCompatibleDC(Some(dc));
            let bmp = CreateCompatibleBitmap(dc, rc.right, rc.bottom);
            let old = SelectObject(mem, HGDIOBJ(bmp.0));
            let black = CreateSolidBrush(COLORREF(0));
            FillRect(mem, &rc, black);
            let _ = DeleteObject(HGDIOBJ(black.0));
            if DOWN.load(SeqCst) {
                let sel = chosen();
                let frame = RECT { left: sel.left - 2, top: sel.top - 2, right: sel.right + 2, bottom: sel.bottom + 2 };
                let white = CreateSolidBrush(COLORREF(0x00FFFFFF));
                FillRect(mem, &frame, white);
                let _ = DeleteObject(HGDIOBJ(white.0));
                let hole = CreateSolidBrush(COLORREF(HOLE));
                FillRect(mem, &sel, hole);
                let _ = DeleteObject(HGDIOBJ(hole.0));
            }
            let _ = BitBlt(dc, 0, 0, rc.right, rc.bottom, Some(mem), 0, 0, SRCCOPY);
            SelectObject(mem, old);
            let _ = DeleteObject(HGDIOBJ(bmp.0));
            let _ = DeleteDC(mem);
            let _ = EndPaint(h, &ps);
            LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(h, msg, wp, lp),
    }
}

/// Dims the screen under the cursor and waits for a box to be dragged. Screen coordinates, or None if cancelled.
unsafe fn pick() -> Option<RECT> {
    let mut pt = POINT::default();
    let _ = GetCursorPos(&mut pt);
    let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    if !GetMonitorInfoW(MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST), &mut mi).as_bool() {
        return None;
    }
    let m = mi.rcMonitor;
    let inst = HINSTANCE(GetModuleHandleW(None).ok()?.0);
    let class = w!("IslandTextGrab");
    let wc = WNDCLASSW { lpfnWndProc: Some(wndproc), hInstance: inst, lpszClassName: class, ..Default::default() };
    RegisterClassW(&wc); // a second registration simply fails
    DONE.store(0, SeqCst);
    DOWN.store(false, SeqCst);
    let h = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW, class, w!(""), WS_POPUP, m.left, m.top, m.right - m.left, m.bottom - m.top, None, None, Some(inst), None).ok()?;
    let _ = SetLayeredWindowAttributes(h, COLORREF(HOLE), 96, LWA_ALPHA | LWA_COLORKEY);
    let _ = ShowWindow(h, SW_SHOW);
    sys::force_foreground(h);
    let _ = SetFocus(Some(h));
    let mut msg = MSG::default();
    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
        let _ = TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    if DONE.load(SeqCst) != 1 {
        return None;
    }
    let c = chosen();
    if c.right - c.left < 8 || c.bottom - c.top < 8 {
        return None;
    }
    Some(RECT { left: c.left + m.left, top: c.top + m.top, right: c.right + m.left, bottom: c.bottom + m.top })
}

/// Copies a piece of the screen as BGRA pixels. Small pieces are doubled: the reader likes bigger letters.
unsafe fn capture(r: RECT) -> Option<(Vec<u8>, i32, i32)> {
    let (w, h) = (r.right - r.left, r.bottom - r.top);
    let k = if h < 140 && w <= 1200 { 3 } else if h < 400 && w <= 1800 { 2 } else { 1 };
    let (bw, bh) = (w * k, h * k);
    let screen = GetDC(None);
    let mem = CreateCompatibleDC(Some(screen));
    let mut bi = BITMAPINFO::default();
    bi.bmiHeader = BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: bw, biHeight: -bh, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() };
    let mut bits: *mut c_void = std::ptr::null_mut();
    let Ok(bmp) = CreateDIBSection(Some(mem), &bi, DIB_RGB_COLORS, &mut bits, None, 0) else {
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        return None;
    };
    let old = SelectObject(mem, HGDIOBJ(bmp.0));
    let ok = if k == 1 {
        BitBlt(mem, 0, 0, bw, bh, Some(screen), r.left, r.top, SRCCOPY | CAPTUREBLT).is_ok()
    } else {
        SetStretchBltMode(mem, HALFTONE);
        StretchBlt(mem, 0, 0, bw, bh, Some(screen), r.left, r.top, w, h, SRCCOPY | CAPTUREBLT).as_bool()
    };
    let mut px = std::slice::from_raw_parts(bits as *const u8, (bw * bh * 4) as usize).to_vec();
    SelectObject(mem, old);
    let _ = DeleteObject(HGDIOBJ(bmp.0));
    let _ = DeleteDC(mem);
    ReleaseDC(None, screen);
    if !ok {
        return None;
    }
    for p in px.chunks_exact_mut(4) {
        p[3] = 255;
    }
    Some((px, bw, bh))
}

fn text_of(engine: &OcrEngine, bmp: &SoftwareBitmap) -> Option<String> {
    let res = wait(engine.RecognizeAsync(bmp), 12000)?;
    let mut out = Vec::new();
    for line in res.Lines().ok()? {
        if let Ok(t) = line.Text() {
            out.push(t.to_string());
        }
    }
    Some(out.join("\n"))
}
/// English (and whatever else Windows can read) straight from Windows' own reader.
fn read(px: &[u8], w: i32, h: i32) -> Option<String> {
    let dw = DataWriter::new().ok()?;
    dw.WriteBytes(px).ok()?;
    let buf = dw.DetachBuffer().ok()?;
    let bmp = SoftwareBitmap::CreateCopyFromBuffer(&buf, BitmapPixelFormat::Bgra8, w, h).ok()?;
    // English first (an Arabic pack, if Windows has one, must not take over), then whatever the user's languages offer
    let main = Language::CreateLanguage(&HSTRING::from("en-US")).and_then(|l| OcrEngine::TryCreateFromLanguage(&l)).or_else(|_| OcrEngine::TryCreateFromUserProfileLanguages()).ok()?;
    text_of(&main, &bmp)
}

// Persian is read by the Tesseract engine that ships inside the page: the picture goes there, the text comes back.
static REPLY: Mutex<Option<Sender<String>>> = Mutex::new(None);
static CONF: AtomicI32 = AtomicI32::new(0);
pub fn page_answer(text: String, conf: i32) {
    CONF.store(conf, SeqCst);
    if let Some(tx) = REPLY.lock().unwrap().take() {
        let _ = tx.send(text);
    }
}
fn read_persian(px: &[u8], w: i32, h: i32) -> Option<String> {
    let mut rgba = px.to_vec();
    // light text on a dark background (dark themes) is read far better the other way round
    let lum: u64 = rgba.chunks_exact(4).map(|p| (p[0] as u64 + p[1] as u64 * 2 + p[2] as u64) / 4).sum::<u64>() / (rgba.len() as u64 / 4).max(1);
    for p in rgba.chunks_exact_mut(4) {
        p.swap(0, 2);
        if lum < 110 {
            p[0] = 255 - p[0];
            p[1] = 255 - p[1];
            p[2] = 255 - p[2];
        }
    }
    let png = sys::encode_png(&rgba, w as u32, h as u32)?;
    let (tx, rx) = mpsc::channel();
    *REPLY.lock().unwrap() = Some(tx);
    sys::emit("ocr-read", json!({ "png": sys::b64(&png) }));
    let text = rx.recv_timeout(Duration::from_secs(25)).ok()?;
    // Persian spelling of the letters the model sometimes writes the Arabic way
    Some(text.chars().map(|c| match c { 'ي' | 'ى' => 'ی', 'ك' => 'ک', ',' => '،', _ => c }).collect::<String>().trim().to_string())
}
/// Which of the two readings is the real one. The Persian reader always answers something, even for English
/// text (a soup of digits and stray letters), so its answer counts only when it is sure and nearly all letters.
fn choose(first: Option<String>, persian: Option<String>) -> Option<String> {
    let conf = CONF.load(SeqCst);
    let p = persian.as_deref().unwrap_or("");
    let letters = p.chars().filter(|c| ('\u{0621}'..='\u{064A}').contains(c) || ('\u{066E}'..='\u{06D3}').contains(c)).count();
    let inked = p.chars().filter(|c| !c.is_whitespace()).count().max(1);
    let latin = first.as_deref().unwrap_or("").chars().filter(|c| c.is_ascii_alphabetic()).count();
    let pure = letters * 100 / inked;
    sys::log(&format!("text grab: windows reader {} latin letters; persian reader {letters} letters, {pure}% of its output, confidence {conf}", latin));
    if conf >= 45 && (letters >= 8 || (letters >= 3 && pure >= 70)) {
        return persian;
    }
    first.filter(|t| !t.trim().is_empty())
}
pub fn start() {
    if BUSY.swap(true, SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
            if let Some(r) = pick() {
                std::thread::sleep(std::time::Duration::from_millis(140)); // let the dim layer leave the screen
                let text = capture(r).and_then(|(px, w, h)| choose(read(&px, w, h), read_persian(&px, w, h)));
                match text.map(|t| t.trim().to_string()) {
                    Some(t) if !t.is_empty() => {
                        clip::write_text(&t);
                        sys::emit("ocr", json!({ "ok": true, "text": t.chars().take(160).collect::<String>() }));
                    }
                    Some(_) => sys::emit("ocr", json!({ "ok": false, "why": "No text found there" })),
                    None => {
                        sys::log("text grab: Windows' text reader is not available (no OCR language installed?)");
                        sys::emit("ocr", json!({ "ok": false, "why": "Windows text reader unavailable" }));
                    }
                }
            }
        }
        BUSY.store(false, SeqCst);
    });
}
