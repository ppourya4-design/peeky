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
pub struct Media<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Media<R> {
  pub fn update(&self, payload: MediaStateRequest) -> crate::Result<()> {
    self
      .0
      .run_mobile_plugin("update", payload)
      .map_err(Into::into)
  }

  pub fn stop(&self) -> crate::Result<()> {
    self
      .0
      .run_mobile_plugin::<()>("stop", ())
      .map_err(Into::into)
  }
}
