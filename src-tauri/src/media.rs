// Now playing: the system media session (title, artist, cover, position) and its transport controls.
use std::time::{Duration, Instant};

use serde_json::json;
use windows::core::Interface;
use windows::Media::Control::*;
use windows::Media::MediaPlaybackType;
use windows::Storage::Streams::{DataReader, IRandomAccessStreamWithContentType};
use windows_future::{AsyncStatus, IAsyncOperation};

use crate::sys;

/// Waits for a WinRT operation, but never forever: a stuck media app must not freeze the polling loop.
pub fn wait<T: windows::core::RuntimeType + 'static>(op: windows::core::Result<IAsyncOperation<T>>, ms: u64) -> Option<T> {
    let op = op.ok()?;
    let t = Instant::now();
    loop {
        match op.Status().ok()? {
            AsyncStatus::Completed => return op.GetResults().ok(),
            AsyncStatus::Started => {}
            _ => return None,
        }
        if t.elapsed() > Duration::from_millis(ms) {
            let _ = op.Cancel();
            return None;
        }
        std::thread::sleep(Duration::from_millis(3));
    }
}

pub fn read_stream(op: windows::core::Result<IAsyncOperation<IRandomAccessStreamWithContentType>>) -> Option<Vec<u8>> {
    let stream = wait(op, 4000)?;
    let size = stream.Size().ok()? as u32;
    if size == 0 || size > 12_000_000 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
    let load: IAsyncOperation<u32> = reader.LoadAsync(size).ok()?.cast().ok()?;
    let got = wait(Ok(load), 4000)?;
    let mut buf = vec![0u8; got as usize];
    reader.ReadBytes(&mut buf).ok()?;
    if buf.is_empty() { None } else { Some(buf) }
}

fn filetime_now() -> i64 {
    // 100ns ticks since 1601, like Windows.Foundation.DateTime
    (sys::now_ms() as i64 + 11_644_473_600_000) * 10_000
}
fn kind_name(k: MediaPlaybackType) -> &'static str {
    match k.0 {
        1 => "Music",
        2 => "Video",
        3 => "Image",
        _ => "Unknown",
    }
}

fn thumb_hash(b: &[u8]) -> u64 {
    // FNV-1a: cheap change detector for cover bytes
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for &x in b {
        h ^= x as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h ^ (b.len() as u64).rotate_left(32)
}

pub struct Media {
    mgr: Option<GlobalSystemMediaTransportControlsSessionManager>,
    thumb_key: String,
    thumb_hash: u64,
    thumb_cleared: bool,
    thumb_due: Instant,
    none_sent: bool,
}

impl Media {
    pub fn new() -> Self {
        Self {
            mgr: None,
            thumb_key: String::new(),
            thumb_hash: 0,
            thumb_cleared: false,
            thumb_due: Instant::now(),
            none_sent: false,
        }
    }

    fn session(&mut self) -> Option<GlobalSystemMediaTransportControlsSession> {
        if self.mgr.is_none() {
            self.mgr = wait(GlobalSystemMediaTransportControlsSessionManager::RequestAsync(), 4000);
        }
        match self.mgr.as_ref()?.GetCurrentSession() {
            Ok(s) => Some(s),
            Err(e) => {
                if e.code().0 != 0 {
                    self.mgr = None; // the manager itself went away: ask for a new one next time
                }
                None
            }
        }
    }

    pub fn poll(&mut self) {
        let Some(s) = self.session() else {
            if !self.none_sent {
                sys::helper(json!({ "t": "media", "active": false }));
                self.none_sent = true;
                self.thumb_key.clear();
                self.thumb_hash = 0;
                self.thumb_cleared = false;
            }
            return;
        };
        let Some(props) = wait(s.TryGetMediaPropertiesAsync(), 4000) else { return };
        let Ok(info) = s.GetPlaybackInfo() else { return };
        let playing = info.PlaybackStatus().map(|v| v == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing).unwrap_or(false);
        let (mut pos, mut dur) = (0f64, 0f64);
        if let Ok(tl) = s.GetTimelineProperties() {
            let ms = |t: windows::core::Result<windows::Foundation::TimeSpan>| t.map(|v| v.Duration as f64 / 10_000.0).unwrap_or(0.0);
            pos = ms(tl.Position());
            dur = ms(tl.EndTime()) - ms(tl.StartTime());
            if playing && dur > 0.0 {
                let upd = tl.LastUpdatedTime().map(|d| d.UniversalTime).unwrap_or(0);
                let since = (filetime_now() - upd) as f64 / 10_000.0;
                if upd > 0 && since > 0.0 && since < 86_400_000.0 {
                    pos += since;
                }
                pos = pos.min(dur);
            }
        }
        let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
        let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
        let app = s.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();
        let key = format!("{title}|{artist}|{app}");
        // what the player says it is playing: Music / Video / Image (many apps leave it unset)
        let mut kind = info.PlaybackType().and_then(|r| r.Value()).map(kind_name).unwrap_or("");
        if kind.is_empty() || kind == "Unknown" {
            kind = props.PlaybackType().and_then(|r| r.Value()).map(kind_name).unwrap_or(kind);
        }
        let can_seek = dur > 0.0 && info.Controls().and_then(|c| c.IsPlaybackPositionEnabled()).unwrap_or(false);
        sys::helper(json!({
            "t": "media", "active": true, "title": title, "artist": artist, "playing": playing, "kind": kind,
            "canSeek": can_seek, "pos": pos.round(), "dur": dur.max(0.0).round(), "app": app, "key": key,
        }));
        self.none_sent = false;
        // The cover is NOT fetched just once per track: browsers publish the
        // metadata first and the artwork a moment later (or swap a placeholder
        // for the real thumbnail), so a single grab on key change can stick
        // the pill with the wrong cover and colour until a page refresh.
        // Retry quickly while no art has arrived, then re-check every few
        // seconds and push the art whenever its bytes actually change.
        if key != self.thumb_key {
            self.thumb_key = key.clone();
            self.thumb_hash = 0;
            self.thumb_cleared = false;
            self.thumb_due = Instant::now();
        }
        if Instant::now() >= self.thumb_due {
            match props.Thumbnail().ok().and_then(|t| read_stream(t.OpenReadAsync())) {
                Some(b) if !b.is_empty() => {
                    let h = thumb_hash(&b);
                    if h != self.thumb_hash {
                        self.thumb_hash = h;
                        sys::helper(json!({ "t": "thumb", "key": key, "data": sys::b64(&b) }));
                    }
                    self.thumb_due = Instant::now() + Duration::from_secs(4);
                }
                _ => {
                    if !self.thumb_cleared {
                        self.thumb_cleared = true;
                        // forget the hash too: the page cleared its art on this null, so when the
                        // real art comes back (e.g. a YouTube ad ends and the video's thumbnail
                        // returns with the SAME bytes as before the ad) it must be pushed again —
                        // with the old hash kept, it compared equal and the pill stayed artless
                        self.thumb_hash = 0;
                        sys::helper(json!({ "t": "thumb", "key": key, "data": serde_json::Value::Null }));
                    }
                    self.thumb_due = Instant::now() + Duration::from_millis(700);
                }
            }
        }
    }

    pub fn toggle(&mut self) {
        if let Some(s) = self.session() {
            let _ = s.TryTogglePlayPauseAsync();
        }
    }
    pub fn next(&mut self) {
        if let Some(s) = self.session() {
            let _ = s.TrySkipNextAsync();
        }
    }
    pub fn prev(&mut self) {
        if let Some(s) = self.session() {
            let _ = s.TrySkipPreviousAsync();
        }
    }
    pub fn seek(&mut self, ms: i64) {
        if let Some(s) = self.session() {
            let _ = s.TryChangePlaybackPositionAsync(ms * 10_000);
        }
    }
}
