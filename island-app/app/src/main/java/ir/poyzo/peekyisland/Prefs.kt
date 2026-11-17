package ir.poyzo.peekyisland

import android.content.Context
import android.content.SharedPreferences

/** All user settings in one place. Read fresh by the service on every render,
 *  so the settings screen never needs a service restart to apply changes. */
object Prefs {
    private const val FILE = "peeky_island_prefs"

    const val KEY_ENABLED = "enabled"
    const val KEY_OFFSET_DP = "offset_dp"
    const val KEY_WIDTH_SCALE = "width_scale" // percent, 80..140
    const val KEY_MIRROR_PKGS = "mirror_pkgs"
    const val KEY_TIMER_ENDS_AT = "timer_ends_at"
    const val KEY_TIMER_TOTAL = "timer_total_ms"

    // feature toggles
    const val F_MUSIC = "f_music"
    const val F_CHARGING = "f_charging"
    const val F_LOW_BATTERY = "f_low_battery"
    const val F_RINGER = "f_ringer"
    const val F_DND = "f_dnd"
    const val F_AIRPLANE = "f_airplane"
    const val F_BLUETOOTH = "f_bluetooth"
    const val F_VOLUME = "f_volume"
    const val F_HOTSPOT = "f_hotspot"
    const val F_CALLS = "f_calls"
    const val F_TIMER = "f_timer"
    const val F_MIRROR = "f_mirror"

    val FEATURE_KEYS = listOf(
        F_MUSIC, F_CHARGING, F_LOW_BATTERY, F_RINGER, F_DND, F_AIRPLANE,
        F_BLUETOOTH, F_VOLUME, F_HOTSPOT, F_CALLS, F_TIMER, F_MIRROR
    )

    fun sp(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun enabled(ctx: Context): Boolean = sp(ctx).getBoolean(KEY_ENABLED, false)

    fun feature(ctx: Context, key: String): Boolean = sp(ctx).getBoolean(key, true)

    fun offsetDp(ctx: Context): Int = sp(ctx).getInt(KEY_OFFSET_DP, 10)

    fun widthScale(ctx: Context): Float = sp(ctx).getInt(KEY_WIDTH_SCALE, 100) / 100f

    fun mirrorPkgs(ctx: Context): Set<String> =
        sp(ctx).getStringSet(KEY_MIRROR_PKGS, emptySet()) ?: emptySet()
}

/** Latin digits -> Persian digits, for pill texts. */
fun String.faDigits(): String {
    val sb = StringBuilder(length)
    for (c in this) {
        sb.append(if (c in '0'..'9') '۰' + (c - '0') else c)
    }
    return sb.toString()
}

fun fmtClock(ms: Long): String {
    val totalSec = (ms.coerceAtLeast(0) / 1000).toInt()
    val m = totalSec / 60
    val s = totalSec % 60
    return "%d:%02d".format(m, s)
}

fun fmtClockFa(ms: Long): String = fmtClock(ms).faDigits()
