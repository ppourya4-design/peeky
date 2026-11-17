use tauri::{AppHandle, Runtime};

use crate::models::*;
use crate::MediaExt;
use crate::Result;

#[tauri::command]
pub(crate) async fn update<R: Runtime>(
  app: AppHandle<R>,
  payload: MediaStateRequest,
) -> Result<()> {
  app.media().update(payload)
}

#[tauri::command]
pub(crate) async fn play_file<R: Runtime>(
  app: AppHandle<R>,
  payload: PlayFileRequest,
) -> Result<()> {
  app.media().play_file(payload)
}

#[tauri::command]
pub(crate) async fn pause<R: Runtime>(app: AppHandle<R>) -> Result<()> {
  app.media().pause()
}

#[tauri::command]
pub(crate) async fn resume<R: Runtime>(app: AppHandle<R>) -> Result<()> {
  app.media().resume()
}

#[tauri::command]
pub(crate) async fn seek_to<R: Runtime>(
  app: AppHandle<R>,
  payload: SeekRequest,
) -> Result<()> {
  app.media().seek_to(payload)
}

#[tauri::command]
pub(crate) async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<()> {
  app.media().stop()
}

#[tauri::command]
pub(crate) async fn set_next<R: Runtime>(
  app: AppHandle<R>,
  payload: SetNextRequest,
) -> Result<()> {
  app.media().set_next(payload)
}

#[tauri::command]
pub(crate) async fn state<R: Runtime>(app: AppHandle<R>) -> Result<PlayerState> {
  app.media().state()
}

#[tauri::command]
pub(crate) async fn sleep_timer<R: Runtime>(
  app: AppHandle<R>,
  payload: SleepTimerRequest,
) -> Result<()> {
  app.media().sleep_timer(payload)
}

#[tauri::command]
pub(crate) async fn set_volume<R: Runtime>(
  app: AppHandle<R>,
  payload: VolumeRequest,
) -> Result<()> {
  app.media().set_volume(payload)
}
