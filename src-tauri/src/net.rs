// Slow facts about the machine that the pill mentions when they change: is the internet reachable, is a VPN
// or a system proxy on, and is some program using the microphone or the camera right now.
use std::ffi::c_void;

use serde_json::json;
use windows::core::{HSTRING, PCWSTR, PWSTR};
use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation};
use windows::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_SUCCESS};
use windows::Win32::NetworkManagement::IpHelper::{GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH};
use windows::Win32::System::Registry::*;

use crate::{settings, sys};

// ---------------------------------------------------------------- internet / VPN / proxy
const VPN_WORDS: [&str; 26] = [
    "wireguard", "wintun", "openvpn", "tap-", "vpn", "warp", "sing-box", "singbox", "tun2", "v2ray", "xray", "clash", "mihomo", "nekoray", "nekobox",
    "hiddify", "tailscale", "zerotier", "proton", "nord", "outline", "forti", "anyconnect", "softether", "psiphon", "sstp",
];

fn online() -> bool {
    NetworkInformation::GetInternetConnectionProfile().and_then(|p| p.GetNetworkConnectivityLevel()).map(|l| l == NetworkConnectivityLevel::InternetAccess).unwrap_or(false)
}
/// The name of a network adapter that is up and looks like a VPN tunnel ("" when there is none).
unsafe fn vpn() -> String {
    let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
    let mut size = 32 * 1024u32;
    let mut buf: Vec<u64> = Vec::new();
    for _ in 0..3 {
        buf = vec![0u64; size as usize / 8 + 1];
        let r = GetAdaptersAddresses(0, flags, None, Some(buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH), &mut size);
        if r == ERROR_SUCCESS.0 {
            break;
        }
        if r != ERROR_BUFFER_OVERFLOW.0 {
            return String::new();
        }
    }
    let text = |p: PWSTR| if p.is_null() { String::new() } else { p.to_string().unwrap_or_default() };
    let mut a = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
    while !a.is_null() {
        let ad = &*a;
        a = ad.Next;
        if ad.OperStatus.0 != 1 || ad.IfType == 24 {
            continue; // down, or loopback
        }
        let (name, desc) = (text(ad.FriendlyName), text(ad.Description));
        let both = format!("{name} {desc}").to_lowercase();
        if both.contains("teredo") || both.contains("isatap") || both.contains("6to4") || both.contains("vethernet") || both.contains("hyper-v") || both.contains("bluetooth") {
            continue;
        }
        if ad.IfType == 23 || VPN_WORDS.iter().any(|w| both.contains(w)) {
            return if name.is_empty() { desc } else { name };
        }
    }
    String::new()
}
unsafe fn proxy() -> bool {
    let mut v = 0u32;
    let mut n = 4u32;
    let r = RegGetValueW(HKEY_CURRENT_USER, &HSTRING::from("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"), &HSTRING::from("ProxyEnable"), RRF_RT_REG_DWORD, None, Some(&mut v as *mut u32 as *mut c_void), Some(&mut n));
    r == ERROR_SUCCESS && v != 0
}

// ---------------------------------------------------------------- microphone / camera in use
// Windows keeps, per program, when it last started and stopped using each device; "stopped = 0" means "still on".
unsafe fn subkeys(key: HKEY) -> Vec<String> {
    let mut out = Vec::new();
    for i in 0..400u32 {
        let mut name = [0u16; 512];
        let mut n = name.len() as u32;
        if RegEnumKeyExW(key, i, Some(PWSTR(name.as_mut_ptr())), &mut n, None, None, None, None) != ERROR_SUCCESS {
            break;
        }
        out.push(String::from_utf16_lossy(&name[..n as usize]));
    }
    out
}
unsafe fn open(parent: HKEY, path: &str) -> Option<HKEY> {
    let mut k = HKEY::default();
    let p = HSTRING::from(path);
    (RegOpenKeyExW(parent, PCWSTR(p.as_ptr()), None, KEY_READ, &mut k) == ERROR_SUCCESS).then_some(k)
}
unsafe fn qword(key: HKEY, sub: &str, value: &str) -> Option<u64> {
    let mut v = 0u64;
    let mut n = 8u32;
    let r = RegGetValueW(key, &HSTRING::from(sub), &HSTRING::from(value), RRF_RT_REG_QWORD, None, Some(&mut v as *mut u64 as *mut c_void), Some(&mut n));
    (r == ERROR_SUCCESS).then_some(v)
}
fn pretty(key: &str) -> String {
    if key.contains('#') {
        // a desktop program: its path with # for \
        let file = key.rsplit('#').next().unwrap_or(key);
        return file.trim_end_matches(".exe").trim_end_matches(".EXE").to_string();
    }
    // a Store app: Publisher.Name_hash
    let base = key.split('_').next().unwrap_or(key);
    base.rsplit('.').next().unwrap_or(base).to_string()
}
unsafe fn in_use(device: &str) -> Vec<String> {
    let mut out = Vec::new();
    let Some(root) = open(HKEY_CURRENT_USER, &format!("Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\{device}")) else { return out };
    let mut scan = |key: HKEY| {
        for name in subkeys(key) {
            if name == "NonPackaged" {
                continue;
            }
            if qword(key, &name, "LastUsedTimeStop") == Some(0) && qword(key, &name, "LastUsedTimeStart").unwrap_or(0) != 0 {
                let p = pretty(&name);
                if !out.contains(&p) {
                    out.push(p);
                }
            }
        }
    };
    scan(root);
    if let Some(np) = open(root, "NonPackaged") {
        scan(np);
        let _ = RegCloseKey(np);
    }
    let _ = RegCloseKey(root);
    out
}

pub struct Watch {
    net: Option<(bool, String, bool)>,
    net_seen: Option<(bool, String, bool)>,
    sensors: Option<(Vec<String>, Vec<String>)>,
}
impl Watch {
    pub fn new() -> Self {
        Self { net: None, net_seen: None, sensors: None }
    }
    /// Called every couple of seconds. A network change is reported once two polls in a row agree.
    pub fn poll_net(&mut self) {
        if !settings::flag("netAlerts") {
            self.net = None;
            self.net_seen = None;
            return;
        }
        let now = unsafe { (online(), vpn(), proxy()) };
        if self.net.as_ref() != Some(&now) && (self.net_seen.as_ref() == Some(&now) || self.net.is_none()) {
            let first = self.net.is_none();
            sys::helper(json!({ "t": "net", "online": now.0, "vpn": now.1, "proxy": now.2, "first": first }));
            self.net = Some(now.clone());
        }
        self.net_seen = Some(now);
    }
    pub fn poll_sensors(&mut self) {
        if !settings::flag("sensorDot") {
            if self.sensors.take().is_some() {
                sys::helper(json!({ "t": "sensors", "mic": [], "cam": [] }));
            }
            return;
        }
        let now = unsafe { (in_use("microphone"), in_use("webcam")) };
        if self.sensors.as_ref() != Some(&now) {
            sys::helper(json!({ "t": "sensors", "mic": now.0, "cam": now.1 }));
            self.sensors = Some(now);
        }
    }
}
