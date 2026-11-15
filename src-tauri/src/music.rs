// Local music: a folder the user picks, the tracks in it, and the bytes of one track at a time.
// The page plays the bytes itself (an <audio> element), so this side only lists and hands out files,
// and only files inside the chosen folder.
use std::path::{Path, PathBuf};

const EXTS: [&str; 7] = ["mp3", "flac", "wav", "ogg", "opus", "m4a", "aac"];
const MAX_TRACKS: usize = 4000;
const MAX_DEPTH: usize = 6;
const MAX_BYTES: u64 = 250_000_000;

fn is_audio(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).map(|e| EXTS.contains(&e.to_ascii_lowercase().as_str())).unwrap_or(false)
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_DEPTH || out.len() >= MAX_TRACKS {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(kind) = e.file_type() else { continue }; // file_type() does not follow links: no loops
        let p = e.path();
        if kind.is_dir() {
            walk(&p, depth + 1, out);
        } else if kind.is_file() && is_audio(&p) && out.len() < MAX_TRACKS {
            out.push(p);
        }
    }
}

/// Every track below `root`, in folder order (case-insensitive).
pub fn scan(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk(root, 0, &mut out);
    out.sort_by_key(|p| p.to_string_lossy().to_lowercase());
    out
}

/// The bytes of `file`, but only if it is an audio file that really lives inside `root`.
pub fn read(root: &Path, file: &Path) -> Option<Vec<u8>> {
    let root = std::fs::canonicalize(root).ok()?;
    let file = std::fs::canonicalize(file).ok()?;
    if !file.starts_with(&root) || !is_audio(&file) {
        return None;
    }
    if std::fs::metadata(&file).ok()?.len() > MAX_BYTES {
        return None;
    }
    std::fs::read(&file).ok()
}

/// The standard Windows folder dialog (through PowerShell, which ships with Windows). Blocks until the
/// dialog is closed, so call it from a worker thread. None when the user cancels.
pub fn pick_folder() -> Option<String> {
    let script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; \
        $f=New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description='Choose your music folder'; \
        $o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; \
        if($f.ShowDialog($o) -eq 'OK'){ $f.SelectedPath }";
    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-STA", "-Command", script]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("peeky-music-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn scans_sorted_and_only_audio() {
        let d = tmp("scan");
        std::fs::create_dir_all(d.join("B album")).unwrap();
        std::fs::write(d.join("b.MP3"), b"x").unwrap();
        std::fs::write(d.join("A.flac"), b"x").unwrap();
        std::fs::write(d.join("notes.txt"), b"x").unwrap();
        std::fs::write(d.join("B album").join("c.ogg"), b"x").unwrap();
        let names: Vec<String> = scan(&d).iter().map(|p| p.strip_prefix(&d).unwrap().to_string_lossy().replace('\\', "/")).collect();
        assert_eq!(names, vec!["A.flac", "B album/c.ogg", "b.MP3"]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn read_stays_inside_the_folder() {
        let d = tmp("read");
        let outside = tmp("outside");
        std::fs::write(d.join("in.mp3"), b"abc").unwrap();
        std::fs::write(d.join("secret.txt"), b"nope").unwrap();
        std::fs::write(outside.join("out.mp3"), b"zzz").unwrap();
        assert_eq!(read(&d, &d.join("in.mp3")), Some(b"abc".to_vec()));
        assert_eq!(read(&d, &d.join("secret.txt")), None); // not audio
        assert_eq!(read(&d, &outside.join("out.mp3")), None); // not inside the folder
        assert_eq!(read(&d, &d.join("..").join(outside.file_name().unwrap()).join("out.mp3")), None); // ../ trick
        assert_eq!(read(&d, &d.join("missing.mp3")), None);
        let _ = std::fs::remove_dir_all(&d);
        let _ = std::fs::remove_dir_all(&outside);
    }
}
