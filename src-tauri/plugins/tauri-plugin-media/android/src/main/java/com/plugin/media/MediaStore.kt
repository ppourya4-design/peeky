package com.plugin.media

import android.graphics.Bitmap
import android.media.session.MediaSession

/**
 * Shared state between the plugin (fed by the WebView) and the foreground
 * service, which owns the actual [android.media.MediaPlayer]. The service is
 * the authority for playback fields (playing / position / duration); the
 * plugin writes requests (pending play, next track, sleep timer) and metadata.
 */
object MediaStore {
  // ---- current track
  @Volatile var path: String = ""
  @Volatile var title: String = ""
  @Volatile var artist: String = ""
  @Volatile var playing: Boolean = false
  @Volatile var durationMs: Long = 0
  @Volatile var positionMs: Long = 0
  @Volatile var cover: Bitmap? = null
  @Volatile var coverKey: String? = null

  // ---- one track of history, for notification / headset "previous"
  @Volatile var prevPath: String? = null
  @Volatile var prevTitle: String = ""
  @Volatile var prevArtist: String = ""

  // ---- the queued next track, set by the WebView per its queue logic
  // (shuffle picks cannot be known ahead, so JS leaves this null in shuffle
  // mode and advances itself from the "ended" event while it is alive)
  @Volatile var nextPath: String? = null
  @Volatile var nextTitle: String = ""
  @Volatile var nextArtist: String = ""

  // ---- a play request the service has not consumed yet
  @Volatile var pendingPath: String? = null
  @Volatile var pendingTitle: String = ""
  @Volatile var pendingArtist: String = ""
  @Volatile var pendingDurationMs: Long = 0
  @Volatile var pendingAutoplay: Boolean = true
  @Volatile var pendingStartMs: Long = 0

  // ---- sleep timer: SystemClock.elapsedRealtime() deadline, 0 = disarmed
  @Volatile var sleepDeadline: Long = 0

  @Volatile var session: MediaSession? = null
  @Volatile var serviceAlive: Boolean = false

  /**
   * Native -> WebView events, forwarded by the plugin as "media-action":
   * "track" (the player advanced on its own; path = the new track),
   * "ended" (finished with nothing queued), "error", "timer" (sleep timer fired).
   */
  @Volatile var onAction: ((action: String, path: String?) -> Unit)? = null

  fun hasNext(): Boolean = nextPath != null

  /** Previous restarts the track once 3s in, so it is always offered while a track is loaded. */
  fun hasPrev(): Boolean = path.isNotEmpty()

  fun clear() {
    path = ""
    title = ""
    artist = ""
    playing = false
    durationMs = 0
    positionMs = 0
    cover = null
    coverKey = null
    prevPath = null
    prevTitle = ""
    prevArtist = ""
    nextPath = null
    nextTitle = ""
    nextArtist = ""
    pendingPath = null
    sleepDeadline = 0
  }
}
