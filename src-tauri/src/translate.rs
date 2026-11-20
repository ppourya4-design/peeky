// Lyrics translation (English -> Persian) for the player. It runs here, not in the page:
// the free translation endpoints send no CORS headers, so the WebView can never read
// their answers (the v2.1.28 in-page fetch failed silently for exactly that reason).
// Requests go through WinHTTP directly (GET and POST, no new crates). Engines, best
// first: Microsoft Translator (one POST for the whole song, clean line alignment),
// then Google's public endpoint on two hosts, then MyMemory as a last resort.
// An engine that keeps failing is dropped after 3 misses.
use std::ffi::c_void;

use serde_json::{json, Value};
use windows::core::PCWSTR;
use windows::Win32::Networking::WinHttp::*;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// One HTTPS request; returns the response body on any completed exchange.
fn request(host: &str, verb: &str, path: &str, headers: Option<&str>, body: Option<&[u8]>) -> Option<String> {
    unsafe {
        let session = WinHttpOpen(
            PCWSTR(wide("Poyzen").as_ptr()),
            WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
            PCWSTR::null(),
            PCWSTR::null(),
            0,
        );
        if session.is_null() {
            return None;
        }
        let _ = WinHttpSetTimeouts(session, 8000, 8000, 10000, 10000);
        let conn = WinHttpConnect(session, PCWSTR(wide(host).as_ptr()), 443, 0);
        if conn.is_null() {
            let _ = WinHttpCloseHandle(session);
            return None;
        }
        let req = WinHttpOpenRequest(
            conn,
            PCWSTR(wide(verb).as_ptr()),
            PCWSTR(wide(path).as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            std::ptr::null(),
            WINHTTP_FLAG_SECURE,
        );
        if req.is_null() {
            let _ = WinHttpCloseHandle(conn);
            let _ = WinHttpCloseHandle(session);
            return None;
        }
        if let Some(h) = headers {
            let hw: Vec<u16> = h.encode_utf16().collect();
            let _ = WinHttpAddRequestHeaders(req, &hw, WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE);
        }
        let bytes: Vec<u8> = body.map(|b| b.to_vec()).unwrap_or_default();
        let sent = WinHttpSendRequest(
            req,
            None,
            if bytes.is_empty() { None } else { Some(bytes.as_ptr() as *const c_void) },
            bytes.len() as u32,
            bytes.len() as u32,
            0,
        );
        let mut out: Vec<u8> = Vec::new();
        if sent.is_ok() && WinHttpReceiveResponse(req, std::ptr::null_mut()).is_ok() {
            loop {
                let mut avail: u32 = 0;
                if WinHttpQueryDataAvailable(req, &mut avail).is_err() || avail == 0 {
                    break;
                }
                let mut chunk = vec![0u8; avail as usize];
                let mut read: u32 = 0;
                if WinHttpReadData(req, chunk.as_mut_ptr() as *mut c_void, avail, &mut read).is_err() {
                    break;
                }
                chunk.truncate(read as usize);
                out.extend_from_slice(&chunk);
                if read == 0 {
                    break;
                }
            }
        }
        let _ = WinHttpCloseHandle(req);
        let _ = WinHttpCloseHandle(conn);
        let _ = WinHttpCloseHandle(session);
        if out.is_empty() {
            None
        } else {
            Some(String::from_utf8_lossy(&out).into_owned())
        }
    }
}

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

fn gtx(host: &str, q: &str) -> Option<String> {
    let path = format!("/translate_a/single?client=gtx&sl=en&tl=fa&dt=t&q={}", enc(q));
    let j: Value = serde_json::from_str(&request(host, "GET", &path, None, None)?).ok()?;
    let mut out = String::new();
    for seg in j.get(0)?.as_array()? {
        if let Some(t) = seg.get(0).and_then(|v| v.as_str()) {
            out.push_str(t);
        }
    }
    (!out.trim().is_empty()).then_some(out)
}

fn mymemory(q: &str) -> Option<String> {
    let path = format!("/get?q={}&langpair=en%7Cfa", enc(q));
    let j: Value = serde_json::from_str(&request("api.mymemory.translated.net", "GET", &path, None, None)?).ok()?;
    let t = j.get("responseData")?.get("translatedText")?.as_str()?.trim().to_string();
    (!t.is_empty()).then_some(t)
}

/// Microsoft Translator: the Edge auth endpoint hands out a short-lived token with
/// no key; one POST then translates every line at once, answers aligned by index.
fn microsoft(lines: &[String], out: &mut [String]) {
    let Some(jwt) = request("edge.microsoft.com", "GET", "/translate/auth", None, None) else { return };
    let jwt = jwt.trim();
    if jwt.len() < 20 {
        return;
    }
    let idx: Vec<usize> = (0..lines.len()).filter(|&i| !lines[i].trim().is_empty()).collect();
    if idx.is_empty() {
        return;
    }
    let payload: Vec<Value> = idx.iter().map(|&i| json!({ "Text": lines[i] })).collect();
    let body = serde_json::to_vec(&payload).unwrap_or_default();
    let headers = format!("Authorization: Bearer {jwt}\r\nContent-Type: application/json; charset=UTF-8\r\n");
    let Some(resp) = request(
        "api.cognitive.microsofttranslator.com",
        "POST",
        "/translate?api-version=3.0&from=en&to=fa",
        Some(&headers),
        Some(&body),
    ) else {
        return;
    };
    let Ok(j) = serde_json::from_str::<Value>(&resp) else { return };
    let Some(arr) = j.as_array() else { return };
    for (k, item) in arr.iter().enumerate() {
        if let Some(t) = item
            .get("translations")
            .and_then(|t| t.get(0))
            .and_then(|t| t.get("text"))
            .and_then(|t| t.as_str())
        {
            if let Some(&i) = idx.get(k) {
                out[i] = t.trim().to_string();
            }
        }
    }
}

pub fn run(lines: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = vec![String::new(); lines.len()];

    // 1) Microsoft: the whole song in one aligned POST
    microsoft(&lines, &mut out);

    // 2) Google bulk (the whole song, newlines keep lines apart) on two hosts
    if out.iter().any(|o| o.is_empty()) {
        let joined = lines
            .iter()
            .map(|l| if l.trim().is_empty() { "\u{266A}".to_string() } else { l.clone() })
            .collect::<Vec<_>>()
            .join("\n");
        for host in ["translate.google.com", "translate.googleapis.com"] {
            if let Some(all) = gtx(host, &joined) {
                let parts: Vec<&str> = all.split('\n').collect();
                if parts.len() == lines.len() {
                    for (i, p) in parts.iter().enumerate() {
                        if out[i].is_empty() && !lines[i].trim().is_empty() {
                            out[i] = p.trim().to_string();
                        }
                    }
                }
            }
            if out.iter().all(|o| !o.is_empty()) {
                break;
            }
        }
    }
    // 3) gaps, line by line through Google
    let mut fails = 0;
    for i in 0..lines.len() {
        if fails >= 3 {
            break;
        }
        if lines[i].trim().is_empty() || !out[i].is_empty() {
            continue;
        }
        match gtx("translate.google.com", &lines[i]) {
            Some(t) => {
                out[i] = t.trim().to_string();
                fails = 0;
            }
            None => fails += 1,
        }
    }
    // 4) last resort: MyMemory, line by line
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
