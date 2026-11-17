use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

// The media notification only exists on Android; on desktop the plugin is a no-op
// (Peeky's desktop shell never registers it, this only keeps the crate compiling).
pub fn init<R: Runtime, C: DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<Media<R>> {
  Ok(Media(app.clone()))
}

/// Access to the media APIs.
pub struct Media<R: Runtime>(AppHandle<R>);

impl<R: Runtime> Media<R> {
  pub fn update(&self, _payload: MediaStateRequest) -> crate::Result<()> {
    Ok(())
  }

  pub fn stop(&self) -> crate::Result<()> {
    Ok(())
  }
}
