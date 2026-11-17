package ir.poyzo.peekyisland

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper

/** Snapshot of the "best" active media session (any player app). */
data class MediaState(
    val pkg: String,
    val title: String,
    val artist: String,
    val art: Bitmap?,
    val playing: Boolean,
    val positionMs: Long,
    val durationMs: Long,
    val hasNext: Boolean,
    val hasPrev: Boolean,
    /** SystemClock.elapsedRealtime() at snapshot time (same clock PlaybackState uses). */
    val updatedAt: Long = android.os.SystemClock.elapsedRealtime()
) {
    /** Position estimate right now (playback states only tick on change). */
    fun livePositionMs(): Long {
        if (!playing) return positionMs
        val est = positionMs + (android.os.SystemClock.elapsedRealtime() - updatedAt)
        return if (durationMs > 0) est.coerceAtMost(durationMs) else est
    }
}

data class MirrorItem(
    val key: String,
    val pkg: String,
    val appIcon: android.graphics.drawable.Drawable?,
    val title: String,
    val text: String,
    val progress: Int = -1, // 0..100, -1 = none
    val contentIntent: android.app.PendingIntent? = null
)

sealed interface IslandEvent {
    class MirrorPosted(val item: MirrorItem) : IslandEvent
    class MirrorRemoved(val key: String) : IslandEvent
    object SessionsChanged : IslandEvent
}

/** Same-process bus: listener service -> island service. */
object IslandBus {
    @Volatile
    var handler: ((IslandEvent) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())

    fun post(e: IslandEvent) {
        val h = handler ?: return
        main.post { h(e) }
    }
}

/**
 * Tracks active media sessions through MediaSessionManager. Access requires
 * the notification listener to be connected; [attach] is called from
 * IslandListener.onListenerConnected and quietly no-ops otherwise.
 */
object MediaHub {

    @Volatile
    var onMediaChanged: ((MediaState?) -> Unit)? = null

    private var appCtx: Context? = null
    private var controllers: List<MediaController> = emptyList()
    private var activePkg: String? = null

    private val sessionListener = MediaSessionManager.OnActiveSessionsChangedListener { list ->
        controllers = list ?: emptyList()
        registerCallbacks()
        publish()
    }

    private val controllerCallback = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) = publish()
        override fun onMetadataChanged(metadata: MediaMetadata?) = publish()
        override fun onSessionDestroyed() = publish()
    }

    @Synchronized
    fun attach(ctx: Context, listenerComponent: ComponentName) {
        appCtx = ctx.applicationContext
        val msm = ctx.getSystemService(Context.MEDIA_SESSION_SERVICE) as? MediaSessionManager
            ?: return
        try {
            msm.removeOnActiveSessionsChangedListener(sessionListener)
        } catch (_: Exception) {
        }
        try {
            msm.addOnActiveSessionsChangedListener(sessionListener, listenerComponent)
            controllers = msm.getActiveSessions(listenerComponent) ?: emptyList()
            registerCallbacks()
            publish()
        } catch (_: SecurityException) {
            // listener not (yet) enabled in system settings
        } catch (_: Exception) {
        }
    }

    private fun registerCallbacks() {
        for (c in controllers) {
            try {
                c.unregisterCallback(controllerCallback)
            } catch (_: Exception) {
            }
            try {
                c.registerCallback(controllerCallback)
            } catch (_: Exception) {
            }
        }
    }

    private fun pickController(): MediaController? {
        if (controllers.isEmpty()) return null
        // prefer the currently playing one, then the last active package, then the first
        val playing = controllers.firstOrNull {
            it.playbackState?.state == PlaybackState.STATE_PLAYING ||
                it.playbackState?.state == PlaybackState.STATE_BUFFERING
        }
        if (playing != null) {
            activePkg = playing.packageName
            return playing
        }
        val last = controllers.firstOrNull { it.packageName == activePkg }
        if (last != null) return last
        val withState = controllers.firstOrNull { it.playbackState != null }
        return withState ?: controllers.first()
    }

    fun currentState(): MediaState? {
        val c = pickController() ?: return null
        val md = c.metadata ?: return null
        val title = md.getString(MediaMetadata.METADATA_KEY_TITLE)
            ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE)
            ?: return null
        val artist = md.getString(MediaMetadata.METADATA_KEY_ARTIST)
            ?: md.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST)
            ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE)
            ?: ""
        val art = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: md.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
        val ps = c.playbackState
        val playing = ps?.state == PlaybackState.STATE_PLAYING ||
            ps?.state == PlaybackState.STATE_BUFFERING
        val actions = ps?.actions ?: 0L
        val duration = md.getLong(MediaMetadata.METADATA_KEY_DURATION).coerceAtLeast(0L)
        // PlaybackState.position is stamped at lastPositionUpdateTime; roll it forward to now.
        var pos = ps?.position ?: 0L
        if (playing && ps != null) {
            pos += android.os.SystemClock.elapsedRealtime() - ps.lastPositionUpdateTime
            if (duration > 0) pos = pos.coerceAtMost(duration)
        }
        return MediaState(
            pkg = c.packageName,
            title = cleanTitle(title),
            artist = artist,
            art = art,
            playing = playing,
            positionMs = pos.coerceAtLeast(0L),
            durationMs = duration,
            hasNext = actions and PlaybackState.ACTION_SKIP_TO_NEXT != 0L,
            hasPrev = actions and PlaybackState.ACTION_SKIP_TO_PREVIOUS != 0L,
            updatedAt = android.os.SystemClock.elapsedRealtime()
        )
    }

    private fun publish() {
        val s = try {
            currentState()
        } catch (_: Exception) {
            null
        }
        val cb = onMediaChanged ?: return
        Handler(Looper.getMainLooper()).post { cb(s) }
    }

    private fun controls(): MediaController.TransportControls? =
        try {
            pickController()?.transportControls
        } catch (_: Exception) {
            null
        }

    fun play() {
        try {
            controls()?.play()
        } catch (_: Exception) {
        }
    }

    fun pause() {
        try {
            controls()?.pause()
        } catch (_: Exception) {
        }
    }

    fun next() {
        try {
            controls()?.skipToNext()
        } catch (_: Exception) {
        }
    }

    fun prev() {
        try {
            controls()?.skipToPrevious()
        } catch (_: Exception) {
        }
    }

    fun seekTo(ms: Long) {
        try {
            controls()?.seekTo(ms)
        } catch (_: Exception) {
        }
    }

    fun activeController(): MediaController? = try {
        pickController()
    } catch (_: Exception) {
        null
    }

    /** Strip the download-site spam some files carry in their tags. */
    fun cleanTitle(raw: String): String {
        var t = raw
        t = t.replace(Regex("\\[[^\\]]*(\\.com|\\.ir|music|Music)[^\\]]*\\]"), " ")
        t = t.replace(Regex("\\(([^)]*\\.com[^)]*)\\)"), " ")
        t = t.replace(Regex("\\s+"), " ").trim()
        return t
    }
}
