// Updates: now and then the app asks GitHub whether a newer release exists, downloads its installer, checks
// that it was signed with the project's key, and tells the page. One click then installs it and restarts.
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use windows::core::HSTRING;
use windows::Win32::System::Com::Urlmon::URLDownloadToFileW;

use crate::{settings, sys};

const BASE: &str = "https://github.com/raminturne/peeky/releases/latest/download";
/// The public half of the release-signing key (Ed25519). The private half lives only in the repository's secrets.
const KEY: [u8; 32] = [63, 0, 60, 214, 100, 167, 237, 223, 180, 217, 239, 181, 141, 177, 76, 130, 3, 62, 67, 79, 23, 72, 155, 50, 58, 132, 111, 212, 124, 162, 222, 128];

static READY: Mutex<Option<(String, PathBuf)>> = Mutex::new(None);

fn dir() -> PathBuf {
    let d = std::env::temp_dir().join("PeekyUpdate");
    let _ = std::fs::create_dir_all(&d);
    d
}
fn fetch(name: &str) -> Option<PathBuf> {
    let to = dir().join(name);
    let _ = std::fs::remove_file(&to);
    let url = format!("{BASE}/{name}?t={}", sys::now_ms()); // the query keeps Windows from serving an old copy
    unsafe { URLDownloadToFileW(None, &HSTRING::from(url), &HSTRING::from(to.to_string_lossy().as_ref()), 0, None).ok()? };
    to.exists().then_some(to)
}
fn newer(a: &str, than: &str) -> bool {
    let n = |s: &str| s.trim_start_matches('v').split('.').map(|p| p.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>();
    n(a) > n(than)
}
fn signed(file: &PathBuf, sig_file: &PathBuf) -> bool {
    use base64::Engine;
    let (Ok(data), Ok(sig)) = (std::fs::read(file), std::fs::read_to_string(sig_file)) else { return false };
    let Ok(sig) = base64::engine::general_purpose::STANDARD.decode(sig.trim()) else { return false };
    let (Ok(pk), Ok(sig)) = (ed25519_compact::PublicKey::from_slice(&KEY), ed25519_compact::Signature::from_slice(&sig)) else { return false };
    pk.verify(&data, &sig).is_ok()
}
/// "none" | "ready 2.2.0" | "failed: why"
pub fn check() -> String {
    if let Some((v, _)) = READY.lock().unwrap().as_ref() {
        return format!("ready {v}");
    }
    let Some(info) = fetch("latest.json").and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
        return "failed: could not reach GitHub".into();
    };
    let version = info["version"].as_str().unwrap_or("").to_string();
    if !newer(&version, env!("CARGO_PKG_VERSION")) {
        return "none".into();
    }
    let (Some(setup), Some(sig)) = (fetch("Peeky-Setup.exe"), fetch("Peeky-Setup.exe.sig")) else {
        return "failed: download did not finish".into();
    };
    if !signed(&setup, &sig) {
        let _ = std::fs::remove_file(&setup);
        sys::log(&format!("update {version}: the installer's signature is wrong, it was thrown away"));
        return "failed: the download is not signed by this project".into();
    }
    *READY.lock().unwrap() = Some((version.clone(), setup));
    sys::helper(json!({ "t": "update", "version": version }));
    format!("ready {version}")
}
/// Runs the downloaded installer quietly; it closes this copy, replaces it and starts the new one.
pub fn install() -> bool {
    let Some((v, setup)) = READY.lock().unwrap().clone() else { return false };
    if !signed(&setup, &dir().join("Peeky-Setup.exe.sig")) {
        return false; // the file changed since it was checked
    }
    sys::log(&format!("installing update {v}"));
    sys::shell_open(&setup.to_string_lossy(), Some("/S"));
    true
}
pub fn start() {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(45));
        loop {
            if settings::packaged() && settings::get("autoUpdate") != Value::Bool(false) {
                let r = check();
                if r.starts_with("failed") {
                    sys::log(&format!("update check {r}"));
                }
            }
            std::thread::sleep(Duration::from_secs(6 * 3600));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The installer in dist/ and the signature installer/sign.mjs wrote for it must be accepted; a changed file must not.
    /// (Skipped when no signed installer has been built here.)
    #[test]
    fn signature_made_by_the_release_script_is_accepted() {
        let dist = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("dist");
        let (setup, sig) = (dist.join("Peeky-Setup.exe"), dist.join("Peeky-Setup.exe.sig"));
        if !setup.exists() || !sig.exists() {
            return;
        }
        assert!(signed(&setup, &sig));
        let bad = std::env::temp_dir().join("peeky-tampered.exe");
        let mut data = std::fs::read(&setup).unwrap();
        data[1000] ^= 1;
        std::fs::write(&bad, data).unwrap();
        assert!(!signed(&bad, &sig));
        let _ = std::fs::remove_file(bad);
    }

    #[test]
    fn versions_compare_by_number() {
        assert!(newer("2.10.0", "2.9.9"));
        assert!(newer("v2.1.1", "2.1.0"));
        assert!(!newer("2.1.0", "2.1.0"));
        assert!(!newer("", "2.1.0"));
    }
}