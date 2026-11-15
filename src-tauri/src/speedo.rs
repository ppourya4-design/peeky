// Speedo (a VPN client) can be driven from the pill when it is running and offers its control pipe.
//
// The pipe is \\.\pipe\speedo.control. One request per connection: a line of JSON in, a line of JSON out.
//   {"cmd":"status"}                 -> {"ok":true,"version":"4.0.4","signedIn":true,"state":"idle"|"connecting"|"connected",
//                                         "location":{"id":"..","name":"Frankfurt","code":"de"},"ip":"1.2.3.4","firewall":false}
//   {"cmd":"locations"}              -> {"ok":true,"locations":[{"id":"..","name":"..","code":"de","ping":42,"fav":true}, ...]}
//   {"cmd":"connect","id":".."}      -> {"ok":true}     (no id: the location Speedo has selected)
//   {"cmd":"disconnect"}             -> {"ok":true}
//   {"cmd":"firewall","on":true}     -> {"ok":true}
//   {"cmd":"show"}                   -> {"ok":true}     (bring Speedo's own window up)
// A failure is {"ok":false,"error":"..."}.
use std::io::{BufRead, BufReader, Write};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::sys;

const PIPE: &str = r"\\.\pipe\speedo.control";

fn ask(req: &Value) -> Option<Value> {
    let mut pipe = None;
    for _ in 0..4 {
        match std::fs::OpenOptions::new().read(true).write(true).open(PIPE) {
            Ok(f) => {
                pipe = Some(f);
                break;
            }
            Err(e) if e.raw_os_error() == Some(231) => std::thread::sleep(Duration::from_millis(60)), // all instances busy
            Err(_) => return None, // Speedo is not running (or is a version without the pipe)
        }
    }
    let mut pipe = pipe?;
    pipe.write_all(format!("{req}\n").as_bytes()).ok()?;
    let mut line = String::new();
    BufReader::new(pipe).read_line(&mut line).ok()?;
    serde_json::from_str(line.trim()).ok()
}
/// Never waits longer than `ms`: a stuck Speedo must not hang the pill.
pub fn call(req: Value, ms: u64) -> Option<Value> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(ask(&req));
    });
    rx.recv_timeout(Duration::from_millis(ms)).ok().flatten()
}
/// A request from the page: only the known commands, with only their own fields.
pub fn command(cmd: &str, id: Option<String>, on: Option<bool>) -> Value {
    let req = match cmd {
        "status" | "locations" | "disconnect" | "show" => json!({ "cmd": cmd }),
        "connect" => match id.filter(|i| !i.is_empty() && i.len() < 200) {
            Some(i) => json!({ "cmd": "connect", "id": i }),
            None => json!({ "cmd": "connect" }),
        },
        "firewall" => json!({ "cmd": "firewall", "on": on.unwrap_or(false) }),
        _ => return json!({ "ok": false, "error": "unknown command" }),
    };
    call(req, if cmd == "locations" { 6000 } else { 4000 }).unwrap_or_else(|| json!({ "ok": false, "error": "Speedo did not answer" }))
}
/// Watches whether Speedo is there and what it is doing; the page hears about every change.
pub fn start() {
    std::thread::spawn(|| {
        let mut last = String::new();
        let mut n = 0u32;
        loop {
            n += 1;
            if n % 8 == 0 {
                last.clear(); // say it again now and then: the page may have missed it (it loads after this thread starts)
            }
            let mut st = call(json!({ "cmd": "status" }), 2500).filter(|v| v["ok"] == true).unwrap_or_else(|| json!({}));
            let present = st.get("state").is_some();
            st["present"] = present.into();
            let key = st.to_string();
            if key != last {
                last = key;
                sys::emit("speedo", st);
            }
            std::thread::sleep(Duration::from_millis(if present { 1500 } else { 4000 }));
        }
    });
}
