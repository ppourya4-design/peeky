package com.plugin.media

import android.graphics.Bitmap
import android.media.session.MediaSession

/**
 * Shared state between the plugin (fed by the WebView player) and the foreground
 * service (which renders the notification / media session from it).
 */
object MediaStore {
  @Volatile var title: String = ""
  @Volatile var artist: String = ""
  @Volatile var playing: Boolean = false
  @Volatile var durationMs: Long = 0
  @Volatile var positionMs: Long = 0
  @Volatile var hasNext: Boolean = true
  @Volatile var hasPrev: Boolean = true
  @Volatile var cover: Bitmap? = null
  @Volatile var coverKey: String? = null

  @Volatile var session: MediaSession? = null
  @Volatile var serviceAlive: Boolean = false

  /** Set by the plugin: forwards media actions (play/pause/next/prev/stop/seek) to the WebView. */
  @Volatile var onAction: ((action: String, seekMs: Long?) -> Unit)? = null

  fun clear() {
    title = ""
    artist = ""
    playing = false
    durationMs = 0
    positionMs = 0
    cover = null
    coverKey = null
  }
}
