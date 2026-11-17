package com.plugin.media

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.MediaPlayer
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import java.io.File

/**
 * Foreground service that OWNS playback: a native [MediaPlayer] lives here,
 * so the music keeps playing when the app is swiped from recents and the
 * WebView is destroyed (the v2/v3 design played through a WebView <audio>
 * element and only mirrored state here — killing the task killed the sound).
 *
 * The WebView sends commands through the plugin (play_file / pause / ...);
 * queue logic (shuffle, repeat, ordering) stays in the WebView, which arms
 * exactly one track ahead via MediaStore.nextPath. MediaSession callbacks
 * (notification, lock screen, Bluetooth, headset) act directly on the player
 * and notify the WebView through MediaStore.onAction so a live UI stays in
 * sync; a reopened UI re-syncs from the `state` command instead.
 */
class MediaService : Service() {
  private var session: MediaSession? = null
  private var player: MediaPlayer? = null
  private var audioManager: AudioManager? = null
  private var focusRequest: AudioFocusRequest? = null
  private var resumeOnGain = false
  private var ducked = false
  private var noisyReceiver: BroadcastReceiver? = null

  // ---- auto-resume after process death (see PlaybackPersist): the intent
  // flag is kept apart from MediaStore.playing — a transient focus pause
  // keeps it true, a user pause / stop / playlist end / error clears it
  private var persistWasPlaying = false
  private var lastPersistAt = 0L

  private val handler = Handler(Looper.getMainLooper())
  private val ticker = object : Runnable {
    override fun run() {
      tick()
      handler.postDelayed(this, 1000)
    }
  }

  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    when (change) {
      AudioManager.AUDIOFOCUS_LOSS -> {
        resumeOnGain = false
        pausePlayback(abandon = false)
      }
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
        resumeOnGain = MediaStore.playing
        pausePlayback(abandon = false, resumeAfterDeath = true)
      }
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
        ducked = true
        try {
          player?.setVolume(0.2f, 0.2f)
        } catch (e: Exception) {
          // player went away mid-duck; nothing to restore on
        }
      }
      AudioManager.AUDIOFOCUS_GAIN -> {
        if (ducked) {
          ducked = false
          try {
            player?.setVolume(1f, 1f)
          } catch (e: Exception) {
            // player went away; the next one starts at full volume
          }
        }
        if (resumeOnGain) {
          resumeOnGain = false
          startPlayback()
        }
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    createChannel()
    audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    val s = MediaSession(this, "PeekyMedia")
    @Suppress("DEPRECATION")
    s.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
    s.setCallback(object : MediaSession.Callback() {
      override fun onPlay() = playCurrent()
      override fun onPause() = pausePlayback()
      override fun onSkipToNext() = skipNext()
      override fun onSkipToPrevious() = skipPrev()
      override fun onSeekTo(pos: Long) = seekTo(pos)
      override fun onStop() = stopAll()
    })
    s.isActive = true
    session = s
    MediaStore.session = s
    MediaStore.serviceAlive = true
    registerNoisy()
    handler.post(ticker)
    goForeground()
    applyState()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // a play request from the plugin takes effect before anything else
    val pending = MediaStore.pendingPath
    if (pending != null) {
      MediaStore.pendingPath = null
      loadTrack(
        pending,
        MediaStore.pendingTitle,
        MediaStore.pendingArtist,
        MediaStore.pendingDurationMs,
        MediaStore.pendingAutoplay,
        MediaStore.pendingStartMs
      )
    } else if (player == null && MediaStore.path.isEmpty()) {
      // Fresh process: the system killed us (recents swipe / LMK) and either
      // START_STICKY (null intent) or the onTaskRemoved alarm brought us
      // back. The in-memory store starts empty, so resume the persisted
      // playback if it was playing when we died. Nothing persisted as
      // playing -> a restart-only start (null intent / the alarm) is the
      // old zombie case (nothing can actually play): stop instead of
      // posting a dead notification.
      if (!tryResumeFromPersist() && (intent == null || intent.action == ACTION_RESUME)) {
        stopSelf()
        return START_NOT_STICKY
      }
    }
    when (intent?.action) {
      ACTION_PLAY -> playCurrent()
      ACTION_PAUSE -> pausePlayback()
      ACTION_NEXT -> skipNext()
      ACTION_PREV -> skipPrev()
      ACTION_STOP -> {
        stopAll()
        return START_NOT_STICKY
      }
      ACTION_SEEK -> {
        val pos = intent.getLongExtra(EXTRA_SEEK, -1L)
        if (pos >= 0) seekTo(pos)
      }
      // ACTION_UPDATE / ACTION_TIMER / ACTION_RESUME / null: state already reflects the change
    }
    // (re)post the foreground notification with the freshest state
    goForeground()
    applyState()
    return START_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // The app was swiped from recents. The manifest sets stopWithTask=false
    // and the player lives in this service, so nothing stops: just re-assert
    // the foreground state and let the music play on.
    try {
      goForeground()
      applyState()
    } catch (e: Exception) {
      // if the promotion fails the system may still keep the service; never crash here
    }
    // Belt-and-braces for OEM task killers: if the process is reaped anyway,
    // this alarm restarts the service ~1.5s later and onStartCommand
    // auto-resumes from the persisted snapshot (the START_STICKY restart is
    // the other path to the same resume).
    scheduleRestart()
    super.onTaskRemoved(rootIntent)
  }

  private fun scheduleRestart() {
    try {
      val am = getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      val i = Intent(this, MediaService::class.java).setAction(ACTION_RESUME)
      val pi = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        PendingIntent.getForegroundService(
          this, REQ_RESTART, i,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      } else {
        PendingIntent.getService(
          this, REQ_RESTART, i,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      }
      am.setAndAllowWhileIdle(
        AlarmManager.ELAPSED_REALTIME_WAKEUP,
        SystemClock.elapsedRealtime() + 1500, pi
      )
    } catch (e: Exception) {
      // OEM alarm restrictions: the sticky restart remains as the fallback
    }
  }

  // ------------------------------------------------------------ persistence

  /**
   * Snapshot the playback state so a fresh process can resume it. Forced on
   * every transition; the ticker's calls are throttled to one write per 5s
   * (position freshness is all they add).
   */
  private fun persistSnapshot(force: Boolean = false) {
    val now = SystemClock.elapsedRealtime()
    if (!force && now - lastPersistAt < 5000) return
    lastPersistAt = now
    PlaybackPersist.save(
      applicationContext,
      PlaybackPersist.Snapshot(
        path = MediaStore.path,
        title = MediaStore.title,
        artist = MediaStore.artist,
        positionMs = MediaStore.positionMs,
        wasPlaying = persistWasPlaying,
        nextPath = MediaStore.nextPath,
        nextTitle = MediaStore.nextTitle,
        nextArtist = MediaStore.nextArtist
      )
    )
  }

  /**
   * Bring back the persisted playback in a fresh process. Only a record
   * that was playing (or transiently focus-paused) when the old process
   * died resumes — a user pause / stop / playlist end persisted false.
   * The resumed track lands in the store through loadTrack(), so the
   * WebView's `state` adopt path picks it up like any native advance.
   */
  private fun tryResumeFromPersist(): Boolean {
    val snap = PlaybackPersist.read(applicationContext)
    if (!snap.wasPlaying || snap.path.isEmpty()) return false
    if (!File(snap.path).canRead()) {
      PlaybackPersist.clear(applicationContext)
      return false
    }
    if (snap.nextPath != null) {
      MediaStore.nextPath = snap.nextPath
      MediaStore.nextTitle = snap.nextTitle
      MediaStore.nextArtist = snap.nextArtist
    }
    Log.i(TAG, "auto-resume after process death: ${snap.path} at ${snap.positionMs}ms")
    loadTrack(snap.path, snap.title, snap.artist, 0, true, snap.positionMs)
    return true
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
    handler.removeCallbacks(ticker)
    unregisterNoisy()
    abandonFocus()
    releasePlayer()
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

  // ------------------------------------------------------------ the player

  private fun loadTrack(
    path: String,
    title: String,
    artist: String,
    durHint: Long,
    autoplay: Boolean,
    startMs: Long
  ) {
    if (MediaStore.path.isNotEmpty() && MediaStore.path != path) {
      MediaStore.prevPath = MediaStore.path
      MediaStore.prevTitle = MediaStore.title
      MediaStore.prevArtist = MediaStore.artist
    }
    MediaStore.path = path
    MediaStore.title = title
    MediaStore.artist = artist
    MediaStore.durationMs = durHint
    MediaStore.positionMs = startMs
    MediaStore.playing = false
    persistWasPlaying = autoplay   // a track cued paused must not auto-play after a process death
    persistSnapshot(force = true)
    releasePlayer()
    val p = MediaPlayer()
    player = p
    p.setAudioAttributes(
      AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()
    )
    p.setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
    p.setOnPreparedListener { mp ->
      if (player !== mp) return@setOnPreparedListener
      try {
        MediaStore.durationMs = mp.duration.toLong()
      } catch (e: Exception) {
        // keep the hint
      }
      if (startMs > 0) {
        try {
          mp.seekTo(startMs.toInt())
        } catch (e: Exception) {
          // start from the top instead
        }
      }
      if (autoplay) startPlayback() else applyState()
    }
    p.setOnCompletionListener { mp -> if (player === mp) onCompletion() }
    p.setOnErrorListener { mp, what, extra ->
      if (player === mp) onPlayerError(what, extra)
      true
    }
    try {
      p.setDataSource(path)
      p.prepareAsync()
    } catch (e: Exception) {
      onPlayerError(0, 0)
    }
    applyState()
  }

  private fun playCurrent() {
    if (player != null) {
      startPlayback()
    } else if (MediaStore.path.isNotEmpty()) {
      // e.g. after a player error: reload the current track from where it stopped
      loadTrack(
        MediaStore.path, MediaStore.title, MediaStore.artist,
        MediaStore.durationMs, true, MediaStore.positionMs
      )
    }
  }

  private fun startPlayback() {
    val p = player ?: return
    if (!requestFocus()) return   // e.g. a call holds the focus: stay paused
    try {
      p.start()
    } catch (e: IllegalStateException) {
      return
    }
    MediaStore.playing = true
    persistWasPlaying = true
    persistSnapshot(force = true)
    applyState()
  }

  /**
   * [resumeAfterDeath] is true only for a transient audio-focus pause: the
   * user never asked for this stop, so if the process dies mid-pause the
   * persisted snapshot still counts as "was playing" and auto-resumes.
   * Every other caller (user pause, noisy, sleep timer, permanent focus
   * loss) persists false.
   */
  private fun pausePlayback(abandon: Boolean = true, resumeAfterDeath: Boolean = false) {
    try {
      if (player?.isPlaying == true) player?.pause()
    } catch (e: IllegalStateException) {
      // player mid-teardown
    }
    MediaStore.playing = false
    syncPosition()
    persistWasPlaying = resumeAfterDeath
    persistSnapshot(force = true)
    if (abandon) abandonFocus()
    applyState()
  }

  private fun seekTo(posMs: Long) {
    val p = player ?: return
    try {
      p.seekTo(posMs.coerceAtLeast(0L).toInt())
    } catch (e: IllegalStateException) {
      return
    }
    MediaStore.positionMs = posMs
    persistSnapshot(force = true)
    applyState()
  }

  /** Advance to the queued next track, if any. Returns false when nothing is queued. */
  private fun advanceToNext(): Boolean {
    val np = MediaStore.nextPath ?: return false
    val t = MediaStore.nextTitle
    val a = MediaStore.nextArtist
    MediaStore.nextPath = null
    MediaStore.nextTitle = ""
    MediaStore.nextArtist = ""
    loadTrack(np, t, a, 0, true, 0)
    MediaStore.onAction?.invoke("track", np)
    return true
  }

  private fun skipNext() {
    advanceToNext()   // nothing queued: the WebView's queue logic owns wrap/shuffle
  }

  private fun skipPrev() {
    syncPosition()
    if (MediaStore.positionMs > 3000 || MediaStore.prevPath == null) {
      seekTo(0)
      return
    }
    // loadTrack() records the outgoing track as both history and (via the
    // store) the way back; one-deep history is all we keep natively.
    loadTrack(MediaStore.prevPath!!, MediaStore.prevTitle, MediaStore.prevArtist, 0, true, 0)
    MediaStore.onAction?.invoke("track", MediaStore.path)
  }

  private fun onCompletion() {
    MediaStore.playing = false
    if (!advanceToNext()) {
      // playlist over: a later process death must not resurrect a finished track
      MediaStore.positionMs = MediaStore.durationMs
      persistWasPlaying = false
      persistSnapshot(force = true)
      applyState()
      MediaStore.onAction?.invoke("ended", null)
    }
  }

  private fun onPlayerError(what: Int, extra: Int) {
    releasePlayer()
    MediaStore.playing = false
    persistWasPlaying = false
    persistSnapshot(force = true)
    applyState()
    MediaStore.onAction?.invoke("error", null)
  }

  /** Stop playback entirely and leave the foreground (notification close / JS stop). */
  private fun stopAll() {
    abandonFocus()
    releasePlayer()
    persistWasPlaying = false
    PlaybackPersist.clear(applicationContext)
    MediaStore.clear()
    @Suppress("DEPRECATION")
    stopForeground(true)
    stopSelf()
  }

  private fun releasePlayer() {
    try {
      player?.release()
    } catch (e: Exception) {
      // already gone
    }
    player = null
    ducked = false
  }

  // ------------------------------------------------------------ audio focus + noisy

  private fun requestFocus(): Boolean {
    val am = audioManager ?: return true
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      if (focusRequest == null) {
        focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_MEDIA)
              .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
              .build()
          )
          .setOnAudioFocusChangeListener(focusListener, handler)
          .build()
      }
      am.requestAudioFocus(focusRequest!!) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    } else {
      @Suppress("DEPRECATION")
      am.requestAudioFocus(
        focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN
      ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }
  }

  private fun abandonFocus() {
    val am = audioManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let {
        try {
          am.abandonAudioFocusRequest(it)
        } catch (e: Exception) {
          // not held
        }
      }
    } else {
      @Suppress("DEPRECATION")
      am.abandonAudioFocus(focusListener)
    }
    resumeOnGain = false
  }

  private fun registerNoisy() {
    if (noisyReceiver != null) return
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) pausePlayback()
      }
    }
    try {
      registerReceiver(r, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
      noisyReceiver = r
    } catch (e: Exception) {
      // receiver registration is best-effort
    }
  }

  private fun unregisterNoisy() {
    noisyReceiver?.let {
      try {
        unregisterReceiver(it)
      } catch (e: Exception) {
        // already unregistered
      }
    }
    noisyReceiver = null
  }

  // ------------------------------------------------------------ state + notification

  /** Once a second: keep the store's position honest and fire the sleep timer. */
  private fun tick() {
    syncPosition()
    val dl = MediaStore.sleepDeadline
    if (dl > 0 && SystemClock.elapsedRealtime() >= dl) {
      MediaStore.sleepDeadline = 0
      pausePlayback()
      MediaStore.onAction?.invoke("timer", null)
    }
    persistSnapshot()   // throttled to 5s inside: keeps the death-resume position fresh
    if (MediaStore.playing) applyState()   // advances the One UI progress bar
  }

  private fun syncPosition() {
    val p = player ?: return
    try {
      MediaStore.positionMs = p.currentPosition.toLong()
      MediaStore.playing = p.isPlaying
    } catch (e: IllegalStateException) {
      // player is mid-reset; the next tick sees a consistent state
    }
  }

  /** Push MediaStore into the session (metadata + playback state) and refresh the notification. */
  private fun applyState() {
    val s = session ?: return
    val md = MediaMetadata.Builder()
      .putString(MediaMetadata.METADATA_KEY_TITLE, MediaStore.title)
      .putString(MediaMetadata.METADATA_KEY_ARTIST, MediaStore.artist)
      .putLong(MediaMetadata.METADATA_KEY_DURATION, MediaStore.durationMs)
    MediaStore.cover?.let {
      md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it)
      md.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, it)
    }
    s.setMetadata(md.build())

    var actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
      PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP or PlaybackState.ACTION_SEEK_TO
    if (MediaStore.hasNext()) actions = actions or PlaybackState.ACTION_SKIP_TO_NEXT
    if (MediaStore.hasPrev()) actions = actions or PlaybackState.ACTION_SKIP_TO_PREVIOUS
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
    b.setDeleteIntent(actionIntent(ACTION_STOP, 5))

    // the standard player row — prev / play-pause / next — always present
    // while a track is loaded, always the compact actions (One UI / Spotify
    // layout). Prev restarts or steps back through the 1-deep history; next
    // plays the armed track and is a no-op at the end of the queue.
    val acts = listOf(
      Notification.Action.Builder(
        android.R.drawable.ic_media_previous, "Previous", actionIntent(ACTION_PREV, 1)
      ).build(),
      if (MediaStore.playing)
        Notification.Action.Builder(
          android.R.drawable.ic_media_pause, "Pause", actionIntent(ACTION_PAUSE, 2)
        ).build()
      else
        Notification.Action.Builder(
          android.R.drawable.ic_media_play, "Play", actionIntent(ACTION_PLAY, 3)
        ).build(),
      Notification.Action.Builder(
        android.R.drawable.ic_media_next, "Next", actionIntent(ACTION_NEXT, 4)
      ).build()
    )
    acts.forEach { b.addAction(it) }

    val style = Notification.MediaStyle()
      .setMediaSession(session?.sessionToken)
      .setShowActionsInCompactView(0, 1, 2)

    // rebuilt from the store on every applyState(), so a metadata change
    // (better tags arriving) reposts it whole — no stale title/artist/art
    b.setSmallIcon(R.drawable.ic_stat_peeky)
      .setContentTitle(MediaStore.title.ifEmpty { "Peeky" })
      .setContentText(MediaStore.artist)
      .setStyle(style)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      // ongoing only while playing: a paused card can be swiped away, and
      // the delete intent then stops the service (the v4 colour tint is
      // gone — colorized cards read muddy on One UI's media panel)
      .setOngoing(MediaStore.playing)
      .setShowWhen(false)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setColorized(false)
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
    private const val TAG = "PeekyMedia"
    private const val NOTIF_ID = 4711
    private const val CHANNEL_ID = "peeky-playback"
    private const val REQ_RESTART = 77
    private const val EXTRA_SEEK = "com.plugin.media.SEEK_MS"
    const val ACTION_UPDATE = "com.plugin.media.UPDATE"
    const val ACTION_RESUME = "com.plugin.media.RESUME"
    const val ACTION_PLAY = "com.plugin.media.PLAY"
    const val ACTION_PAUSE = "com.plugin.media.PAUSE"
    const val ACTION_NEXT = "com.plugin.media.NEXT"
    const val ACTION_PREV = "com.plugin.media.PREV"
    const val ACTION_STOP = "com.plugin.media.STOP"
    const val ACTION_SEEK = "com.plugin.media.SEEK"
    const val ACTION_TIMER = "com.plugin.media.TIMER"

    /**
     * Start the service if needed and poke it to consume pending state.
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

    /** Send a control action to the running service; a no-op while it is down. */
    fun poke(ctx: Context, action: String, seekMs: Long = -1L) {
      if (!MediaStore.serviceAlive) return
      val i = Intent(ctx, MediaService::class.java).setAction(action)
      if (seekMs >= 0) i.putExtra(EXTRA_SEEK, seekMs)
      try {
        ctx.startService(i)
      } catch (e: Exception) {
        // service is going away; the command is moot
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
      PlaybackPersist.clear(ctx)
    }
  }
}
