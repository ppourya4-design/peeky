// Lyrics translation (English -> Persian) for the player. It runs here, not in the page:
// the free translation endpoints send no CORS headers, so the WebView can never read
// their answers (the v2.1.28 in-page fetch failed silently for exactly that reason).
// The asking reuses the app's own download path (URLDownloadToFileW, like the updater),
// so no new dependencies are needed. Order: one bulk request for the whole song,
// per-line retries for the gaps, and MyMemory as a last resort. An engine that
// keeps failing is dropped after 3 misses.
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;
use windows::core::HSTRING;
use windows::Win32::System::Com::Urlmon::URLDownloadToFileW;

static SEQ: AtomicU64 = AtomicU64::new(0);

/// Percent-encode for a query value (everything but the unreserved set).
fn enc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn get(url: &str) -> Option<String> {
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let to: PathBuf = std::env::temp_dir().join(format!("poyzen-tr-{}-{n}.json", std::process::id()));
    let _ = std::fs::remove_file(&to);
    unsafe { URLDownloadToFileW(None, &HSTRING::from(url), &HSTRING::from(to.to_string_lossy().as_ref()), 0, None).ok()? };
    let text = std::fs::read_to_string(&to).ok();
    let _ = std::fs::remove_file(&to);
    text
}

fn gtx(q: &str) -> Option<String> {
    let url = format!("https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fa&dt=t&q={}", enc(q));
    let j: Value = serde_json::from_str(&get(&url)?).ok()?;
    let mut out = String::new();
    for seg in j.get(0)?.as_array()? {
        if let Some(t) = seg.get(0).and_then(|v| v.as_str()) {
            out.push_str(t);
        }
    }
    (!out.trim().is_empty()).then_some(out)
}

fn mymemory(q: &str) -> Option<String> {
    let url = format!("https://api.mymemory.translated.net/get?q={}&langpair=en%7Cfa", enc(q));
    let j: Value = serde_json::from_str(&get(&url)?).ok()?;
    let t = j.get("responseData")?.get("translatedText")?.as_str()?.trim().to_string();
    (!t.is_empty()).then_some(t)
}

pub fn run(lines: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = vec![String::new(); lines.len()];

    // 1) the whole song in one request; newlines keep the lines apart
    let joined = lines
        .iter()
        .map(|l| if l.trim().is_empty() { "\u{266A}".to_string() } else { l.clone() })
        .collect::<Vec<_>>()
        .join("\n");
    if let Some(all) = gtx(&joined) {
        let parts: Vec<&str> = all.split('\n').collect();
        if parts.len() == lines.len() {
            for (i, p) in parts.iter().enumerate() {
                if !lines[i].trim().is_empty() {
                    out[i] = p.trim().to_string();
                }
            }
        }
    }
    // 2) whatever is still missing, line by line through the same engine
    let mut fails = 0;
    for i in 0..lines.len() {
        if fails >= 3 {
            break;
        }
        if lines[i].trim().is_empty() || !out[i].is_empty() {
            continue;
        }
        match gtx(&lines[i]) {
            Some(t) => {
                out[i] = t.trim().to_string();
                fails = 0;
            }
            None => fails += 1,
        }
    }
    // 3) last resort: MyMemory, line by line
    let mut fails = 0;
    for i in 0..lines.len() {
        if fails >= 3 {
            break;
        }
        if lines[i].trim().is_empty() || !out[i].is_empty() {
            continue;
        }
        match mymemory(&lines[i]) {
            Some(t) => {
                out[i] = t;
                fails = 0;
            }
            None => fails += 1,
        }
    }
    out
}
