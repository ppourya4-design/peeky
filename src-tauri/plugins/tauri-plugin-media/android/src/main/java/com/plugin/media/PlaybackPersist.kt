package com.plugin.media

import android.content.Context

/**
 * The playback snapshot that survives process death, in SharedPreferences.
 *
 * [MediaStore] is in-memory: when Samsung reaps the process (recents swipe,
 * LMK), the sticky restart comes back with an empty store and v4 stopped
 * itself — the music was gone. The service now snapshots what it was doing
 * here (see MediaService.persistSnapshot), and a fresh process whose store
 * is empty auto-resumes from this record: same track, same position, the
 * armed next track re-armed.
 *
 * [Snapshot.wasPlaying] is the resume intent, NOT the live playing flag:
 * it is true only while actually playing or transiently focus-paused.
 * A user pause, a stop, the end of the playlist and a prepare error all
 * persist false (or clear the record), so a restart never starts music
 * the user had already decided to stop.
 *
 * The cover bitmap is deliberately not persisted; the WebView re-pushes
 * it via play_file / update when it returns, and the state-adopt path
 * picks the resumed track up from there.
 */
object PlaybackPersist {
  private const val PREFS = "peeky-playback"
  private const val K_PATH = "path"
  private const val K_TITLE = "title"
  private const val K_ARTIST = "artist"
  private const val K_POSITION = "positionMs"
  private const val K_WAS_PLAYING = "wasPlaying"
  private const val K_NEXT_PATH = "nextPath"
  private const val K_NEXT_TITLE = "nextTitle"
  private const val K_NEXT_ARTIST = "nextArtist"

  data class Snapshot(
    val path: String,
    val title: String,
    val artist: String,
    val positionMs: Long,
    val wasPlaying: Boolean,
    val nextPath: String?,
    val nextTitle: String,
    val nextArtist: String
  )

  fun save(ctx: Context, s: Snapshot) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString(K_PATH, s.path)
      .putString(K_TITLE, s.title)
      .putString(K_ARTIST, s.artist)
      .putLong(K_POSITION, s.positionMs)
      .putBoolean(K_WAS_PLAYING, s.wasPlaying)
      .putString(K_NEXT_PATH, s.nextPath)
      .putString(K_NEXT_TITLE, s.nextTitle)
      .putString(K_NEXT_ARTIST, s.nextArtist)
      .apply()
  }

  fun read(ctx: Context): Snapshot {
    val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return Snapshot(
      path = p.getString(K_PATH, "") ?: "",
      title = p.getString(K_TITLE, "") ?: "",
      artist = p.getString(K_ARTIST, "") ?: "",
      positionMs = p.getLong(K_POSITION, 0L),
      wasPlaying = p.getBoolean(K_WAS_PLAYING, false),
      nextPath = p.getString(K_NEXT_PATH, null),
      nextTitle = p.getString(K_NEXT_TITLE, "") ?: "",
      nextArtist = p.getString(K_NEXT_ARTIST, "") ?: ""
    )
  }

  fun clear(ctx: Context) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
  }
}
