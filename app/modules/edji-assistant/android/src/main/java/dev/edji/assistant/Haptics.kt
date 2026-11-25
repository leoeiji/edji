package dev.edji.assistant

import android.content.Context
import android.os.VibrationEffect
import android.os.VibratorManager

/** Haptic patterns from Brandbook 01. */
object Haptics {
    /** One 20 ms pulse: capture started. */
    fun listening(context: Context) = vibrate(context, longArrayOf(0, 20))

    /** 20 ms on, 45 ms off, 25 ms on: the reply is complete. */
    fun replied(context: Context) = vibrate(context, longArrayOf(0, 20, 45, 25))

    private fun vibrate(context: Context, timings: LongArray) {
        val manager = context.getSystemService(VibratorManager::class.java) ?: return
        manager.defaultVibrator.vibrate(VibrationEffect.createWaveform(timings, -1))
    }
}
