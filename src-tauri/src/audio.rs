// Master volume, and a listener on what the speakers are playing (for the night sky that moves with the music).
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::time::{Duration, Instant};

use windows::core::GUID;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED};

use crate::sys;

fn endpoint() -> windows::core::Result<IAudioEndpointVolume> {
    unsafe {
        let e: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        e.GetDefaultAudioEndpoint(eRender, eMultimedia)?.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
    }
}
pub fn volume() -> Option<(f32, bool)> {
    unsafe {
        let v = endpoint().ok()?;
        Some((v.GetMasterVolumeLevelScalar().ok()?, v.GetMute().ok()?.as_bool()))
    }
}
pub fn set_volume(level: f32) {
    unsafe {
        if let Ok(v) = endpoint() {
            let _ = v.SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), &GUID::zeroed());
            if level > 0.0 {
                let _ = v.SetMute(false, &GUID::zeroed());
            }
        }
    }
}
pub fn toggle_mute() {
    unsafe {
        if let Ok(v) = endpoint() {
            let m = v.GetMute().map(|b| b.as_bool()).unwrap_or(false);
            let _ = v.SetMute(!m, &GUID::zeroed());
        }
    }
}

// ---------------------------------------------------------------- spectrum of the system output
pub static VIZ: AtomicBool = AtomicBool::new(false);
const NB: usize = 24;

fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * std::f32::consts::PI / len as f32;
        let (wr, wi) = (ang.cos(), ang.sin());
        let half = len / 2;
        let mut i = 0;
        while i < n {
            let (mut cr, mut ci) = (1.0f32, 0.0f32);
            for k in 0..half {
                let (a, b) = (i + k, i + k + half);
                let (vr, vi) = (re[b] * cr - im[b] * ci, re[b] * ci + im[b] * cr);
                let (ur, ui) = (re[a], im[a]);
                re[a] = ur + vr;
                im[a] = ui + vi;
                re[b] = ur - vr;
                im[b] = ui - vi;
                let ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
            i += len;
        }
        len <<= 1;
    }
}

/// One capture session on the current default output device. Returns when the page no longer needs levels
/// or the device goes away (the caller then starts over with whatever is the default device now).
unsafe fn capture() -> windows::core::Result<()> {
    let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
    let dev_id = sys::pwstr_take(device.GetId()?);
    let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
    let pwfx = client.GetMixFormat()?;
    let fmt = std::ptr::read_unaligned(pwfx);
    let (channels, rate, bits) = (fmt.nChannels as usize, fmt.nSamplesPerSec as usize, fmt.wBitsPerSample);
    let mut float = fmt.wFormatTag == 3;
    if fmt.wFormatTag == 0xFFFE {
        let ext = std::ptr::read_unaligned(pwfx as *const WAVEFORMATEXTENSIBLE);
        let sub = ext.SubFormat;
        float = sub.data1 == 3;
    }
    let init = client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 2_000_000, 0, pwfx, None);
    CoTaskMemFree(Some(pwfx as *const _));
    init?;
    let cap: IAudioCaptureClient = client.GetService()?;
    client.Start()?;

    // the analysis mirrors a browser AnalyserNode (fftSize 1024 at 48 kHz, Blackman window, dB-scaled bytes)
    let mult = if rate > 150_000 { 4 } else if rate > 70_000 { 2 } else { 1 };
    let n = 1024 * mult;
    let window: Vec<f32> = (0..n)
        .map(|i| {
            let x = i as f32 / n as f32;
            0.42 - 0.5 * (2.0 * std::f32::consts::PI * x).cos() + 0.08 * (4.0 * std::f32::consts::PI * x).cos()
        })
        .collect();
    let mut ring = vec![0f32; n];
    let mut wpos = 0usize;
    let mut smooth = vec![0f32; n / 2];
    let (mut re, mut im) = (vec![0f32; n], vec![0f32; n]);
    let mut last_packet = Instant::now();
    let mut last_emit = Instant::now();
    let mut last_check = Instant::now();
    let mut quiet_since: Option<Instant> = None;
    let tau = 0.61f32; // AnalyserNode smoothing 0.72 per 60Hz frame, here per 25ms step

    while VIZ.load(SeqCst) {
        std::thread::sleep(Duration::from_millis(10));
        loop {
            let frames = cap.GetNextPacketSize()?;
            if frames == 0 {
                break;
            }
            let (mut data, mut got, mut flags) = (std::ptr::null_mut::<u8>(), 0u32, 0u32);
            cap.GetBuffer(&mut data, &mut got, &mut flags, None, None)?;
            let silent = flags & 2 != 0 || data.is_null();
            for f in 0..got as usize {
                let mut s = 0f32;
                if !silent {
                    for c in 0..channels {
                        let i = f * channels + c;
                        s += if float && bits == 32 {
                            std::ptr::read_unaligned(data.add(i * 4) as *const f32)
                        } else if bits == 16 {
                            std::ptr::read_unaligned(data.add(i * 2) as *const i16) as f32 / 32768.0
                        } else if bits == 32 {
                            std::ptr::read_unaligned(data.add(i * 4) as *const i32) as f32 / 2_147_483_648.0
                        } else {
                            0.0
                        };
                    }
                    s /= channels.max(1) as f32;
                }
                ring[wpos] = s;
                wpos = (wpos + 1) % n;
            }
            cap.ReleaseBuffer(got)?;
            last_packet = Instant::now();
        }
        if last_emit.elapsed() < Duration::from_millis(25) {
            continue;
        }
        last_emit = Instant::now();
        // with nothing playing the device delivers no packets at all: that is silence, not "keep the last sound"
        let stale = last_packet.elapsed() > Duration::from_millis(120);
        for i in 0..n {
            re[i] = if stale { 0.0 } else { ring[(wpos + i) % n] * window[i] };
            im[i] = 0.0;
        }
        fft(&mut re, &mut im);
        let mut peak = 0f32;
        for k in 0..n / 2 {
            let mag = (re[k] * re[k] + im[k] * im[k]).sqrt() / n as f32;
            smooth[k] = tau * smooth[k] + (1.0 - tau) * mag;
            peak = peak.max(smooth[k]);
        }
        let byte = |k: usize| -> f32 {
            let db = 20.0 * smooth[k.min(n / 2 - 1)].max(1e-10).log10();
            ((db + 100.0) / 70.0 * 255.0).clamp(0.0, 255.0)
        };
        let mut levels = [0f32; NB];
        for (i, lv) in levels.iter_mut().enumerate() {
            let a = ((i as f32 / NB as f32).powf(1.9) * 300.0).floor() as usize + 1;
            let b = (((i + 1) as f32 / NB as f32).powf(1.9) * 300.0).floor() as usize + 1;
            let b = b.max(a + 1);
            let mut s = 0f32;
            for k in a * mult..b * mult {
                s += byte(k);
            }
            let v = (s / ((b - a) * mult) as f32 / 255.0).powf(1.5) * (1.0 + i as f32 / NB as f32 * 0.9);
            *lv = (v * 1000.0).round() / 1000.0;
        }
        // nothing to say while it is quiet: one last frame of zeros, then silence on the wire too
        if peak < 1e-7 {
            if quiet_since.is_none() {
                quiet_since = Some(Instant::now());
            }
            if quiet_since.is_some_and(|t| t.elapsed() > Duration::from_millis(600)) {
                continue;
            }
        } else {
            quiet_since = None;
        }
        sys::emit("levels", levels.to_vec());

        if last_check.elapsed() > Duration::from_secs(2) {
            last_check = Instant::now();
            // headphones plugged in / another output chosen: follow it
            let now_id = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia).and_then(|d| d.GetId()).map(|p| sys::pwstr_take(p)).unwrap_or_default();
            if now_id != dev_id {
                break;
            }
        }
    }
    let _ = client.Stop();
    Ok(())
}

pub fn start_viz() {
    std::thread::spawn(|| unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        loop {
            if VIZ.load(SeqCst) {
                if let Err(e) = capture() {
                    sys::log(&format!("audio capture stopped: {e}"));
                    std::thread::sleep(Duration::from_secs(3));
                }
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    });
}
