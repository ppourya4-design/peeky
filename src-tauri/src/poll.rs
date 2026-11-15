// One background thread watches everything that changes slowly: the media session, notifications, volume,
// what sits under the island, the clipboard and Bluetooth. Commands from the page are run on the same thread.
use std::collections::{HashMap, HashSet};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::json;
use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice};
use windows::Devices::Enumeration::DeviceInformation;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::*;

use crate::media::{wait, Media};
use crate::notif::Notifs;
use crate::{audio, clip, net, sys};

pub enum Cmd {
    Toggle,
    Next,
    Prev,
    Vol(f32),
    Mute,
    Seek(i64),
    Dismiss(u32),
    ClearAll,
    Act(String, String),
}
static TX: OnceLock<Mutex<Sender<Cmd>>> = OnceLock::new();
pub fn send(c: Cmd) {
    if let Some(tx) = TX.get() {
        let _ = tx.lock().unwrap().send(c);
    }
}

// ---------------------------------------------------------------- is an app window sitting where the island lives?
/// 1 = an app window, 0 = bare desktop, -1 = the island itself (unknown)
unsafe fn cover_state(me: u32) -> i32 {
    let h = sys::hwnd();
    let r = sys::rect_of(h);
    let scale = GetDpiForWindow(h).max(96) as f64 / 96.0;
    let pt = POINT { x: (r.left + r.right) / 2, y: r.top + (26.0 * scale) as i32 };
    let w = WindowFromPoint(pt);
    if w.0.is_null() {
        return 0;
    }
    let root = sys::root_of(w);
    if sys::pid_of(root) == me {
        return -1;
    }
    let c = sys::class_of(root);
    if c == "Progman" || c == "WorkerW" { 0 } else { 1 }
}
/// true when the active window fills the whole primary screen (a movie, a game, a presentation)
unsafe fn foreground_fullscreen(me: u32) -> bool {
    let h = GetForegroundWindow();
    if h.0.is_null() || sys::pid_of(h) == me {
        return false;
    }
    let c = sys::class_of(h);
    if c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" {
        return false;
    }
    let r = sys::rect_of(h);
    let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    if !GetMonitorInfoW(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mut mi).as_bool() || mi.dwFlags & 1 == 0 {
        return false; // the island lives on the primary screen only
    }
    let m = mi.rcMonitor;
    r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
}

// ---------------------------------------------------------------- Bluetooth devices connecting / disconnecting
struct Bluetooth {
    selectors: Vec<windows::core::HSTRING>,
    now: Option<HashSet<String>>,
    last: Option<HashSet<String>>,
    said: HashMap<String, Instant>,
}
impl Bluetooth {
    fn new() -> Self {
        let c = BluetoothConnectionStatus::Connected;
        let selectors = [BluetoothDevice::GetDeviceSelectorFromConnectionStatus(c), BluetoothLEDevice::GetDeviceSelectorFromConnectionStatus(c)].into_iter().flatten().collect();
        Self { selectors, now: None, last: None, said: HashMap::new() }
    }
    fn poll(&mut self) {
        let mut set = HashSet::new();
        for sel in &self.selectors {
            let Some(list) = wait(DeviceInformation::FindAllAsyncAqsFilter(sel), 4000) else { return };
            for i in 0..list.Size().unwrap_or(0) {
                if let Ok(name) = list.GetAt(i).and_then(|d| d.Name()) {
                    if !name.is_empty() {
                        set.insert(name.to_string());
                    }
                }
            }
        }
        // a change counts once two polls in a row agree (radios flap), and each device speaks at most once a minute
        if let (Some(last), Some(now)) = (&self.last, &mut self.now) {
            let mut say = |said: &mut HashMap<String, Instant>, name: &str, on: bool| {
                if said.get(name).is_none_or(|t| t.elapsed() > Duration::from_secs(60)) {
                    said.insert(name.to_string(), Instant::now());
                    sys::helper(json!({ "t": "bt", "name": name, "on": on }));
                }
            };
            for k in &set {
                if last.contains(k) && !now.contains(k) {
                    say(&mut self.said, k, true);
                    now.insert(k.clone());
                }
            }
            for k in now.clone() {
                if !set.contains(&k) && !last.contains(&k) {
                    say(&mut self.said, &k, false);
                    now.remove(&k);
                }
            }
        }
        if self.now.is_none() {
            self.now = Some(set.clone()); // first scan: what is connected right now
        }
        self.last = Some(set);
    }
}

pub fn start() {
    let (tx, rx) = mpsc::channel::<Cmd>();
    let _ = TX.set(Mutex::new(tx));
    std::thread::spawn(move || unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
        let me = std::process::id();
        let mut media = Media::new();
        let mut notifs = Notifs::new();
        let mut bt = Bluetooth::new();
        let mut watch = net::Watch::new();
        let mut last_vol = String::new();
        let mut clip_seq = clip::sequence();
        let (mut cover_sent, mut cover_last) = (-1, -1);
        let start = Instant::now();
        let mut due: HashMap<&str, Instant> = HashMap::new();
        let mut every = |name: &'static str, ms: u64| -> bool {
            let now = Instant::now();
            let t = due.entry(name).or_insert(now);
            if now >= *t {
                *t = now + Duration::from_millis(ms);
                true
            } else {
                false
            }
        };
        let mut volume = |force: bool, last: &mut String| {
            if let Some((v, m)) = audio::volume() {
                let level = (v * 100.0).round() / 100.0;
                let k = format!("{level}|{m}");
                if force || k != *last {
                    *last = k;
                    sys::helper(json!({ "t": "vol", "level": level, "mute": m }));
                }
            }
        };
        loop {
            // commands: drain everything that is waiting; of several queued volume changes only the newest matters
            let mut cmds = Vec::new();
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(c) => {
                    cmds.push(c);
                    while cmds.len() < 50 {
                        match rx.try_recv() {
                            Ok(c) => cmds.push(c),
                            Err(_) => break,
                        }
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if !cmds.is_empty() {
                let last_v = cmds.iter().rposition(|c| matches!(c, Cmd::Vol(_)));
                for (i, c) in cmds.into_iter().enumerate() {
                    match c {
                        Cmd::Toggle => media.toggle(),
                        Cmd::Next => media.next(),
                        Cmd::Prev => media.prev(),
                        Cmd::Vol(v) => {
                            if Some(i) == last_v {
                                audio::set_volume(v)
                            }
                        }
                        Cmd::Mute => audio::toggle_mute(),
                        Cmd::Seek(ms) => media.seek(ms),
                        Cmd::Dismiss(id) => notifs.dismiss(id),
                        Cmd::ClearAll => notifs.clear_all(),
                        Cmd::Act(id, aumid) => notifs.activate(&id, &aumid),
                    }
                }
                media.poll();
                volume(false, &mut last_vol);
            }
            if every("media", 500) {
                media.poll();
            }
            if every("notif", 1000) {
                notifs.poll();
            }
            if every("vol", 400) {
                volume(false, &mut last_vol);
            }
            if every("telegram", 500) {
                notifs.poll_telegram();
            }
            if every("cover", 300) {
                let s = cover_state(me);
                if s >= 0 {
                    let full = foreground_fullscreen(me);
                    let s = s + if full { 10 } else { 0 };
                    // report only once the state has been stable for two polls
                    if s == cover_last && s != cover_sent {
                        cover_sent = s;
                        sys::helper(json!({ "t": "cover", "covered": s % 10 == 1, "full": full }));
                    }
                    cover_last = s;
                }
            }
            if every("clip", 300) {
                let n = clip::sequence();
                if n != clip_seq {
                    clip_seq = n;
                    clip::changed();
                }
            }
            if start.elapsed() > Duration::from_secs(3) && every("net", 2500) {
                watch.poll_net();
            }
            if start.elapsed() > Duration::from_secs(1) && every("sensors", 1500) {
                watch.poll_sensors();
            }
            if start.elapsed() > Duration::from_secs(2) && every("bt", 3000) {
                bt.poll();
            }
        }
    });
}
