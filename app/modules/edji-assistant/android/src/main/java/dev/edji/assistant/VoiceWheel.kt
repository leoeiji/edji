package dev.edji.assistant

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.provider.Settings
import android.view.Choreographer
import android.view.View
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * The voice session's wheel (ADR 0006): pine disc, mint ring and the five
 * bars, drawn on a [Canvas]. Shape comes from [WheelShape]. Frames run only
 * while attached and animating; with animations off in the system settings it
 * draws each state still. The trembling is visual only: the vibration motor
 * stays off while the mic records.
 */
class VoiceWheel(context: Context) : View(context), Choreographer.FrameCallback {

    var state: WheelState = WheelState.IDLE
        set(value) {
            field = value
            if (value != WheelState.LISTENING) target = 0f
            scheduleFrame()
            invalidate()
        }

    private var level = 0f
    private var target = 0f
    private var startNanos = System.nanoTime()
    private var framing = false

    private val reducedMotion: Boolean
        get() = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

    private val disc = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = PINE; style = Paint.Style.FILL }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = MINT; style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND }
    private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = MINT; style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val bar = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = MINT; style = Paint.Style.FILL }
    private val path = Path()
    private val rect = RectF()

    /** Speech level from 0 to 1; the ring eases toward it frame by frame. */
    fun setLevel(value: Float) {
        target = value.coerceIn(0f, 1f)
        if (reducedMotion) level = 0.5f
        scheduleFrame()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        startNanos = System.nanoTime()
        scheduleFrame()
    }

    override fun onDetachedFromWindow() {
        stop()
        super.onDetachedFromWindow()
    }

    /** Stops the frame callbacks, e.g. when the session hides. */
    fun stop() {
        if (framing) Choreographer.getInstance().removeFrameCallback(this)
        framing = false
    }

    private fun scheduleFrame() {
        if (framing || !isAttachedToWindow || reducedMotion || state == WheelState.IDLE) return
        framing = true
        Choreographer.getInstance().postFrameCallback(this)
    }

    override fun doFrame(frameTimeNanos: Long) {
        framing = false
        level = WheelShape.smooth(level, target)
        invalidate()
        scheduleFrame()
    }

    override fun onDraw(canvas: Canvas) {
        val still = reducedMotion
        val t = if (still) 0.0 else (System.nanoTime() - startNanos) / 1e9
        val lvl = if (still && state == WheelState.LISTENING) 0.5f else level
        val cx = width / 2f
        val cy = height / 2f
        // Room for the wobble and the arc outside the ring.
        val base = min(width, height) / 2f / (1f + WheelShape.MAX_WOBBLE) * 0.84f
        val stroke = base * 0.07f

        path.reset()
        for (i in 0..POINTS) {
            val a = 2 * PI * i / POINTS
            val r = base * WheelShape.radiusAt(a, t, lvl, state)
            val x = cx + (cos(a) * r).toFloat()
            val y = cy + (sin(a) * r).toFloat()
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        path.close()
        canvas.drawPath(path, disc)
        ring.strokeWidth = stroke
        ring.alpha = if (state == WheelState.IDLE) 115 else 255
        canvas.drawPath(path, ring)

        if (state == WheelState.THINKING) {
            val r = base * 1.12f
            rect.set(cx - r, cy - r, cx + r, cy + r)
            arc.strokeWidth = stroke
            canvas.drawArc(rect, WheelShape.arcStartDegrees(t), 65f, false, arc)
        }

        val barWidth = base * 0.13f
        val gap = base * 0.1f
        val total = barWidth * 5 + gap * 4
        val tallest = base * 0.78f
        for (i in 0 until 5) {
            val h = (tallest * WheelShape.BAR_HEIGHTS[i] * WheelShape.barScale(i, t, lvl, state)).coerceAtLeast(barWidth)
            val x = cx - total / 2 + i * (barWidth + gap)
            rect.set(x, cy - h / 2, x + barWidth, cy + h / 2)
            canvas.drawRoundRect(rect, barWidth / 2, barWidth / 2, bar)
        }
    }

    companion object {
        private const val POINTS = 120
        private val PINE = Color.parseColor("#073E2B")
        private val MINT = Color.parseColor("#78FF9B")
    }
}
