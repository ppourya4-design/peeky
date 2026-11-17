package com.plugin.media

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class UpdateArgs {
  var title: String? = null
  var artist: String? = null
  var playing: Boolean = false
  var durationMs: Long = 0
  var positionMs: Long = 0
  var hasNext: Boolean = true
  var hasPrev: Boolean = true
  var cover: String? = null
  var coverKey: String? = null
}

/**
 * Tauri side of the media notification: the WebView pushes player state with
 * [update]; control actions from the notification / media session come back as
 * "media-action" events (register a listener for that event name).
 */
@TauriPlugin
class MediaPlugin(private val activity: Activity) : Plugin(activity) {

  override fun load(webView: WebView) {
    MediaStore.onAction = { action, seekMs ->
      val payload = JSObject()
      payload.put("action", action)
      if (seekMs != null) payload.put("positionMs", seekMs)
      trigger("media-action", payload)
    }
  }

  @Command
  fun update(invoke: Invoke) {
    val args = invoke.parseArgs(UpdateArgs::class.java)
    MediaStore.title = args.title ?: ""
    MediaStore.artist = args.artist ?: ""
    MediaStore.playing = args.playing
    MediaStore.durationMs = args.durationMs
    MediaStore.positionMs = args.positionMs
    MediaStore.hasNext = args.hasNext
    MediaStore.hasPrev = args.hasPrev
    // the cover only travels when its key changes; an empty key means "no cover"
    val key = args.coverKey
    if (key != null && key != MediaStore.coverKey) {
      MediaStore.coverKey = key
      MediaStore.cover = decodeCover(args.cover)
    }
    MediaService.update(activity.applicationContext)
    invoke.resolve()
  }

  @Command
  fun stop(invoke: Invoke) {
    MediaService.stop(activity.applicationContext)
    invoke.resolve()
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
