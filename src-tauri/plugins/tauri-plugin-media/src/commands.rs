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
pub(crate) async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<()> {
  app.media().stop()
}
