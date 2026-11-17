const COMMANDS: &[&str] = &[
  "update",
  "play_file",
  "pause",
  "resume",
  "seek_to",
  "stop",
  "set_next",
  "state",
  "sleep_timer",
  "set_volume",
];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .build();
}
