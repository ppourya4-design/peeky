package com.plugin.media

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.os.SystemClock
import android.util.Base64
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import kotlin.math.roundToInt

@InvokeArg
class UpdateArgs {
  var title: String? = null
  var artist: String? = null
  var durationMs: Long = 0
  var cover: String? = null
  var coverKey: String? = null
}

@InvokeArg
class PlayFileArgs {
  var path: String? = null
  var title: String? = null
  var artist: String? = null
  var durationMs: Long = 0
  var autoplay: Boolean = true
  var startPositionMs: Long = 0
  var cover: String? = null
  var coverKey: String? = null
}

@InvokeArg
class SetNextArgs {
  var path: String? = null
  var title: String? = null
  var artist: String? = null
}

@InvokeArg
class SeekArgs {
  var positionMs: Long = 0
}

@InvokeArg
class SleepTimerArgs {
  var minutes: Long = 0
}

@InvokeArg
class VolumeArgs {
  var level: Long = 0
}

/**
 * Tauri side of the native player. The WebView sends commands (play_file,
 * pause, ...); playback itself lives in [MediaService]'s MediaPlayer, so it
 * survives the WebView / task being destroyed. Player-initiated changes come
 * back as "media-action" events (register a listener for that event name).
 *
 * The @Command function names are what the Rust side passes to
 * run_mobile_plugin, verbatim — keep them in sync with src/mobile.rs.
 */
@TauriPlugin
class MediaPlugin(private val activity: Activity) : Plugin(activity) {

  override fun load(webView: WebView) {
    MediaStore.onAction = { action, path ->
      val payload = JSObject()
      payload.put("action", action)
      if (path != null) payload.put("path", path)
      trigger("media-action", payload)
    }
  }

  private val ctx: Context get() = activity.applicationContext

  /** Metadata refresh for the track that is already loaded (better tags arrived). */
  @Command
  fun update(invoke: Invoke) {
    val args = invoke.parseArgs(UpdateArgs::class.java)
    if (MediaStore.path.isNotEmpty()) {
      MediaStore.title = args.title ?: MediaStore.title
      MediaStore.artist = args.artist ?: MediaStore.artist
      if (MediaStore.durationMs <= 0 && args.durationMs > 0) MediaStore.durationMs = args.durationMs
      applyCover(args.cover, args.coverKey)
      if (MediaStore.serviceAlive) MediaService.update(ctx)
    }
    invoke.resolve()
  }

  @Command
  fun playFile(invoke: Invoke) {
    val args = invoke.parseArgs(PlayFileArgs::class.java)
    val path = args.path ?: ""
    if (path.isEmpty() || !File(path).canRead()) {
      invoke.reject("unreadable file: $path")
      return
    }
    MediaStore.pendingPath = path
    MediaStore.pendingTitle = args.title ?: ""
    MediaStore.pendingArtist = args.artist ?: ""
    MediaStore.pendingDurationMs = args.durationMs
    MediaStore.pendingAutoplay = args.autoplay
    MediaStore.pendingStartMs = args.startPositionMs
    applyCover(args.cover, args.coverKey)
    MediaService.update(ctx)   // starts the service if needed; it consumes the pending play
    invoke.resolve()
  }

  @Command
  fun pause(invoke: Invoke) {
    MediaService.poke(ctx, MediaService.ACTION_PAUSE)
    invoke.resolve()
  }

  @Command
  fun resume(invoke: Invoke) {
    MediaService.poke(ctx, MediaService.ACTION_PLAY)
    invoke.resolve()
  }

  @Command
  fun seekTo(invoke: Invoke) {
    val args = invoke.parseArgs(SeekArgs::class.java)
    MediaService.poke(ctx, MediaService.ACTION_SEEK, args.positionMs)
    invoke.resolve()
  }

  @Command
  fun stop(invoke: Invoke) {
    MediaService.stop(ctx)
    invoke.resolve()
  }

  @Command
  fun setNext(invoke: Invoke) {
    val args = invoke.parseArgs(SetNextArgs::class.java)
    MediaStore.nextPath = args.path?.takeIf { it.isNotEmpty() }
    MediaStore.nextTitle = args.title ?: ""
    MediaStore.nextArtist = args.artist ?: ""
    invoke.resolve()
  }

  @Command
  fun state(invoke: Invoke) {
    val out = JSObject()
    out.put("playing", MediaStore.playing)
    out.put("positionMs", MediaStore.positionMs)
    out.put("durationMs", MediaStore.durationMs)
    if (MediaStore.path.isNotEmpty()) out.put("path", MediaStore.path)
    out.put("title", MediaStore.title)
    out.put("artist", MediaStore.artist)
    val dl = MediaStore.sleepDeadline
    out.put(
      "sleepTimerRemainingMs",
      if (dl > 0) maxOf(0L, dl - SystemClock.elapsedRealtime()) else -1L
    )
    out.put("volume", volumePercent())
    invoke.resolve(out)
  }

  @Command
  fun sleepTimer(invoke: Invoke) {
    val args = invoke.parseArgs(SleepTimerArgs::class.java)
    MediaStore.sleepDeadline =
      if (args.minutes > 0) SystemClock.elapsedRealtime() + args.minutes * 60_000L else 0L
    MediaService.poke(ctx, MediaService.ACTION_TIMER)
    invoke.resolve()
  }

  @Command
  fun setVolume(invoke: Invoke) {
    val args = invoke.parseArgs(VolumeArgs::class.java)
    val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    if (am != null) {
      val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      if (max > 0) {
        val level = (args.level.coerceIn(0, 100) / 100.0 * max).roundToInt().coerceIn(0, max)
        try {
          am.setStreamVolume(AudioManager.STREAM_MUSIC, level, 0)
        } catch (e: SecurityException) {
          // DND / policy restrictions: the slider simply won't stick
        }
      }
    }
    invoke.resolve()
  }

  private fun volumePercent(): Int {
    val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return 0
    val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    if (max <= 0) return 0
    return (am.getStreamVolume(AudioManager.STREAM_MUSIC) * 100.0 / max).roundToInt()
  }

  /**
   * The cover only travels when its key changes; an empty key means "no
   * cover". A cover that arrives late for the same key (the track started
   * before its tags were read) is still picked up.
   */
  private fun applyCover(b64: String?, key: String?) {
    if (key == null) return
    if (key.isEmpty()) {
      MediaStore.cover = null
      MediaStore.coverKey = key
      return
    }
    if (key != MediaStore.coverKey) {
      MediaStore.coverKey = key
      MediaStore.cover = decodeCover(b64)
    } else if (b64 != null && MediaStore.cover == null) {
      MediaStore.cover = decodeCover(b64)
    }
  }

  private fun decodeCover(b64: String?): Bitmap? {
    if (b64.isNullOrEmpty()) return null
    return try {
      val bytes = Base64.decode(b64, Base64.DEFAULT)
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (e: Exception) {
      null
    }
  }
}
