//! Peeky on Android: a single-window music player (ui/mobile.html).
//! The desktop app lives in main.rs and is untouched — this crate compiles to nothing
//! on every other platform, and on Android it registers only the music commands,
//! reading the phone's shared storage instead of a picked folder.
#![cfg(target_os = "android")]

mod music;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Where a phone keeps its music: the two folders everyone uses, and the shared root itself
/// (whose shallow walk already covers them, plus anything loose at the top level).
const ROOTS: [&str; 3] = ["/storage/emulated/0/Music", "/storage/emulated/0/Download", "/storage/emulated/0"];

fn roots() -> Vec<PathBuf> {
    ROOTS.iter().map(PathBuf::from).filter(|p| p.is_dir()).collect()
}

/// There is no folder picker on a phone; the player reads the shared storage roots.
#[tauri::command]
async fn music_pick() -> Option<String> {
    Some("/storage/emulated/0".to_string())
}

/// Every track under every root, de-duplicated (the root walk overlaps Music and Download).
#[tauri::command]
async fn music_scan() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut all = BTreeSet::new();
        for root in roots() {
            for p in music::scan(&root) {
                all.insert(p.to_string_lossy().into_owned());
            }
        }
        all.into_iter().collect()
    })
    .await
    .unwrap_or_default()
}

/// music::read/head check that the file really lives inside one root; try each in turn.
async fn fetch(path: String, head_only: bool) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = Path::new(&path);
        for root in roots() {
            let got = if head_only { music::head(&root, file) } else { music::read(&root, file) };
            if let Some(bytes) = got {
                return Ok(tauri::ipc::Response::new(bytes));
            }
        }
        Err("not available".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn music_read(path: String) -> Result<tauri::ipc::Response, String> {
    fetch(path, false).await
}

#[tauri::command]
async fn music_head(path: String) -> Result<tauri::ipc::Response, String> {
    fetch(path, true).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_media::init())
        .invoke_handler(tauri::generate_handler![music_pick, music_scan, music_read, music_head])
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("mobile.html".into()))
                .title("Peeky")
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Peeky");
}
