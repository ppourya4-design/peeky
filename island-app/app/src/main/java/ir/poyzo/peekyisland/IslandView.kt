package ir.poyzo.peekyisland

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Outline
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.dynamicanimation.animation.FloatPropertyCompat
import androidx.dynamicanimation.animation.SpringAnimation
import androidx.dynamicanimation.animation.SpringForce

/** What sits on the right side of the compact pill. */
sealed interface RightSpec {
    class Eq(val playing: Boolean) : RightSpec
    class Label(val text: String, val color: Int = 0xFFFFFFFF.toInt()) : RightSpec
    class Icon(val icon: Drawable?) : RightSpec
    object None : RightSpec
}

data class IslandButton(
    val id: String,
    val label: String?,
    val icon: Drawable?,
    val bgColor: Int,
    val fgColor: Int
)

data class ExpandedSpec(
    val title: String,
    val subtitle: String?,
    val art: Bitmap?,
    val icon: Drawable?,
    val progressPermille: Int = -1, // -1 = no progress bar
    val buttons: List<IslandButton> = emptyList()
)

data class BriefSpec(
    val icon: Drawable?,
    val title: String,
    val subtitle: String? = null,
    val barFraction: Float = -1f // >= 0 shows a thin bar (volume)
)

/**
 * The island: a black pill (plus an optional minimal circle docked to its
 * right) whose width/height morph on springs, iPhone-style. Content is one of
 * COMPACT / EXPANDED / BRIEF at a time; the owning service drives everything.
 */
class IslandView(ctx: Context) : LinearLayout(ctx) {

    var onTap: (() -> Unit)? = null
    var onLongPress: (() -> Unit)? = null
    var onSwipe: (() -> Unit)? = null
    var onButton: ((String) -> Unit)? = null

    private val density = ctx.resources.displayMetrics.density
    private fun dp(v: Int): Int = (v * density).toInt()

    private val pillBg = GradientDrawable().apply {
        setColor(0xFF000000.toInt())
        setStroke(1, 0xFF2A2A2E.toInt())
        cornerRadius = 999f
    }

    val pill: FrameLayout = FrameLayout(ctx).apply {
        background = pillBg
        clipToPadding = false
    }

    private val minimalBg = GradientDrawable().apply {
        setColor(0xFF000000.toInt())
        setStroke(1, 0xFF2A2A2E.toInt())
        shape = GradientDrawable.OVAL
    }
    val minimal: FrameLayout = FrameLayout(ctx).apply {
        background = minimalBg
        visibility = GONE
    }
    private val minimalIcon = ImageView(ctx).apply {
        scaleType = ImageView.ScaleType.FIT_CENTER
    }

    // ---- compact content ----
    private val compactLeft = ImageView(ctx).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
    }
    private val eqBars = EqBarsView(ctx)
    private val compactLabel = TextView(ctx).apply {
        setTextColor(0xFFFFFFFF.toInt())
        textSize = 13f
        gravity = Gravity.CENTER
        setSingleLine(true)
    }
    private val compactRightIcon = ImageView(ctx).apply {
        scaleType = ImageView.ScaleType.FIT_CENTER
    }
    private val compactRow = LinearLayout(ctx).apply {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(9), 0, dp(9), 0)
    }

    // ---- expanded content ----
    private val expArt = ImageView(ctx).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
    }
    private val expTitle = TextView(ctx).apply {
        setTextColor(0xFFFFFFFF.toInt())
        textSize = 15f
        setSingleLine(true)
        ellipsize = android.text.TextUtils.TruncateAt.END
        paint.isFakeBoldText = true
    }
    private val expSubtitle = TextView(ctx).apply {
        setTextColor(0xFFB8B8BE.toInt())
        textSize = 12.5f
        setSingleLine(true)
        ellipsize = android.text.TextUtils.TruncateAt.END
    }
    private val expProgressTrack = FrameLayout(ctx)
    private val expProgressFill = View(ctx)
    private val expButtons = LinearLayout(ctx).apply {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER
    }
    private val expandedBox = LinearLayout(ctx).apply {
        orientation = VERTICAL
        setPadding(dp(14), dp(10), dp(14), dp(10))
    }

    // ---- brief content ----
    private val briefIcon = ImageView(ctx).apply {
        scaleType = ImageView.ScaleType.FIT_CENTER
    }
    private val briefTitle = TextView(ctx).apply {
        setTextColor(0xFFFFFFFF.toInt())
        textSize = 13.5f
        setSingleLine(true)
        ellipsize = android.text.TextUtils.TruncateAt.END
    }
    private val briefSubtitle = TextView(ctx).apply {
        setTextColor(0xFFB8B8BE.toInt())
        textSize = 12f
        setSingleLine(true)
    }
    private val briefBarTrack = FrameLayout(ctx)
    private val briefBarFill = View(ctx)
    private val briefBox = LinearLayout(ctx).apply {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(13), 0, dp(13), 0)
    }

    // springs over the pill's own layout size (window is wrap-content)
    private var pillW = dp(44)
    private var pillH = dp(44)

    private val widthProp = object : FloatPropertyCompat<IslandView>("pillWidth") {
        override fun getValue(o: IslandView): Float = o.pillW.toFloat()
        override fun setValue(o: IslandView, v: Float) = o.setPillSize(v.toInt(), o.pillH)
    }
    private val heightProp = object : FloatPropertyCompat<IslandView>("pillHeight") {
        override fun getValue(o: IslandView): Float = o.pillH.toFloat()
        override fun setValue(o: IslandView, v: Float) = o.setPillSize(o.pillW, v.toInt())
    }
    private val springW = SpringAnimation(this, widthProp).setSpring(
        SpringForce().setStiffness(340f).setDampingRatio(0.76f)
    )
    private val springH = SpringAnimation(this, heightProp).setSpring(
        SpringForce().setStiffness(400f).setDampingRatio(0.8f)
    )

    private val gesture = GestureDetector(ctx, object : GestureDetector.SimpleOnGestureListener() {
        override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
            onTap?.invoke(); return true
        }

        override fun onLongPress(e: MotionEvent) {
            onLongPress?.invoke()
        }

        override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
            if (kotlin.math.abs(vx) > 350f && kotlin.math.abs(vx) > kotlin.math.abs(vy)) {
                onSwipe?.invoke(); return true
            }
            return false
        }
    })

    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL

        pill.layoutParams = LayoutParams(pillW, pillH)
        compactLeft.layoutParams = LinearLayout.LayoutParams(dp(26), dp(26))
        roundCorners(compactLeft, 13f)
        val rightLp = LinearLayout.LayoutParams(dp(34), dp(20)).apply { gravity = Gravity.CENTER_VERTICAL }
        eqBars.layoutParams = rightLp
        compactLabel.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        )
        compactRightIcon.layoutParams = LinearLayout.LayoutParams(dp(20), dp(20))
        val spacer = View(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
        }
        compactRow.addView(compactLeft)
        compactRow.addView(spacer)
        compactRow.addView(eqBars)
        compactRow.addView(compactLabel)
        compactRow.addView(compactRightIcon)
        pill.addView(compactRow, FrameLayout.LayoutParams(-1, -1))

        // expanded layout: [art | title/sub] then progress, then buttons
        val expTop = LinearLayout(ctx).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        expArt.layoutParams = LinearLayout.LayoutParams(dp(46), dp(46))
        roundCorners(expArt, 10f)
        val expTexts = LinearLayout(ctx).apply {
            orientation = VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginStart = dp(10) }
        }
        expTexts.addView(expTitle)
        expTexts.addView(expSubtitle)
        expTop.addView(expArt)
        expTop.addView(expTexts)
        expandedBox.addView(expTop)

        expProgressTrack.layoutParams = LinearLayout.LayoutParams(-1, dp(4)).apply {
            topMargin = dp(10)
        }
        val trackBg = GradientDrawable().apply {
            setColor(0x33FFFFFF)
            cornerRadius = dp(2).toFloat()
        }
        expProgressTrack.background = trackBg
        val fillBg = GradientDrawable().apply {
            setColor(0xFFFFFFFF.toInt())
            cornerRadius = dp(2).toFloat()
        }
        expProgressFill.background = fillBg
        expProgressTrack.addView(expProgressFill, FrameLayout.LayoutParams(0, -1))
        expandedBox.addView(expProgressTrack)

        expButtons.layoutParams = LinearLayout.LayoutParams(-1, LinearLayout.LayoutParams.WRAP_CONTENT)
            .apply { topMargin = dp(8) }
        expandedBox.addView(expButtons)
        expandedBox.visibility = GONE
        pill.addView(expandedBox, FrameLayout.LayoutParams(-1, -1))

        briefIcon.layoutParams = LinearLayout.LayoutParams(dp(22), dp(22))
        val briefTexts = LinearLayout(ctx).apply {
            orientation = VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginStart = dp(9) }
        }
        briefTexts.addView(briefTitle)
        briefTexts.addView(briefSubtitle)
        val briefCol = LinearLayout(ctx).apply {
            orientation = VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        briefBarTrack.layoutParams = LinearLayout.LayoutParams(dp(120), dp(4)).apply { topMargin = dp(5) }
        briefBarTrack.background = trackBg
        briefBarFill.background = fillBg
        briefBarTrack.addView(briefBarFill, FrameLayout.LayoutParams(0, -1))
        briefCol.addView(briefTexts)
        briefCol.addView(briefBarTrack)
        briefBox.addView(briefIcon)
        briefBox.addView(briefCol)
        briefBox.visibility = GONE
        pill.addView(briefBox, FrameLayout.LayoutParams(-1, -1))

        addView(pill)
        minimal.layoutParams = LayoutParams(dp(36), dp(36)).apply { marginStart = dp(7) }
        minimalIcon.layoutParams = FrameLayout.LayoutParams(dp(19), dp(19), Gravity.CENTER)
        minimal.addView(minimalIcon)
        addView(minimal)

        pill.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            pillBg.cornerRadius = pill.height / 2f
        }
        @Suppress("ClickableViewAccessibility")
        pill.setOnTouchListener { _, e ->
            gesture.onTouchEvent(e)
            false
        }
        minimal.setOnClickListener { onTap?.invoke() }
    }

    private fun roundCorners(v: View, radiusDp: Float) {
        v.outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                outline.setRoundRect(0, 0, view.width, view.height, radiusDp * density)
            }
        }
        v.clipToOutline = true
    }

    private fun setPillSize(w: Int, h: Int) {
        pillW = w; pillH = h
        val lp = pill.layoutParams ?: LayoutParams(w, h)
        lp.width = w; lp.height = h
        pill.layoutParams = lp
    }

    /** Morph the pill to a new size (springs), or jump instantly. */
    fun morphTo(wPx: Int, hPx: Int, animate: Boolean = true) {
        if (animate) {
            springW.animateToFinalPosition(wPx.toFloat())
            springH.animateToFinalPosition(hPx.toFloat())
        } else {
            springW.cancel(); springH.cancel()
            setPillSize(wPx, hPx)
        }
    }

    fun currentTargetW(): Int = pillW

    private fun showOnly(box: View) {
        for (b in listOf(compactRow, expandedBox, briefBox)) {
            b.visibility = if (b === box) VISIBLE else GONE
        }
        box.alpha = 0f
        box.animate().alpha(1f).setDuration(140).start()
    }

    fun showCompact(leftBitmap: Bitmap?, leftIcon: Drawable?, right: RightSpec, minimalIconDrawable: Drawable?) {
        if (leftBitmap != null) {
            compactLeft.setImageBitmap(leftBitmap)
            compactLeft.visibility = VISIBLE
        } else if (leftIcon != null) {
            compactLeft.setImageDrawable(leftIcon)
            compactLeft.visibility = VISIBLE
        } else {
            compactLeft.visibility = GONE
        }
        eqBars.visibility = GONE
        compactLabel.visibility = GONE
        compactRightIcon.visibility = GONE
        when (right) {
            is RightSpec.Eq -> {
                eqBars.visibility = VISIBLE
                eqBars.playing = right.playing
            }
            is RightSpec.Label -> {
                compactLabel.text = right.text
                compactLabel.setTextColor(right.color)
                compactLabel.visibility = VISIBLE
                eqBars.playing = false
            }
            is RightSpec.Icon -> {
                compactRightIcon.setImageDrawable(right.icon)
                compactRightIcon.visibility = VISIBLE
                eqBars.playing = false
            }
            RightSpec.None -> eqBars.playing = false
        }
        if (minimalIconDrawable != null) {
            minimalIcon.setImageDrawable(minimalIconDrawable)
            if (minimal.visibility != VISIBLE) {
                minimal.visibility = VISIBLE
                minimal.scaleX = 0.4f; minimal.scaleY = 0.4f; minimal.alpha = 0f
                minimal.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(180).start()
            }
        } else {
            minimal.visibility = GONE
        }
        showOnly(compactRow)
    }

    fun showExpanded(spec: ExpandedSpec) {
        eqBars.playing = false
        if (spec.art != null) {
            expArt.setImageBitmap(spec.art)
            expArt.visibility = VISIBLE
        } else if (spec.icon != null) {
            expArt.setImageDrawable(spec.icon)
            expArt.visibility = VISIBLE
        } else {
            expArt.visibility = GONE
        }
        expTitle.text = spec.title
        if (spec.subtitle.isNullOrEmpty()) {
            expSubtitle.visibility = GONE
        } else {
            expSubtitle.text = spec.subtitle
            expSubtitle.visibility = VISIBLE
        }
        if (spec.progressPermille >= 0) {
            expProgressTrack.visibility = VISIBLE
            setExpandedProgress(spec.progressPermille / 1000f)
        } else {
            expProgressTrack.visibility = GONE
        }
        expButtons.removeAllViews()
        if (spec.buttons.isEmpty()) {
            expButtons.visibility = GONE
        } else {
            expButtons.visibility = VISIBLE
            for (b in spec.buttons) {
                expButtons.addView(makeButton(b))
            }
        }
        minimal.visibility = GONE
        showOnly(expandedBox)
    }

    private fun makeButton(b: IslandButton): View {
        val row = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER
            val bg = GradientDrawable().apply {
                setColor(b.bgColor)
                cornerRadius = dp(20).toFloat()
            }
            background = bg
            layoutParams = LinearLayout.LayoutParams(dp(44), dp(40)).apply {
                marginStart = dp(5); marginEnd = dp(5)
            }
            isClickable = true
            setOnClickListener { onButton?.invoke(b.id) }
        }
        if (b.icon != null) {
            // re-tint a private copy: several glyphs ship with their own tint
            // (green phone, red hang-up) which would vanish on matching buttons
            val d = b.icon.mutate()
            d.setTint(b.fgColor)
            val iv = ImageView(context).apply {
                setImageDrawable(d)
                layoutParams = LinearLayout.LayoutParams(dp(22), dp(22))
            }
            row.addView(iv)
        }
        if (!b.label.isNullOrEmpty()) {
            val tv = TextView(context).apply {
                text = b.label
                setTextColor(b.fgColor)
                textSize = 13f
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { marginStart = dp(4) }
            }
            row.layoutParams.width = LinearLayout.LayoutParams.WRAP_CONTENT
            (row.layoutParams as LinearLayout.LayoutParams).let {
                it.width = LinearLayout.LayoutParams.WRAP_CONTENT
            }
            row.setPadding(dp(14), 0, dp(14), 0)
            row.addView(tv)
        }
        return row
    }

    /** Cheap in-place updates for the service ticker (no content re-fade). */
    fun updateCompactLabel(text: String) {
        if (compactLabel.visibility == VISIBLE && compactLabel.text.toString() != text) {
            compactLabel.text = text
        }
    }

    fun updateExpandedSubtitle(text: String) {
        if (expandedBox.visibility == VISIBLE && expSubtitle.text.toString() != text) {
            expSubtitle.text = text
            expSubtitle.visibility = VISIBLE
        }
    }

    fun setExpandedProgress(frac: Float) {
        val w = expProgressTrack.width
        val lp = expProgressFill.layoutParams
        if (w > 0) {
            lp.width = (w * frac.coerceIn(0f, 1f)).toInt()
            expProgressFill.layoutParams = lp
        } else {
            expProgressTrack.post { setExpandedProgress(frac) }
        }
    }

    fun showBrief(spec: BriefSpec) {
        eqBars.playing = false
        briefIcon.setImageDrawable(spec.icon)
        briefTitle.text = spec.title
        if (spec.subtitle.isNullOrEmpty()) {
            briefSubtitle.visibility = GONE
        } else {
            briefSubtitle.text = spec.subtitle
            briefSubtitle.visibility = VISIBLE
        }
        if (spec.barFraction >= 0f) {
            briefBarTrack.visibility = VISIBLE
            briefBarTrack.post {
                val lp = briefBarFill.layoutParams
                lp.width = (briefBarTrack.width * spec.barFraction.coerceIn(0f, 1f)).toInt()
                briefBarFill.layoutParams = lp
            }
        } else {
            briefBarTrack.visibility = GONE
        }
        minimal.visibility = GONE
        showOnly(briefBox)
    }
}
