package ir.poyzo.peekyisland

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import android.view.View
import kotlin.math.sin

/** Tiny 5-bar equalizer, animated on a handler loop only while [playing]. */
class EqBarsView(ctx: Context) : View(ctx) {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFFFFF.toInt()
        style = Paint.Style.FILL
    }
    private val handler = Handler(Looper.getMainLooper())
    private var startAt = 0L

    var playing: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            if (value) {
                startAt = System.currentTimeMillis()
                handler.post(tick)
            } else {
                handler.removeCallbacks(tick)
                invalidate()
            }
        }

    private val tick = object : Runnable {
        override fun run() {
            if (!playing) return
            invalidate()
            handler.postDelayed(this, 66)
        }
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        handler.removeCallbacks(tick)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val bars = 5
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0 || h <= 0) return
        val barW = w / (bars * 2 - 1)
        val t = (System.currentTimeMillis() - startAt) / 1000.0
        for (i in 0 until bars) {
            val frac = if (playing) {
                0.35 + 0.65 * (0.5 + 0.5 * sin(t * 6.0 + i * 1.35) * sin(t * 2.3 + i))
            } else 0.3
            val bh = (h * frac).toFloat().coerceAtLeast(2f)
            val x = i * barW * 2
            val y = (h - bh) / 2
            canvas.drawRoundRect(x, y, x + barW, y + bh, barW / 2, barW / 2, paint)
        }
    }
}
