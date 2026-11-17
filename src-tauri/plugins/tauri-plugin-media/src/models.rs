use serde::{Deserialize, Serialize};

/// Metadata for the media notification / session, pushed when a track starts or
/// when better tags arrive. Playback state itself is owned by the native player
/// and is NOT part of this payload. `cover` is base64 image data and only
/// travels when the cover changes (see `cover_key`); `cover_key` identifies the
/// cover the payload refers to ("" when the track has none).
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaStateRequest {
  pub title: String,
  pub artist: String,
  pub duration_ms: i64,
  pub cover: Option<String>,
  pub cover_key: Option<String>,
}

/// Start a track in the native player (the foreground service's MediaPlayer).
/// The command rejects when the file cannot be read, so the UI can skip it.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayFileRequest {
  pub path: String,
  pub title: String,
  pub artist: String,
  pub duration_ms: i64,
  pub autoplay: bool,
  pub start_position_ms: i64,
  pub cover: Option<String>,
  pub cover_key: Option<String>,
}

/// The track the native player should advance to when the current one ends
/// (repeat-one sends the same track again). `path: null` clears the
/// queue-ahead; with nothing queued, completion just stops.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetNextRequest {
  pub path: Option<String>,
  pub title: String,
  pub artist: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeekRequest {
  pub position_ms: i64,
}

/// Arm the sleep timer (minutes from now); 0 disarms it.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepTimerRequest {
  pub minutes: i64,
}

/// Set the media-stream volume, as a percentage of its maximum.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeRequest {
  pub level: i64,
}

/// A snapshot of the native player, returned by the `state` command.
/// `sleep_timer_remaining_ms` is -1 when no timer is armed; `volume` is the
/// media-stream volume as a percentage of its maximum.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
  pub playing: bool,
  pub position_ms: i64,
  pub duration_ms: i64,
  pub path: Option<String>,
  pub title: String,
  pub artist: String,
  pub sleep_timer_remaining_ms: i64,
  pub volume: i64,
}
