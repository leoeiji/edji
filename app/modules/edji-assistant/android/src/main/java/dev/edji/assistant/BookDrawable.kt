package dev.edji.assistant

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.Drawable

/**
 * A small open book (two outlined pages) for the session chip of a skill the
 * agent read. Drawn with a [Canvas] so the module needs no image resources.
 */
class BookDrawable(color: Int, density: Float) : Drawable() {
    private val size = (SIZE_DP * density).toInt()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color
        style = Paint.Style.STROKE
        strokeWidth = STROKE_DP * density
    }
    private val radius = RADIUS_DP * density

    override fun getIntrinsicWidth() = size
    override fun getIntrinsicHeight() = size

    override fun draw(canvas: Canvas) {
        val b = bounds
        val inset = paint.strokeWidth / 2f
        val top = b.top + b.height() * 0.2f
        val bottom = b.bottom - b.height() * 0.2f
        val mid = b.exactCenterX()
        canvas.drawRoundRect(RectF(b.left + inset, top, mid, bottom), radius, radius, paint)
        canvas.drawRoundRect(RectF(mid, top, b.right - inset, bottom), radius, radius, paint)
    }

    override fun setAlpha(alpha: Int) {
        paint.alpha = alpha
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        paint.colorFilter = colorFilter
    }

    @Deprecated("Required by Drawable", ReplaceWith("PixelFormat.TRANSLUCENT"))
    override fun getOpacity() = PixelFormat.TRANSLUCENT

    private companion object {
        const val SIZE_DP = 16
        const val STROKE_DP = 1.6f
        const val RADIUS_DP = 2f
    }
}
