package ir.poyzo.peekyisland

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

/** Single settings screen (built in code, Persian, RTL). */
class MainActivity : Activity() {

    private val density by lazy { resources.displayMetrics.density }
    private fun dp(v: Int): Int = (v * density).toInt()

    private val permRefreshers = ArrayList<() -> Unit>()
    private var timerStatus: TextView? = null
    private val uiHandler = Handler(Looper.getMainLooper())
    private val timerTicker = object : Runnable {
        override fun run() {
            updateTimerStatus()
            uiHandler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this).apply {
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setBackgroundColor(0xFF0B0B0F.toInt())
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(16), dp(20), dp(16), dp(28))
        }
        scroll.addView(root)
        setContentView(scroll)
        buildUi(root)
    }

    override fun onResume() {
        super.onResume()
        for (r in permRefreshers) r()
        uiHandler.post(timerTicker)
    }

    override fun onPause() {
        super.onPause()
        uiHandler.removeCallbacks(timerTicker)
    }

    // ---------------- UI construction ----------------
    private fun buildUi(root: LinearLayout) {
        // header
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val ghost = ImageView(this).apply {
            setImageResource(R.mipmap.ic_launcher_round)
            layoutParams = LinearLayout.LayoutParams(dp(52), dp(52))
        }
        val titles = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginStart = dp(12) }
        }
        titles.addView(label("پیکی آیلند", 20f, bold = true))
        titles.addView(label("جزیره‌ی شناور بالای صفحه، به سبک آیفون", 13f, color = GRAY))
        header.addView(ghost)
        header.addView(titles)
        root.addView(header)

        // master switch card
        val masterCard = card(root)
        val master = switchRow(
            masterCard, "روشن کردن جزیره", "سرویس جزیره در پس‌زمینه فعال می‌ماند",
            Prefs.enabled(this)
        ) { on ->
            Prefs.sp(this).edit().putBoolean(Prefs.KEY_ENABLED, on).apply()
            if (on) {
                if (!Settings.canDrawOverlays(this)) {
                    toast("اول دسترسی «نمایش روی برنامه‌ها» را بده")
                    openOverlaySettings()
                }
                startIsland()
            } else {
                stopService(Intent(this, IslandService::class.java))
            }
        }
        masterCard.addView(master)

        // permissions
        sectionTitle(root, "مجوزها")
        val permCard = card(root)
        permRow(permCard, "نمایش روی برنامه‌های دیگر", { Settings.canDrawOverlays(this) }) {
            openOverlaySettings()
        }
        permRow(permCard, "دسترسی به نوتیفیکیشن‌ها (موزیک همه‌ی پلیرها و آینه)", { listenerEnabled() }) {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        permRow(permCard, "تماس‌ها (نمایش تماس و دکمه پاسخ/رد)", {
            checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED &&
                checkSelfPermission(Manifest.permission.ANSWER_PHONE_CALLS) == PackageManager.PERMISSION_GRANTED
        }) {
            requestPermissions(
                arrayOf(
                    Manifest.permission.READ_PHONE_STATE,
                    Manifest.permission.ANSWER_PHONE_CALLS,
                    Manifest.permission.READ_CONTACTS
                ), 100
            )
        }
        permRow(permCard, "معافیت از بهینه‌سازی باتری (زنده ماندن سرویس)", { batteryExempt() }) {
            try {
                startActivity(
                    Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:$packageName")
                    )
                )
            } catch (_: Exception) {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permRow(permCard, "نوتیفیکیشن‌ها", {
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            }) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 101)
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permRow(permCard, "بلوتوث (نام هدفون و باتری آن)", {
                checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
            }) {
                requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), 102)
            }
        }

        // features
        sectionTitle(root, "قابلیت‌ها")
        val featCard = card(root)
        val features = listOf(
            Triple(Prefs.F_MUSIC, "موزیک", "از هر پلیری: اسپاتیفای، تلگرام، پیکی موزیک و…"),
            Triple(Prefs.F_CALLS, "تماس‌ها", "تماس ورودی با دکمه پاسخ/رد و مدت مکالمه"),
            Triple(Prefs.F_TIMER, "تایمر", "تایمر خود جزیره با هشدار پایان"),
            Triple(Prefs.F_MIRROR, "آینه‌ی نوتیفیکیشن‌ها", "مسیریابی، دانلود، اسنپ و… روی جزیره"),
            Triple(Prefs.F_CHARGING, "شارژ", "انیمیشن وصل شارژر و درصد باتری"),
            Triple(Prefs.F_LOW_BATTERY, "باتری کم", "هشدار در ۲۰٪ و ۱۰٪"),
            Triple(Prefs.F_VOLUME, "نمایش صدا", "کپسول صدا هنگام کم‌وزیاد کردن"),
            Triple(Prefs.F_RINGER, "حالت زنگ", "بی‌صدا / ویبره / با صدا"),
            Triple(Prefs.F_DND, "مزاحم نشو", "روشن و خاموش شدن حالت تمرکز"),
            Triple(Prefs.F_BLUETOOTH, "هدفون بلوتوثی", "اتصال و قطع دستگاه صوتی"),
            Triple(Prefs.F_AIRPLANE, "حالت هواپیما", "تغییر وضعیت پرواز"),
            Triple(Prefs.F_HOTSPOT, "هات‌اسپات", "روشن و خاموش شدن اشتراک اینترنت")
        )
        for ((key, title, desc) in features) {
            featCard.addView(
                switchRow(featCard, title, desc, Prefs.feature(this, key)) { on ->
                    Prefs.sp(this).edit().putBoolean(key, on).apply()
                    refreshIsland()
                }
            )
        }

        // timer
        sectionTitle(root, "تایمر جزیره")
        val timerCard = card(root)
        timerStatus = label("تایمری فعال نیست", 14f).apply {
            setPadding(dp(14), dp(12), dp(14), dp(2))
        }
        timerCard.addView(timerStatus)
        val chips = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(10), dp(6), dp(10), dp(2))
        }
        for (mins in listOf(1, 5, 10, 30)) {
            val b = smallButton("${mins} دقیقه".faDigits())
            b.setOnClickListener { startTimer(mins) }
            chips.addView(b)
        }
        timerCard.addView(chips)
        val customRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(4), dp(10), dp(10))
        }
        val minutesInput = EditText(this).apply {
            hint = "دقیقه دلخواه"
            setTextColor(0xFFFFFFFF.toInt())
            setHintTextColor(0xFF77777F.toInt())
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val startBtn = smallButton("شروع")
        startBtn.setOnClickListener {
            val m = minutesInput.text.toString().trim().toIntOrNull()
            if (m != null && m in 1..720) startTimer(m) else toast("یک عدد بین ۱ تا ۷۲۰ وارد کن")
        }
        val cancelBtn = smallButton("لغو تایمر")
        cancelBtn.setOnClickListener {
            startIsland(IslandService.ACTION_CANCEL_TIMER)
            toast("تایمر لغو شد")
        }
        customRow.addView(minutesInput)
        customRow.addView(startBtn)
        customRow.addView(cancelBtn)
        timerCard.addView(customRow)

        // appearance
        sectionTitle(root, "ظاهر جزیره")
        val appCard = card(root)
        appCard.addView(seekRow(appCard, "فاصله از بالای صفحه", 0, 120, Prefs.offsetDp(this), "dp") { v ->
            Prefs.sp(this).edit().putInt(Prefs.KEY_OFFSET_DP, v).apply()
            refreshIsland()
        })
        appCard.addView(seekRow(appCard, "عرض جزیره", 80, 140, Prefs.sp(this).getInt(Prefs.KEY_WIDTH_SCALE, 100), "%") { v ->
            Prefs.sp(this).edit().putInt(Prefs.KEY_WIDTH_SCALE, v).apply()
            refreshIsland()
        })

        // mirror picker + test
        sectionTitle(root, "آینه‌ی نوتیفیکیشن‌ها")
        val mirrorCard = card(root)
        val pickBtn = Button(this).apply {
            text = "انتخاب برنامه‌ها برای آینه"
            setTextColor(0xFFFFFFFF.toInt())
            background = roundedBg(0xFF2C2C30.toInt(), 12)
            setOnClickListener { showMirrorPicker() }
        }
        val pickWrap = LinearLayout(this).apply { setPadding(dp(12), dp(10), dp(12), dp(4)) }
        pickWrap.addView(pickBtn, LinearLayout.LayoutParams(-1, dp(46)))
        mirrorCard.addView(pickWrap)
        val mirrorNote = label(
            "نوتیفیکیشن‌های «در حال انجام» برنامه‌های انتخاب‌شده (مثل مسیریابی، دانلود، اسنپ) روی جزیره می‌آیند.",
            12.5f, color = GRAY
        ).apply { setPadding(dp(14), dp(2), dp(14), dp(12)) }
        mirrorCard.addView(mirrorNote)

        val testBtn = Button(this).apply {
            text = "تست جزیره"
            setTextColor(0xFF000000.toInt())
            background = roundedBg(0xFFFFFFFF.toInt(), 12)
            setOnClickListener {
                if (Prefs.enabled(this@MainActivity)) {
                    startIsland(IslandService.ACTION_TEST)
                } else {
                    toast("اول جزیره را روشن کن")
                }
            }
        }
        val testWrap = LinearLayout(this).apply { setPadding(0, dp(18), 0, 0) }
        testWrap.addView(testBtn, LinearLayout.LayoutParams(-1, dp(48)))
        root.addView(testWrap)

        val footer = label(
            "برای موزیک و آینه، دسترسی نوتیفیکیشن لازم است. جزیره فقط وقتی چیزی برای نمایش هست دیده می‌شود.",
            12f, color = GRAY
        ).apply { setPadding(0, dp(16), 0, 0) }
        root.addView(footer)
    }

    // ---------------- building blocks ----------------
    private fun label(text: String, sp: Float, bold: Boolean = false, color: Int = 0xFFFFFFFF.toInt()): TextView {
        return TextView(this).apply {
            this.text = text
            textSize = sp
            setTextColor(color)
            if (bold) paint.isFakeBoldText = true
        }
    }

    private fun roundedBg(color: Int, radiusDp: Int): GradientDrawable {
        return GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radiusDp).toFloat()
        }
    }

    private fun card(parent: LinearLayout): LinearLayout {
        val c = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedBg(0xFF17171C.toInt(), 16)
            layoutParams = LinearLayout.LayoutParams(-1, LinearLayout.LayoutParams.WRAP_CONTENT)
                .apply { topMargin = dp(8); bottomMargin = dp(4) }
            setPadding(0, dp(6), 0, dp(6))
        }
        parent.addView(c)
        return c
    }

    private fun sectionTitle(parent: LinearLayout, text: String) {
        val t = label(text, 16f, bold = true).apply {
            setPadding(dp(2), dp(18), dp(2), dp(2))
        }
        parent.addView(t)
    }

    private fun switchRow(
        parent: LinearLayout, title: String, desc: String?, initial: Boolean,
        onChange: (Boolean) -> Unit
    ): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(10))
        }
        val texts = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        texts.addView(label(title, 15f))
        if (desc != null) texts.addView(label(desc, 12.5f, color = GRAY))
        val sw = Switch(this).apply {
            isChecked = initial
            setOnCheckedChangeListener { _, isChecked -> onChange(isChecked) }
        }
        row.addView(texts)
        row.addView(sw)
        row.setOnClickListener { sw.isChecked = !sw.isChecked }
        return row
    }

    private fun permRow(parent: LinearLayout, title: String, granted: () -> Boolean, action: () -> Unit) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(10))
        }
        val status = label("", 13f)
        val texts = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        texts.addView(label(title, 14.5f))
        texts.addView(status)
        val btn = Button(this).apply {
            text = "تنظیم"
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            background = roundedBg(0xFF2C2C30.toInt(), 10)
            setOnClickListener { action() }
        }
        row.addView(texts)
        row.addView(btn)
        parent.addView(row)
        val refresh = {
            val ok = try {
                granted()
            } catch (_: Exception) {
                false
            }
            status.text = if (ok) "فعال ✓" else "غیرفعال"
            status.setTextColor(if (ok) 0xFF34C759.toInt() else 0xFFFF9F0A.toInt())
        }
        permRefreshers.add(refresh)
        refresh()
    }

    private fun seekRow(
        parent: LinearLayout, title: String, min: Int, max: Int, initial: Int,
        unit: String, onChange: (Int) -> Unit
    ): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(10))
        }
        val valueLabel = label("", 13f, color = GRAY)
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val t = label(title, 14.5f).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        head.addView(t)
        head.addView(valueLabel)
        wrap.addView(head)
        val bar = SeekBar(this).apply {
            this.max = max - min
            progress = initial - min
            val show = { v: Int ->
                valueLabel.text = (if (unit == "%") "$v٪" else "$v").faDigits()
            }
            show(initial)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(sb: SeekBar?, p: Int, fromUser: Boolean) {
                    val v = p + min
                    show(v)
                    if (fromUser) onChange(v)
                }

                override fun onStartTrackingTouch(sb: SeekBar?) {}
                override fun onStopTrackingTouch(sb: SeekBar?) {}
            })
        }
        wrap.addView(bar)
        return wrap
    }

    private fun smallButton(text: String): Button {
        return Button(this).apply {
            this.text = text
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            background = roundedBg(0xFF2C2C30.toInt(), 10)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, dp(42)
            ).apply { marginStart = dp(4); marginEnd = dp(4) }
        }
    }

    // ---------------- actions ----------------
    private fun startIsland(action: String? = null, minutes: Int = 0) {
        val i = Intent(this, IslandService::class.java)
        if (action != null) {
            i.action = action
            if (minutes > 0) i.putExtra(IslandService.EXTRA_MINUTES, minutes)
        }
        try {
            startForegroundService(i)
        } catch (_: Exception) {
            toast("شروع سرویس ممکن نشد")
        }
    }

    private fun refreshIsland() {
        if (Prefs.enabled(this)) startIsland(IslandService.ACTION_REFRESH)
    }

    private fun startTimer(minutes: Int) {
        if (!Prefs.enabled(this)) {
            toast("اول جزیره را روشن کن")
            return
        }
        startIsland(IslandService.ACTION_START_TIMER, minutes)
        toast("تایمر ${minutes} دقیقه‌ای شروع شد".faDigits())
    }

    private fun updateTimerStatus() {
        val tv = timerStatus ?: return
        val endsAt = Prefs.sp(this).getLong(Prefs.KEY_TIMER_ENDS_AT, 0L)
        val remaining = endsAt - System.currentTimeMillis()
        tv.text = if (endsAt > 0 && remaining > 0) {
            "تایمر فعال — باقی مانده: ${fmtClockFa(remaining)}"
        } else {
            "تایمری فعال نیست"
        }
    }

    private fun openOverlaySettings() {
        try {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
            )
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION))
        }
    }

    private fun listenerEnabled(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
            ?: return false
        return flat.split(":").any { it.contains(packageName) }
    }

    private fun batteryExempt(): Boolean {
        val pm = getSystemService(PowerManager::class.java)
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun showMirrorPicker() {
        val main = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = packageManager.queryIntentActivities(main, 0)
            .mapNotNull { ri ->
                val pkg = ri.activityInfo?.packageName ?: return@mapNotNull null
                if (pkg == packageName) return@mapNotNull null
                val lbl = try {
                    ri.loadLabel(packageManager).toString()
                } catch (_: Exception) {
                    pkg
                }
                lbl to pkg
            }
            .distinctBy { it.second }
            .sortedBy { it.first }
        if (apps.isEmpty()) {
            toast("برنامه‌ای پیدا نشد")
            return
        }
        val current = Prefs.mirrorPkgs(this).toMutableSet()
        val checked = BooleanArray(apps.size) { current.contains(apps[it].second) }
        AlertDialog.Builder(this)
            .setTitle("برنامه‌های آینه")
            .setMultiChoiceItems(apps.map { it.first }.toTypedArray(), checked) { _, which, isChecked ->
                checked[which] = isChecked
            }
            .setPositiveButton("ذخیره") { _, _ ->
                val set = HashSet<String>()
                for (i in apps.indices) if (checked[i]) set.add(apps[i].second)
                Prefs.sp(this).edit().putStringSet(Prefs.KEY_MIRROR_PKGS, set).apply()
                refreshIsland()
                toast("ذخیره شد")
            }
            .setNegativeButton("لغو", null)
            .show()
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    companion object {
        private const val GRAY = 0xFF9A9AA2.toInt()
    }
}
