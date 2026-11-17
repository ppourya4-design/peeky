use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

// The native player only exists on Android; on desktop the plugin is a no-op
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

  pub fn play_file(&self, _payload: PlayFileRequest) -> crate::Result<()> {
    Ok(())
  }

  pub fn pause(&self) -> crate::Result<()> {
    Ok(())
  }

  pub fn resume(&self) -> crate::Result<()> {
    Ok(())
  }

  pub fn seek_to(&self, _payload: SeekRequest) -> crate::Result<()> {
    Ok(())
  }

  pub fn stop(&self) -> crate::Result<()> {
    Ok(())
  }

  pub fn set_next(&self, _payload: SetNextRequest) -> crate::Result<()> {
    Ok(())
  }

  pub fn state(&self) -> crate::Result<PlayerState> {
    Ok(PlayerState {
      playing: false,
      position_ms: 0,
      duration_ms: 0,
      path: None,
      title: String::new(),
      artist: String::new(),
      sleep_timer_remaining_ms: -1,
      volume: 0,
    })
  }

  pub fn sleep_timer(&self, _payload: SleepTimerRequest) -> crate::Result<()> {
    Ok(())
  }

  pub fn set_volume(&self, _payload: VolumeRequest) -> crate::Result<()> {
    Ok(())
  }
}
