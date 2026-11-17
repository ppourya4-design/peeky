package ir.poyzo.peekyisland

import android.app.Notification
import android.content.ComponentName
import android.graphics.drawable.Drawable
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * The system's notification listener. Two jobs:
 *  1. unlock MediaSessionManager access for MediaHub (media sessions of ANY app),
 *  2. mirror whitelisted ongoing notifications into island activities.
 */
class IslandListener : NotificationListenerService() {

    private val iconCache = HashMap<String, Drawable?>()

    override fun onListenerConnected() {
        super.onListenerConnected()
        instance = this
        MediaHub.attach(this, ComponentName(this, IslandListener::class.java))
        // replay whatever is already ongoing
        try {
            for (sbn in activeNotifications ?: emptyArray()) {
                handlePosted(sbn)
            }
        } catch (_: Exception) {
        }
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        if (instance === this) instance = null
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        handlePosted(sbn)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        if (sbn == null) return
        IslandBus.post(IslandEvent.MirrorRemoved(sbn.key))
    }

    /** Re-post everything ongoing (called when the island service starts late). */
    fun replayActive() {
        try {
            for (sbn in activeNotifications ?: emptyArray()) {
                handlePosted(sbn)
            }
        } catch (_: Exception) {
        }
    }

    private fun handlePosted(sbn: StatusBarNotification) {
        try {
            if (!Prefs.feature(this, Prefs.F_MIRROR)) return
            val pkg = sbn.packageName ?: return
            if (pkg == packageName) return
            if (pkg !in Prefs.mirrorPkgs(this)) return
            val n = sbn.notification ?: return
            if (n.flags and Notification.FLAG_ONGOING_EVENT == 0) return
            if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return

            val extras = n.extras
            val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()
                ?: return
            val text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
                ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
                ?: ""
            var progress = -1
            val max = extras.getInt(Notification.EXTRA_PROGRESS_MAX, 0)
            val cur = extras.getInt(Notification.EXTRA_PROGRESS, 0)
            val indet = extras.getBoolean(Notification.EXTRA_PROGRESS_INDETERMINATE, false)
            if (max > 0 && !indet) {
                progress = (cur * 100 / max).coerceIn(0, 100)
            }
            val icon = iconCache.getOrPut(pkg) {
                try {
                    packageManager.getApplicationIcon(pkg)
                } catch (_: Exception) {
                    null
                }
            }
            IslandBus.post(
                IslandEvent.MirrorPosted(
                    MirrorItem(
                        key = sbn.key,
                        pkg = pkg,
                        appIcon = icon,
                        title = title,
                        text = text.trim(),
                        progress = progress,
                        contentIntent = n.contentIntent
                    )
                )
            )
        } catch (_: Exception) {
            // a malformed notification must never kill the listener
        }
    }

    companion object {
        @Volatile
        var instance: IslandListener? = null
            private set
    }
}
