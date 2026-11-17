use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

use crate::models::*;

// initializes the Kotlin plugin class
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<Media<R>> {
  #[cfg(target_os = "android")]
  let handle = api.register_android_plugin("com.plugin.media", "MediaPlugin")?;
  Ok(Media(handle))
}

/// Access to the media APIs.
///
/// The method identifiers passed to `run_mobile_plugin` are the Kotlin
/// `@Command` function names verbatim (camelCase); single-word commands read
/// the same either way, multi-word ones must match the Kotlin side exactly.
pub struct Media<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Media<R> {
  pub fn update(&self, payload: MediaStateRequest) -> crate::Result<()> {
    self
      .0
      .run_mobile_plugin("update", payload)
      .map_err(Into::into)
  }

  pub fn play_file(&self, payload: PlayFileRequest) -> crate::Result<()> {
    self
      .0
      .run_mobile_plugin("playFile", payload)
      .map_err(Into::into)
  }

  pub fn pause(&self) -> crate::Result<()> {
    self
      .0
      .run_mobile_plugin::<()>("pause", ())
      .map_err(Into::into)
  }

  pub fn resume(&self) -> crate::Result<()> {
    self
      .0
      .run_mobile_plugin::<()>("resume", ())
      .map_err(Into::into)
  }

  pub fn seek_to(&self, payload: SeekRequest) -> crate::Result<()> {
    self
      .0
      .run_mobile_plugin("seekTo", payload)
      .map_err(Into::into)
  }

  pub fn stop(&self) -> crate::Result<()> {
    self
      .0
      .run_mobile_plugin::<()>("stop", ())
      .map_err(Into::into)
  }

  pub fn set_next(&self, payload: SetNextRequest) -> crate::Result<()> {
    self
      .0
      .run_mobile_plugin("setNext", payload)
      .map_err(Into::into)
  }

  pub fn state(&self) -> crate::Result<PlayerState> {
    self
      .0
      .run_mobile_plugin("state", ())
      .map_err(Into::into)
  }

  pub fn sleep_timer(&self, payload: SleepTimerRequest) -> crate::Result<()> {
    self
      .0
      .run_mobile_plugin("sleepTimer", payload)
      .map_err(Into::into)
  }

  pub fn set_volume(&self, payload: VolumeRequest) -> crate::Result<()> {
    self
      .0
      .run_mobile_plugin("setVolume", payload)
      .map_err(Into::into)
  }
}
