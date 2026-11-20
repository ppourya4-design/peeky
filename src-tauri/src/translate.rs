// Lyrics translation (English -> Persian) for the player. It runs here, not in the page:
// the free translation endpoints send no CORS headers, so the WebView can never read
// their answers (the v2.1.28 in-page fetch failed silently for exactly that reason).
// Order: one bulk request for the whole song, per-line retries for the gaps, and
// MyMemory as a last resort. An engine that keeps failing is dropped after 3 misses.
use std::time::Duration;

use serde_json::Value;

fn client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Poyzen")
        .build()
        .ok()
}

async fn gtx(cli: &reqwest::Client, q: &str) -> Option<String> {
    let resp = cli
        .get("https://translate.googleapis.com/translate_a/single")
        .query(&[("client", "gtx"), ("sl", "en"), ("tl", "fa"), ("dt", "t"), ("q", q)])
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let j: Value = resp.json().await.ok()?;
    let mut out = String::new();
    for seg in j.get(0)?.as_array()? {
        if let Some(t) = seg.get(0).and_then(|v| v.as_str()) {
            out.push_str(t);
        }
    }
    (!out.trim().is_empty()).then_some(out)
}

async fn mymemory(cli: &reqwest::Client, q: &str) -> Option<String> {
    let resp = cli
        .get("https://api.mymemory.translated.net/get")
        .query(&[("q", q), ("langpair", "en|fa")])
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let j: Value = resp.json().await.ok()?;
    let t = j.get("responseData")?.get("translatedText")?.as_str()?.trim().to_string();
    (!t.is_empty()).then_some(t)
}

pub async fn run(lines: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = vec![String::new(); lines.len()];
    let Some(cli) = client() else { return out };

    // 1) the whole song in one request; newlines keep the lines apart
    let joined = lines
        .iter()
        .map(|l| if l.trim().is_empty() { "\u{266A}".to_string() } else { l.clone() })
        .collect::<Vec<_>>()
        .join("\n");
    if let Some(all) = gtx(&cli, &joined).await {
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
        match gtx(&cli, &lines[i]).await {
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
        match mymemory(&cli, &lines[i]).await {
            Some(t) => {
                out[i] = t;
                fails = 0;
            }
            None => fails += 1,
        }
    }
    out
}
