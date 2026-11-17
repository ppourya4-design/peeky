use serde::{Deserialize, Serialize};

/// The player's state, pushed to the native media notification / media session.
/// `cover` is a base64 PNG and is only sent when the cover changes (see `cover_key`);
/// `cover_key` identifies the cover the payload refers to ("" when the track has none).
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaStateRequest {
  pub title: String,
  pub artist: String,
  pub playing: bool,
  pub duration_ms: i64,
  pub position_ms: i64,
  pub has_next: bool,
  pub has_prev: bool,
  pub cover: Option<String>,
  pub cover_key: Option<String>,
}
