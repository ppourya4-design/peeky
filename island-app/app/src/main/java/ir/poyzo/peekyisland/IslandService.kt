package ir.poyzo.peekyisland

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.database.ContentObserver
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable
import android.media.AudioManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.ContactsContract
import android.provider.Settings
import android.telecom.TelecomManager
import android.telephony.TelephonyManager
import android.view.Gravity
import android.view.WindowManager
import androidx.core.content.ContextCompat
import java.util.ArrayDeque

/**
 * Foreground service that owns the overlay pill and every island activity:
 * media, calls, own timers, charging/system briefs and mirrored notifications.
 * All state lives here; receivers and the listener service feed it events.
 */
class IslandService : Service() {

    // ---------- activity model ----------
    private sealed interface Act {
        val id: String

        object Ringing : Act {
            override val id = "call"
        }

        object TimerAlert : Act {
            override val id = "timeralert"
        }

        object CallOngoing : Act {
            override val id = "call"
        }

        object TimerRun : Act {
            override val id = "timer"
        }

        object MediaAct : Act {
            override val id = "media"
        }

        class MirrorAct(val item: MirrorItem) : Act {
            override val id: String get() = item.key
        }

        object ChargingAct : Act {
            override val id = "charging"
        }
    }

    private data class Brief(val spec: BriefSpec, val durMs: Long, val tag: String)

    // ---------- overlay ----------
    private var wm: WindowManager? = null
    private var island: IslandView? = null
    private var added = false
    private var lp: WindowManager.LayoutParams? = null

    // ---------- state ----------
    private var media: MediaState? = null
    private val mirrors = LinkedHashMap<String, MirrorItem>()
    private var callRinging = false
    private var callOngoing = false
    private var callNumber: String? = null
    private var callName: String? = null
    private var callStartedAt = 0L

    private var timerEndsAt = 0L // >0 running; -1 paused; 0 none
    private var timerPausedRemaining = 0L
    private var timerAlertUntil = 0L

    private var plugged = false
    private var batteryLevel = -1
    private var lowShown20 = false
    private var lowShown10 = false

    private val briefQueue = ArrayDeque<Brief>()
    private var currentBrief: Brief? = null
    private var briefEndsAt = 0L

    private var expandedId: String? = null
    private val dismissed = HashSet<String>()
    private var dismissedMediaKey: String? = null
    private val dismissedMirrorSig = HashMap<String, Int>()

    private var lastMode = "" // render cache key: mode+actId
    private var lastMusicVolume = -1

    private val handler = Handler(Looper.getMainLooper())
    private val density by lazy { resources.displayMetrics.density }
    private fun dp(v: Int): Int = (v * density).toInt()
    private fun dpF(v: Float): Int = (v * density).toInt()
    private fun icon(res: Int): Drawable? = ContextCompat.getDrawable(this, res)
    private fun now() = System.currentTimeMillis()

    override fun onBind(intent: Intent?): IBinder? = null

    // ---------- lifecycle ----------
    override fun onCreate() {
        super.onCreate()
        startForegroundWithNotification()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        island = IslandView(this).apply {
            onTap = { handleTap() }
            onLongPress = { handleLongPress() }
            onSwipe = { handleSwipe() }
            onButton = { id -> handleButton(id) }
        }
        lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = dp(Prefs.offsetDp(this@IslandService))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        registerAllReceivers()
        registerVolumeObserver()
        val am = getSystemService(AUDIO_SERVICE) as AudioManager
        lastMusicVolume = am.getStreamVolume(AudioManager.STREAM_MUSIC)

        IslandBus.handler = { e -> onBusEvent(e) }
        MediaHub.onMediaChanged = { s ->
            handler.post {
                media = if (Prefs.feature(this, Prefs.F_MUSIC)) s else null
                if (s != null) {
                    val key = s.pkg + "|" + s.title
                    if (key != dismissedMediaKey) dismissedMediaKey = null
                }
                render()
            }
        }
        // restore a timer that was running before a restart
        val savedEnd = Prefs.sp(this).getLong(Prefs.KEY_TIMER_ENDS_AT, 0L)
        if (savedEnd > now()) timerEndsAt = savedEnd
        media = MediaHub.currentState()
        IslandListener.instance?.replayActive()
        handler.post(ticker)
        render()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_TIMER -> {
                val minutes = intent.getIntExtra(EXTRA_MINUTES, 0)
                if (minutes > 0) startTimer(minutes)
            }
            ACTION_CANCEL_TIMER -> cancelTimer()
            ACTION_TEST -> enqueueBrief(
                BriefSpec(icon(R.drawable.ic_stat_ghost), "پیکی آیلند", "تست جزیره"),
                3000, "test"
            )
            ACTION_REFRESH -> render()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(ticker)
        IslandBus.handler = null
        MediaHub.onMediaChanged = null
        unregisterAllReceivers()
        volumeObserver?.let {
            try {
                contentResolver.unregisterContentObserver(it)
            } catch (_: Exception) {
            }
        }
        hideIsland()
    }

    private fun startForegroundWithNotification() {
        val nm = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID, getString(R.string.notif_channel_name), NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.notif_channel_desc)
            setShowBadge(false)
        }
        nm.createNotificationChannel(channel)
        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val notif = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_ghost)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text))
            .setContentIntent(openApp)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    // ---------- ticker: briefs, timer finish, live labels ----------
    private val ticker = object : Runnable {
        override fun run() {
            tick()
            handler.postDelayed(this, 500)
        }
    }

    private fun tick() {
        val t = now()
        // brief expiry
        if (currentBrief != null && t >= briefEndsAt) {
            currentBrief = null
            render()
        }
        // timer finish
        if (timerEndsAt > 0 && t >= timerEndsAt) {
            timerEndsAt = 0
            Prefs.sp(this).edit().remove(Prefs.KEY_TIMER_ENDS_AT).apply()
            timerAlertUntil = t + 30_000
            dismissed.remove(Act.TimerAlert.id)
            vibrate()
            render()
        }
        if (timerAlertUntil > 0 && t >= timerAlertUntil) {
            timerAlertUntil = 0
            render()
        }
        // live updates without a full re-render
        val iv = island ?: return
        if (!added) return
        when (lastMode) {
            "compact:timer" -> iv.updateCompactLabel(fmtClockFa(timerRemainingMs()))
            "compact:call" -> iv.updateCompactLabel(fmtClockFa(t - callStartedAt))
            "expanded:media" -> {
                val m = media
                if (m != null && m.durationMs > 0) {
                    iv.setExpandedProgress(m.livePositionMs().toFloat() / m.durationMs)
                }
            }
            "expanded:timer" -> {
                iv.updateExpandedSubtitle(timerSubtitle())
                val total = Prefs.sp(this).getLong(Prefs.KEY_TIMER_TOTAL, 0L)
                if (total > 0 && timerEndsAt > 0) {
                    iv.setExpandedProgress(1f - (timerEndsAt - t).toFloat() / total)
                }
            }
            "expanded:call" -> {
                if (callOngoing) iv.updateExpandedSubtitle(fmtClockFa(t - callStartedAt))
            }
        }
    }

    // ---------- bus events (listener service) ----------
    private fun onBusEvent(e: IslandEvent) {
        when (e) {
            is IslandEvent.MirrorPosted -> {
                val sig = (e.item.title + e.item.text + e.item.progress).hashCode()
                if (dismissedMirrorSig[e.item.key] != sig) {
                    dismissed.remove(e.item.key) // content changed: swipe-dismissal expires
                    mirrors[e.item.key] = e.item
                    // keep only the newest few
                    while (mirrors.size > 4) {
                        val first = mirrors.keys.first()
                        mirrors.remove(first)
                    }
                }
                render()
            }
            is IslandEvent.MirrorRemoved -> {
                mirrors.remove(e.key)
                dismissedMirrorSig.remove(e.key)
                if (expandedId == e.key) expandedId = null
                render()
            }
            IslandEvent.SessionsChanged -> {
                media = MediaHub.currentState()
                render()
            }
        }
    }

    // ---------- receivers ----------
    private var batteryReceiver: BroadcastReceiver? = null
    private var systemReceiver: BroadcastReceiver? = null
    private var phoneReceiver: BroadcastReceiver? = null
    private var volumeObserver: ContentObserver? = null

    private fun registerAllReceivers() {
        batteryReceiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                when (intent.action) {
                    Intent.ACTION_BATTERY_CHANGED -> onBatteryChanged(intent)
                    Intent.ACTION_BATTERY_LOW -> {
                        if (Prefs.feature(c, Prefs.F_LOW_BATTERY)) {
                            enqueueBrief(
                                BriefSpec(
                                    icon(R.drawable.ic_battery_alert), "باتری کم",
                                    if (batteryLevel >= 0) "${batteryLevel}٪ باقی مانده".faDigits() else null
                                ), 3200, "lowbat"
                            )
                        }
                    }
                }
            }
        }
        val bf = IntentFilter().apply {
            addAction(Intent.ACTION_BATTERY_CHANGED)
            addAction(Intent.ACTION_BATTERY_LOW)
        }
        registerReceiver(batteryReceiver, bf)

        systemReceiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                when (intent.action) {
                    AudioManager.RINGER_MODE_CHANGED_ACTION -> onRingerChanged()
                    NotificationManager.ACTION_INTERRUPTION_FILTER_CHANGED -> onDndChanged()
                    Intent.ACTION_AIRPLANE_MODE_CHANGED -> {
                        val on = intent.getBooleanExtra("state", false)
                        if (Prefs.feature(c, Prefs.F_AIRPLANE)) {
                            enqueueBrief(
                                BriefSpec(
                                    icon(R.drawable.ic_plane), "حالت هواپیما",
                                    if (on) "روشن" else "خاموش"
                                ), 2400, "airplane"
                            )
                        }
                    }
                    BluetoothDevice.ACTION_ACL_CONNECTED -> onBtChanged(intent, true)
                    BluetoothDevice.ACTION_ACL_DISCONNECTED -> onBtChanged(intent, false)
                    WifiActions.AP_STATE_CHANGED -> onApChanged(intent)
                }
            }
        }
        val sf = IntentFilter().apply {
            addAction(AudioManager.RINGER_MODE_CHANGED_ACTION)
            addAction(NotificationManager.ACTION_INTERRUPTION_FILTER_CHANGED)
            addAction(Intent.ACTION_AIRPLANE_MODE_CHANGED)
            addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
            addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
            addAction(WifiActions.AP_STATE_CHANGED)
        }
        registerReceiver(systemReceiver, sf)

        phoneReceiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                if (!Prefs.feature(c, Prefs.F_CALLS)) return
                val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
                val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
                onPhoneState(state, number)
            }
        }
        registerReceiver(phoneReceiver, IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED))
    }

    private fun unregisterAllReceivers() {
        for (r in listOf(batteryReceiver, systemReceiver, phoneReceiver)) {
            if (r != null) {
                try {
                    unregisterReceiver(r)
                } catch (_: Exception) {
                }
            }
        }
    }

    private fun registerVolumeObserver() {
        volumeObserver = object : ContentObserver(handler) {
            override fun onChange(selfChange: Boolean, uri: Uri?) {
                val am = getSystemService(AUDIO_SERVICE) as AudioManager
                val v = am.getStreamVolume(AudioManager.STREAM_MUSIC)
                if (v != lastMusicVolume) {
                    val show = lastMusicVolume >= 0 && Prefs.feature(this@IslandService, Prefs.F_VOLUME)
                    lastMusicVolume = v
                    if (show) {
                        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
                        enqueueBrief(
                            BriefSpec(
                                icon(R.drawable.ic_volume), "صدا", null,
                                barFraction = v.toFloat() / max
                            ), 1300, "volume"
                        )
                    }
                }
            }
        }
        try {
            contentResolver.registerContentObserver(Settings.System.CONTENT_URI, true, volumeObserver!!)
        } catch (_: Exception) {
        }
    }

    // ---------- system event handlers ----------
    private fun onBatteryChanged(intent: Intent) {
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100).coerceAtLeast(1)
        if (level >= 0) batteryLevel = level * 100 / scale
        val nowPlugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
        if (nowPlugged != plugged) {
            plugged = nowPlugged
            if (plugged) {
                lowShown20 = false; lowShown10 = false
                if (Prefs.feature(this, Prefs.F_CHARGING)) {
                    enqueueBrief(
                        BriefSpec(
                            icon(R.drawable.ic_bolt), "در حال شارژ",
                            if (batteryLevel >= 0) "${batteryLevel}٪".faDigits() else null
                        ), 2800, "charging"
                    )
                }
            }
            render()
        }
        if (!plugged && Prefs.feature(this, Prefs.F_LOW_BATTERY)) {
            if (batteryLevel in 1..10 && !lowShown10) {
                lowShown10 = true
                enqueueBrief(
                    BriefSpec(
                        icon(R.drawable.ic_battery_alert), "باتری کم",
                        "${batteryLevel}٪ باقی مانده".faDigits()
                    ), 3200, "lowbat"
                )
            } else if (batteryLevel in 11..20 && !lowShown20) {
                lowShown20 = true
                enqueueBrief(
                    BriefSpec(
                        icon(R.drawable.ic_battery_alert), "باتری کم",
                        "${batteryLevel}٪ باقی مانده".faDigits()
                    ), 3200, "lowbat"
                )
            }
        }
        // charging % in compact changes with level
        if (plugged && lastMode == "compact:charging") render()
    }

    private fun onRingerChanged() {
        if (!Prefs.feature(this, Prefs.F_RINGER)) return
        val am = getSystemService(AUDIO_SERVICE) as AudioManager
        val (ic, label) = when (am.ringerMode) {
            AudioManager.RINGER_MODE_SILENT -> R.drawable.ic_bell_off to "بی‌صدا"
            AudioManager.RINGER_MODE_VIBRATE -> R.drawable.ic_vibrate to "ویبره"
            else -> R.drawable.ic_bell to "با صدا"
        }
        enqueueBrief(BriefSpec(icon(ic), "حالت زنگ", label), 2400, "ringer")
    }

    private fun onDndChanged() {
        if (!Prefs.feature(this, Prefs.F_DND)) return
        val nm = getSystemService(NotificationManager::class.java)
        val on = nm.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL
        enqueueBrief(
            BriefSpec(icon(R.drawable.ic_dnd), "مزاحم نشو", if (on) "روشن" else "خاموش"),
            2400, "dnd"
        )
    }

    private fun onBtChanged(intent: Intent, connected: Boolean) {
        if (!Prefs.feature(this, Prefs.F_BLUETOOTH)) return
        val device = intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE)
        val name = try {
            device?.name
        } catch (_: SecurityException) {
            null
        } catch (_: Exception) {
            null
        } ?: "دستگاه بلوتوث"
        var sub = if (connected) "متصل شد" else "قطع شد"
        val batt = intent.getIntExtra("android.bluetooth.device.extra.BATTERY_LEVEL", -1)
        if (connected && batt in 0..100) {
            sub += " • باتری ${batt}٪".faDigits()
        }
        enqueueBrief(BriefSpec(icon(R.drawable.ic_bluetooth), name, sub), 2600, "bt")
    }

    private fun onApChanged(intent: Intent) {
        if (!Prefs.feature(this, Prefs.F_HOTSPOT)) return
        val state = intent.getIntExtra("wifi_state", -1)
        val on = state == 13 // WIFI_AP_STATE_ENABLED
        val off = state == 11 // WIFI_AP_STATE_DISABLED
        if (!on && !off) return
        enqueueBrief(
            BriefSpec(icon(R.drawable.ic_wifi), "هات‌اسپات", if (on) "روشن" else "خاموش"),
            2400, "hotspot"
        )
    }

    private fun onPhoneState(state: String, number: String?) {
        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                callRinging = true
                callOngoing = false
                callNumber = number
                callName = lookupName(number)
                dismissed.remove(Act.Ringing.id)
                render()
            }
            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                if (!callOngoing) {
                    callOngoing = true
                    callStartedAt = now()
                }
                callRinging = false
                render()
            }
            TelephonyManager.EXTRA_STATE_IDLE -> {
                callRinging = false
                callOngoing = false
                callNumber = null
                callName = null
                if (expandedId == Act.Ringing.id) expandedId = null
                render()
            }
        }
    }

    private fun lookupName(number: String?): String? {
        if (number.isNullOrBlank()) return null
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.READ_CONTACTS)
            != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) return null
        return try {
            val uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number)
            )
            contentResolver.query(
                uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null
            )?.use { cur ->
                if (cur.moveToFirst()) cur.getString(0) else null
            }
        } catch (_: Exception) {
            null
        }
    }

    // ---------- timers ----------
    private fun startTimer(minutes: Int) {
        val total = minutes * 60_000L
        timerEndsAt = now() + total
        timerPausedRemaining = 0
        timerAlertUntil = 0
        dismissed.remove(Act.TimerRun.id)
        Prefs.sp(this).edit()
            .putLong(Prefs.KEY_TIMER_ENDS_AT, timerEndsAt)
            .putLong(Prefs.KEY_TIMER_TOTAL, total)
            .apply()
        render()
    }

    private fun cancelTimer() {
        timerEndsAt = 0
        timerPausedRemaining = 0
        timerAlertUntil = 0
        Prefs.sp(this).edit().remove(Prefs.KEY_TIMER_ENDS_AT).remove(Prefs.KEY_TIMER_TOTAL).apply()
        render()
    }

    private fun timerRemainingMs(): Long = when {
        timerEndsAt > 0 -> (timerEndsAt - now()).coerceAtLeast(0)
        timerEndsAt == -1L -> timerPausedRemaining
        else -> 0L
    }

    private fun timerSubtitle(): String {
        return when {
            timerEndsAt > 0 -> "باقی مانده: ${fmtClockFa(timerEndsAt - now())}"
            timerEndsAt == -1L -> "متوقف شده: ${fmtClockFa(timerPausedRemaining)}"
            else -> ""
        }
    }

    private fun vibrate() {
        try {
            val vib = getSystemService(VIBRATOR_SERVICE) as Vibrator
            vib.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 300, 150, 300, 150, 500), -1))
        } catch (_: Exception) {
        }
    }

    // ---------- briefs ----------
    private fun enqueueBrief(spec: BriefSpec, durMs: Long, tag: String) {
        if (!Prefs.enabled(this)) return
        val b = Brief(spec, durMs, tag)
        if (tag == "volume" || currentBrief == null) {
            // volume preempts; anything else takes the slot when free
            if (currentBrief == null || tag == "volume") {
                currentBrief = b
                briefEndsAt = now() + durMs
                render()
                return
            }
        }
        if (currentBrief?.tag == tag) { // same kind already showing: refresh it
            currentBrief = b
            briefEndsAt = now() + durMs
            render()
            return
        }
        while (briefQueue.size >= 3) briefQueue.pollFirst()
        briefQueue.addLast(b)
    }

    private fun advanceBrief() {
        currentBrief = briefQueue.pollFirst()
        if (currentBrief != null) briefEndsAt = now() + currentBrief!!.durMs
        render()
    }

    // ---------- activity selection ----------
    private fun buildActivities(): List<Act> {
        val list = ArrayList<Act>()
        val t = now()
        if (callRinging && Prefs.feature(this, Prefs.F_CALLS)) list.add(Act.Ringing)
        if (timerAlertUntil > t) list.add(Act.TimerAlert)
        if (callOngoing && Prefs.feature(this, Prefs.F_CALLS)) list.add(Act.CallOngoing)
        if ((timerEndsAt != 0L) && Prefs.feature(this, Prefs.F_TIMER)) list.add(Act.TimerRun)
        val m = media
        if (m != null && Prefs.feature(this, Prefs.F_MUSIC)) list.add(Act.MediaAct)
        val newestMirror = mirrors.values.lastOrNull()
        if (newestMirror != null && Prefs.feature(this, Prefs.F_MIRROR)) {
            list.add(Act.MirrorAct(newestMirror))
        }
        if (plugged && Prefs.feature(this, Prefs.F_CHARGING)) list.add(Act.ChargingAct)
        // dismissed filter (alerts and ringing always show)
        return list.filter { act ->
            when (act) {
                Act.Ringing, Act.TimerAlert -> true
                Act.MediaAct -> dismissedMediaKey != mediaKey()
                is Act.MirrorAct -> act.id !in dismissed
                else -> act.id !in dismissed
            }
        }
    }

    private fun mediaKey(): String? = media?.let { it.pkg + "|" + it.title }

    // ---------- render ----------
    private fun render() {
        val iv = island ?: return
        if (!Prefs.enabled(this)) {
            hideIsland()
            lastMode = ""
            return
        }
        // briefs take the stage first
        val brief = currentBrief
        if (brief != null) {
            if (now() >= briefEndsAt) {
                advanceBrief()
                return
            }
            showWindow()
            val key = "brief:" + brief.tag
            if (key != lastMode) {
                lastMode = key
                iv.showBrief(brief.spec)
                val h = if (brief.spec.subtitle != null || brief.spec.barFraction >= 0) dp(60) else dp(48)
                iv.morphTo(dpF(224 * Prefs.widthScale(this)), h)
            } else if (brief.tag == "volume") {
                iv.showBrief(brief.spec) // live bar update
            }
            return
        }
        if (briefQueue.isNotEmpty()) {
            advanceBrief()
            return
        }

        val acts = buildActivities()
        if (acts.isEmpty()) {
            hideIsland()
            lastMode = ""
            expandedId = null
            return
        }
        showWindow()
        val primary = acts[0]
        val secondary = acts.getOrNull(1)
        val expand = expandedId == primary.id || primary is Act.Ringing || primary is Act.TimerAlert
        if (expand) {
            renderExpanded(primary)
        } else {
            renderCompact(primary, secondary)
        }
    }

    private fun renderCompact(primary: Act, secondary: Act?) {
        val iv = island ?: return
        val key = "compact:" + primary.id +
            if (primary is Act.ChargingAct) ":$batteryLevel" else ""
        lastMode = key
        val minimalIcon = secondary?.let { minimalIconFor(it) }
        when (primary) {
            is Act.MediaAct -> {
                val m = media!!
                iv.showCompact(
                    m.art, if (m.art == null) icon(R.drawable.ic_music_note) else null,
                    if (m.playing) RightSpec.Eq(true) else RightSpec.Icon(icon(R.drawable.ic_pause)),
                    minimalIcon
                )
            }
            is Act.TimerRun -> {
                iv.showCompact(
                    null, icon(R.drawable.ic_clock),
                    RightSpec.Label(fmtClockFa(timerRemainingMs())), minimalIcon
                )
            }
            is Act.CallOngoing -> {
                iv.showCompact(
                    null, icon(R.drawable.ic_phone),
                    RightSpec.Label(fmtClockFa(now() - callStartedAt), 0xFF34C759.toInt()),
                    minimalIcon
                )
            }
            is Act.MirrorAct -> {
                val item = primary.item
                val right = if (item.progress >= 0) {
                    RightSpec.Label("${item.progress}٪".faDigits())
                } else RightSpec.None
                iv.showCompact(null, item.appIcon, right, minimalIcon)
            }
            is Act.ChargingAct -> {
                iv.showCompact(
                    null, icon(R.drawable.ic_bolt),
                    RightSpec.Label(if (batteryLevel >= 0) "${batteryLevel}٪".faDigits() else ""),
                    minimalIcon
                )
            }
            else -> Unit
        }
        iv.morphTo(dpF(152 * Prefs.widthScale(this)), dp(40))
    }

    private fun minimalIconFor(act: Act): Drawable? = when (act) {
        is Act.MediaAct -> icon(R.drawable.ic_music_note)
        is Act.TimerRun, is Act.TimerAlert -> icon(R.drawable.ic_clock)
        is Act.CallOngoing, is Act.Ringing -> icon(R.drawable.ic_phone)
        is Act.MirrorAct -> act.item.appIcon
        is Act.ChargingAct -> icon(R.drawable.ic_bolt)
    }

    private fun renderExpanded(primary: Act) {
        val iv = island ?: return
        lastMode = "expanded:" + primary.id
        val scale = Prefs.widthScale(this)
        val screenW = resources.displayMetrics.widthPixels
        val w = (screenW * 0.94f).toInt().coerceAtMost(dp(400))
        when (primary) {
            is Act.MediaAct -> {
                val m = media!!
                val buttons = ArrayList<IslandButton>()
                if (m.hasPrev) buttons.add(
                    IslandButton("prev", null, icon(R.drawable.ic_prev), 0xFF2C2C30.toInt(), 0xFFFFFFFF.toInt())
                )
                buttons.add(
                    IslandButton(
                        "playpause", null,
                        icon(if (m.playing) R.drawable.ic_pause else R.drawable.ic_play),
                        0xFFFFFFFF.toInt(), 0xFF000000.toInt()
                    )
                )
                if (m.hasNext) buttons.add(
                    IslandButton("next", null, icon(R.drawable.ic_next), 0xFF2C2C30.toInt(), 0xFFFFFFFF.toInt())
                )
                iv.showExpanded(
                    ExpandedSpec(
                        title = m.title,
                        subtitle = m.artist.ifEmpty { null },
                        art = m.art,
                        icon = if (m.art == null) icon(R.drawable.ic_music_note) else null,
                        progressPermille = if (m.durationMs > 0) {
                            (m.livePositionMs() * 1000 / m.durationMs).toInt()
                        } else -1,
                        buttons = buttons
                    )
                )
                iv.morphTo((w * scale).toInt().coerceAtMost(w), dp(136))
            }
            is Act.Ringing -> {
                val canAnswer = ContextCompat.checkSelfPermission(
                    this, android.Manifest.permission.ANSWER_PHONE_CALLS
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                val buttons = if (canAnswer) {
                    listOf(
                        IslandButton("decline", "رد", icon(R.drawable.ic_call_end), 0xFFFF3B30.toInt(), 0xFFFFFFFF.toInt()),
                        IslandButton("answer", "پاسخ", icon(R.drawable.ic_phone), 0xFF34C759.toInt(), 0xFFFFFFFF.toInt())
                    )
                } else {
                    listOf(
                        IslandButton("open_dialer", "باز کردن تماس", icon(R.drawable.ic_phone), 0xFF2C2C30.toInt(), 0xFFFFFFFF.toInt())
                    )
                }
                iv.showExpanded(
                    ExpandedSpec(
                        title = callName ?: callNumber ?: "تماس ورودی",
                        subtitle = if (callName != null) callNumber else "تماس ورودی",
                        art = null,
                        icon = icon(R.drawable.ic_phone),
                        buttons = buttons
                    )
                )
                iv.morphTo(w, dp(118))
            }
            is Act.CallOngoing -> {
                iv.showExpanded(
                    ExpandedSpec(
                        title = callName ?: callNumber ?: "تماس",
                        subtitle = fmtClockFa(now() - callStartedAt),
                        art = null,
                        icon = icon(R.drawable.ic_phone),
                        buttons = listOf(
                            IslandButton("open_dialer", "باز کردن تماس", icon(R.drawable.ic_phone), 0xFF2C2C30.toInt(), 0xFFFFFFFF.toInt())
                        )
                    )
                )
                iv.morphTo(w, dp(118))
            }
            is Act.TimerAlert -> {
                iv.showExpanded(
                    ExpandedSpec(
                        title = "تایمر تمام شد",
                        subtitle = "زمان به پایان رسید",
                        art = null,
                        icon = icon(R.drawable.ic_clock),
                        buttons = listOf(
                            IslandButton("timer_stop", "توقف", null, 0xFFFF9F0A.toInt(), 0xFFFFFFFF.toInt())
                        )
                    )
                )
                iv.morphTo(w, dp(118))
            }
            is Act.TimerRun -> {
                val total = Prefs.sp(this).getLong(Prefs.KEY_TIMER_TOTAL, 0L)
                val paused = timerEndsAt == -1L
                val remaining = if (paused) timerPausedRemaining else timerEndsAt - now()
                val buttons = ArrayList<IslandButton>()
                buttons.add(
                    if (paused) {
                        IslandButton("timer_resume", "ادامه", icon(R.drawable.ic_play), 0xFF34C759.toInt(), 0xFFFFFFFF.toInt())
                    } else {
                        IslandButton("timer_pause", "توقف موقت", icon(R.drawable.ic_pause), 0xFF2C2C30.toInt(), 0xFFFFFFFF.toInt())
                    }
                )
                buttons.add(
                    IslandButton("timer_cancel", "لغو", icon(R.drawable.ic_close), 0xFFFF3B30.toInt(), 0xFFFFFFFF.toInt())
                )
                iv.showExpanded(
                    ExpandedSpec(
                        title = "تایمر",
                        subtitle = timerSubtitle(),
                        art = null,
                        icon = icon(R.drawable.ic_clock),
                        progressPermille = if (total > 0) {
                            ((total - remaining) * 1000 / total).toInt().coerceIn(0, 1000)
                        } else -1,
                        buttons = buttons
                    )
                )
                iv.morphTo(w, dp(128))
            }
            is Act.MirrorAct -> {
                val item = primary.item
                iv.showExpanded(
                    ExpandedSpec(
                        title = item.title,
                        subtitle = item.text.ifEmpty { null },
                        art = null,
                        icon = item.appIcon,
                        progressPermille = if (item.progress >= 0) item.progress * 10 else -1
                    )
                )
                iv.morphTo(w, dp(104))
            }
            is Act.ChargingAct -> {
                iv.showExpanded(
                    ExpandedSpec(
                        title = "در حال شارژ",
                        subtitle = if (batteryLevel >= 0) "${batteryLevel}٪".faDigits() else null,
                        art = null,
                        icon = icon(R.drawable.ic_bolt),
                        progressPermille = if (batteryLevel >= 0) batteryLevel * 10 else -1
                    )
                )
                iv.morphTo(w, dp(104))
            }
        }
    }

    // ---------- window ----------
    private fun showWindow() {
        val iv = island ?: return
        val w = wm ?: return
        val p = lp ?: return
        if (!Settings.canDrawOverlays(this)) return
        val wantY = dp(Prefs.offsetDp(this))
        if (!added) {
            try {
                p.y = wantY
                w.addView(iv, p)
                added = true
                iv.pill.scaleX = 0.5f; iv.pill.scaleY = 0.5f; iv.alpha = 0f
                iv.animate().alpha(1f).setDuration(160).start()
                iv.pill.animate().scaleX(1f).scaleY(1f).setDuration(220).start()
            } catch (_: Exception) {
                added = false
            }
        } else if (p.y != wantY) {
            try {
                p.y = wantY
                w.updateViewLayout(iv, p)
            } catch (_: Exception) {
            }
        }
    }

    private fun hideIsland() {
        val iv = island ?: return
        if (added) {
            try {
                wm?.removeView(iv)
            } catch (_: Exception) {
            }
            added = false
        }
    }

    // ---------- interactions ----------
    private fun currentPrimary(): Act? = buildActivities().firstOrNull()

    private fun handleTap() {
        if (currentBrief != null) {
            advanceBrief()
            return
        }
        val primary = currentPrimary() ?: return
        val isExpanded = expandedId == primary.id || primary is Act.Ringing || primary is Act.TimerAlert
        if (!isExpanded) {
            expandedId = primary.id
            render()
            return
        }
        // tap while expanded = open the source
        when (primary) {
            is Act.MediaAct -> openMediaApp()
            is Act.MirrorAct -> {
                try {
                    primary.item.contentIntent?.send()
                } catch (_: Exception) {
                    openPackage(primary.item.pkg)
                }
                expandedId = null
                render()
            }
            is Act.Ringing, is Act.CallOngoing -> openDialer()
            else -> {
                expandedId = null
                render()
            }
        }
    }

    private fun handleLongPress() {
        if (currentBrief != null) return
        val primary = currentPrimary() ?: return
        expandedId = if (expandedId == primary.id) null else primary.id
        render()
    }

    private fun handleSwipe() {
        if (currentBrief != null) {
            advanceBrief()
            return
        }
        val primary = currentPrimary() ?: return
        when (primary) {
            is Act.MediaAct -> dismissedMediaKey = mediaKey()
            is Act.MirrorAct -> {
                dismissed.add(primary.id)
                dismissedMirrorSig[primary.id] =
                    (primary.item.title + primary.item.text + primary.item.progress).hashCode()
            }
            is Act.Ringing, is Act.TimerAlert -> Unit // cannot swipe away an alert
            else -> dismissed.add(primary.id)
        }
        if (expandedId == primary.id) expandedId = null
        render()
    }

    private fun handleButton(id: String) {
        when (id) {
            "prev" -> MediaHub.prev()
            "next" -> MediaHub.next()
            "playpause" -> {
                val m = media ?: return
                if (m.playing) MediaHub.pause() else MediaHub.play()
            }
            "answer" -> answerCall()
            "decline" -> declineCall()
            "open_dialer" -> openDialer()
            "timer_pause" -> {
                if (timerEndsAt > 0) {
                    timerPausedRemaining = (timerEndsAt - now()).coerceAtLeast(0)
                    timerEndsAt = -1
                    Prefs.sp(this).edit().remove(Prefs.KEY_TIMER_ENDS_AT).apply()
                }
                render()
            }
            "timer_resume" -> {
                if (timerEndsAt == -1L) {
                    timerEndsAt = now() + timerPausedRemaining
                    Prefs.sp(this).edit().putLong(Prefs.KEY_TIMER_ENDS_AT, timerEndsAt).apply()
                }
                render()
            }
            "timer_cancel" -> {
                expandedId = null
                cancelTimer()
            }
            "timer_stop" -> {
                timerAlertUntil = 0
                expandedId = null
                render()
            }
        }
    }

    private fun openMediaApp() {
        val controller = MediaHub.activeController()
        val pi = controller?.sessionActivity
        if (pi != null) {
            try {
                pi.send()
                return
            } catch (_: Exception) {
            }
        }
        media?.pkg?.let { openPackage(it) }
    }

    private fun openPackage(pkg: String) {
        try {
            val intent = packageManager.getLaunchIntentForPackage(pkg)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
            }
        } catch (_: Exception) {
        }
    }

    private fun openDialer() {
        try {
            val tm = getSystemService(TelecomManager::class.java)
            val pkg = tm.defaultDialerPackage
            if (pkg != null) openPackage(pkg)
        } catch (_: Exception) {
        }
    }

    private fun answerCall() {
        try {
            val tm = getSystemService(TelecomManager::class.java)
            tm.acceptRingingCall()
        } catch (_: SecurityException) {
            openDialer()
        } catch (_: Exception) {
            openDialer()
        }
    }

    private fun declineCall() {
        try {
            val tm = getSystemService(TelecomManager::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                tm.endCall()
            } else {
                openDialer()
            }
        } catch (_: SecurityException) {
            openDialer()
        } catch (_: Exception) {
            openDialer()
        }
    }

    companion object {
        const val CHANNEL_ID = "island_service"
        const val NOTIF_ID = 41
        const val ACTION_START_TIMER = "ir.poyzo.peekyisland.START_TIMER"
        const val ACTION_CANCEL_TIMER = "ir.poyzo.peekyisland.CANCEL_TIMER"
        const val ACTION_TEST = "ir.poyzo.peekyisland.TEST"
        const val ACTION_REFRESH = "ir.poyzo.peekyisland.REFRESH"
        const val EXTRA_MINUTES = "minutes"
    }
}

/** WifiManager's AP-state broadcast action (a plain string constant in the framework). */
private object WifiActions {
    const val AP_STATE_CHANGED = "android.net.wifi.WIFI_AP_STATE_CHANGED"
}
