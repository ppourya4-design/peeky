use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::Media;
#[cfg(mobile)]
use mobile::Media;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the media APIs.
pub trait MediaExt<R: Runtime> {
  fn media(&self) -> &Media<R>;
}

impl<R: Runtime, T: Manager<R>> crate::MediaExt<R> for T {
  fn media(&self) -> &Media<R> {
    self.state::<Media<R>>().inner()
  }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("media")
    .invoke_handler(tauri::generate_handler![
      commands::update,
      commands::play_file,
      commands::pause,
      commands::resume,
      commands::seek_to,
      commands::stop,
      commands::set_next,
      commands::state,
      commands::sleep_timer,
      commands::set_volume
    ])
    .setup(|app, api| {
      #[cfg(mobile)]
      let media = mobile::init(app, api)?;
      #[cfg(desktop)]
      let media = desktop::init(app, api)?;
      app.manage(media);
      Ok(())
    })
    .build()
}
