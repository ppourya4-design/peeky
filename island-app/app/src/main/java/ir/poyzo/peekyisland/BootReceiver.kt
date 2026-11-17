package ir.poyzo.peekyisland

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings

/** Restart the island after a reboot, if the user had it on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED &&
            intent?.action != "android.intent.action.QUICKBOOT_POWERON"
        ) return
        if (!Prefs.enabled(context)) return
        if (!Settings.canDrawOverlays(context)) return
        try {
            context.startForegroundService(Intent(context, IslandService::class.java))
        } catch (_: Exception) {
            // background FGS restrictions on some OEM builds: the settings
            // screen will offer a manual start instead of crashing here.
        }
    }
}
