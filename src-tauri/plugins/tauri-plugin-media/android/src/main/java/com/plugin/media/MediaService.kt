package com.plugin.media

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import android.os.SystemClock

/**
 * Foreground service that keeps Peeky alive in the background and renders the
 * media notification from [MediaStore]. Playback itself stays in the WebView's
 * <audio> element — this service owns the MediaSession and the notification,
 * and forwards every control action back to the WebView via MediaStore.onAction.
 */
class MediaService : Service() {
  private var session: MediaSession? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    val s = MediaSession(this, "PeekyMedia")
    @Suppress("DEPRECATION")
    s.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
    s.setCallback(object : MediaSession.Callback() {
      override fun onPlay() = dispatch("play")
      override fun onPause() = dispatch("pause")
      override fun onSkipToNext() = dispatch("next")
      override fun onSkipToPrevious() = dispatch("prev")
      override fun onSeekTo(pos: Long) = dispatch("seek", pos)
      override fun onStop() = dispatch("stop")
    })
    s.isActive = true
    session = s
    MediaStore.session = s
    MediaStore.serviceAlive = true
    goForeground()
    applyState()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // A null intent means the system restarted us (START_STICKY) after killing the
    // process. The WebView player died with that process and MediaStore starts
    // empty — there is nothing to play, so don't linger as a zombie notification.
    if (intent == null && MediaStore.title.isEmpty() && !MediaStore.playing) {
      stopSelf()
      return START_NOT_STICKY
    }
    when (intent?.action) {
      ACTION_PLAY -> dispatch("play")
      ACTION_PAUSE -> dispatch("pause")
      ACTION_NEXT -> dispatch("next")
      ACTION_PREV -> dispatch("prev")
      ACTION_STOP -> dispatch("stop")
    }
    // (re)post the foreground notification with the freshest state
    goForeground()
    applyState()
    return START_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // The app was swiped from recents. The manifest sets stopWithTask=false and
    // playback lives in this process, so nothing stops: just re-assert the
    // foreground state and let the music play on.
    try {
      goForeground()
      applyState()
    } catch (e: Exception) {
      // if the promotion fails the system may still keep the service; never crash here
    }
    super.onTaskRemoved(rootIntent)
  }

  /** Promote to foreground, passing the mediaPlayback type explicitly on API 29+. */
  private fun goForeground() {
    val n = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIF_ID, n)
    }
  }

  override fun onDestroy() {
    MediaStore.serviceAlive = false
    MediaStore.session = null
    session?.let {
      it.isActive = false
      it.release()
    }
    session = null
    @Suppress("DEPRECATION")
    stopForeground(true)
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun dispatch(action: String, seekMs: Long? = null) {
    // answer play/pause locally at once so the notification never looks stuck;
    // the WebView confirms with an authoritative state push a moment later.
    if (action == "play") MediaStore.playing = true
    if (action == "pause" || action == "stop") MediaStore.playing = false
    MediaStore.onAction?.invoke(action, seekMs)
    applyState()
  }

  /** Push MediaStore into the session (metadata + playback state) and refresh the notification. */
  private fun applyState() {
    val s = session ?: return
    val md = MediaMetadata.Builder()
      .putString(MediaMetadata.METADATA_KEY_TITLE, MediaStore.title)
      .putString(MediaMetadata.METADATA_KEY_ARTIST, MediaStore.artist)
      .putLong(MediaMetadata.METADATA_KEY_DURATION, MediaStore.durationMs)
    MediaStore.cover?.let { md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it) }
    s.setMetadata(md.build())

    var actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
      PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP or PlaybackState.ACTION_SEEK_TO
    if (MediaStore.hasNext) actions = actions or PlaybackState.ACTION_SKIP_TO_NEXT
    if (MediaStore.hasPrev) actions = actions or PlaybackState.ACTION_SKIP_TO_PREVIOUS
    s.setPlaybackState(
      PlaybackState.Builder()
        .setActions(actions)
        .setState(
          if (MediaStore.playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
          MediaStore.positionMs,
          if (MediaStore.playing) 1f else 0f,
          SystemClock.elapsedRealtime()
        )
        .build()
    )
    getSystemService(NotificationManager::class.java)?.notify(NOTIF_ID, buildNotification())
  }

  private fun actionIntent(action: String, code: Int): PendingIntent {
    val i = Intent(this, MediaService::class.java).setAction(action)
    return PendingIntent.getService(
      this, code, i,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun buildNotification(): Notification {
    @Suppress("DEPRECATION")
    val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      Notification.Builder(this, CHANNEL_ID)
    else Notification.Builder(this)

    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    if (launch != null) {
      b.setContentIntent(
        PendingIntent.getActivity(
          this, 0, launch,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      )
    }

    val acts = mutableListOf<Notification.Action>()
    if (MediaStore.hasPrev) {
      acts.add(
        Notification.Action.Builder(
          android.R.drawable.ic_media_previous, "Previous", actionIntent(ACTION_PREV, 1)
        ).build()
      )
    }
    acts.add(
      if (MediaStore.playing)
        Notification.Action.Builder(
          android.R.drawable.ic_media_pause, "Pause", actionIntent(ACTION_PAUSE, 2)
        ).build()
      else
        Notification.Action.Builder(
          android.R.drawable.ic_media_play, "Play", actionIntent(ACTION_PLAY, 3)
        ).build()
    )
    if (MediaStore.hasNext) {
      acts.add(
        Notification.Action.Builder(
          android.R.drawable.ic_media_next, "Next", actionIntent(ACTION_NEXT, 4)
        ).build()
      )
    }
    acts.forEach { b.addAction(it) }

    val style = Notification.MediaStyle().setMediaSession(session?.sessionToken)
    if (acts.isNotEmpty()) {
      style.setShowActionsInCompactView(*IntArray(minOf(acts.size, 3)) { it })
    }

    b.setSmallIcon(applicationInfo.icon)
      .setContentTitle(MediaStore.title.ifEmpty { "Peeky" })
      .setContentText(MediaStore.artist)
      .setStyle(style)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setShowWhen(false)
    MediaStore.cover?.let { b.setLargeIcon(it) }
    return b.build()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(NotificationManager::class.java) ?: return
      if (nm.getNotificationChannel(CHANNEL_ID) == null) {
        nm.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Now playing controls"
            setShowBadge(false)
          }
        )
      }
    }
  }

  companion object {
    private const val NOTIF_ID = 4711
    private const val CHANNEL_ID = "peeky-playback"
    const val ACTION_UPDATE = "com.plugin.media.UPDATE"
    const val ACTION_PLAY = "com.plugin.media.PLAY"
    const val ACTION_PAUSE = "com.plugin.media.PAUSE"
    const val ACTION_NEXT = "com.plugin.media.NEXT"
    const val ACTION_PREV = "com.plugin.media.PREV"
    const val ACTION_STOP = "com.plugin.media.STOP"

    /**
     * Start the service if needed and poke it to re-render from MediaStore.
     * Safe to call from any state: while the foreground service runs, the app
     * process counts as foreground, so startService is allowed; a failed start
     * (background restrictions) is retried by the next update from the UI.
     */
    fun update(ctx: Context) {
      val i = Intent(ctx, MediaService::class.java).setAction(ACTION_UPDATE)
      try {
        if (MediaStore.serviceAlive) ctx.startService(i)
        else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
        else ctx.startService(i)
      } catch (e: Exception) {
        // e.g. ForegroundServiceStartNotAllowedException — next foreground update retries
      }
    }

    fun stop(ctx: Context) {
      try {
        ctx.stopService(Intent(ctx, MediaService::class.java))
      } catch (e: Exception) {
        // already gone
      }
      MediaStore.serviceAlive = false
      MediaStore.clear()
    }
  }
}
