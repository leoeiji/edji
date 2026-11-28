package dev.edji.assistant

import kotlin.math.PI
import kotlin.math.sin

/** What the voice wheel is showing. */
enum class WheelState { LISTENING, THINKING, REPLYING, IDLE }

/**
 * Geometry of the voice wheel, kept free of Android so it runs on the JVM.
 * The wheel is a pine disc with a mint ring and the brand's five bars. While
 * listening, the ring trembles with the voice: its radius is a sum of sines
 * scaled by the speech level. Thinking keeps it round under a spinning arc;
 * replying makes it breathe slowly.
 */
object WheelShape {
    /** Most the ring moves in or out, as a fraction of its radius, at full voice. */
    const val MAX_WOBBLE = 0.14f

    /** How much the ring grows at the top of a breath while replying. */
    const val BREATH = 0.04f

    /** Bar heights relative to the tallest, symmetric like the brand symbol. */
    val BAR_HEIGHTS = floatArrayOf(0.42f, 0.7f, 1f, 0.7f, 0.42f)

    const val MIN_BAR_SCALE = 0.35f
    const val MAX_BAR_SCALE = 1.25f

    /** Speech level from 0 to 1, from `SpeechRecognizer.onRmsChanged` (about -2 to 10 dB). */
    fun levelFromRms(rmsDb: Float): Float = (rmsDb.coerceIn(0f, 10f) / 10f)

    /** Moves [current] a step toward [target], so the ring follows the voice without jitter. */
    fun smooth(current: Float, target: Float, factor: Float = 0.28f): Float = current + (target - current) * factor

    /**
     * Radius at [angle] (radians) as a factor of the base radius, at [timeSec].
     * Always within 1 ± [MAX_WOBBLE] (listening) or 1 to 1 + [BREATH] (replying).
     */
    fun radiusAt(angle: Double, timeSec: Double, level: Float, state: WheelState): Float = when (state) {
        WheelState.LISTENING -> {
            // Weights sum to 1, so the wobble never passes MAX_WOBBLE.
            val wobble = 0.55 * sin(angle * 6 + timeSec * 9) +
                0.30 * sin(angle * 11 - timeSec * 13) +
                0.15 * sin(angle * 17 + timeSec * 21)
            1f + MAX_WOBBLE * level.coerceIn(0f, 1f) * wobble.toFloat()
        }
        WheelState.REPLYING -> 1f + BREATH * breath(timeSec)
        WheelState.THINKING, WheelState.IDLE -> 1f
    }

    /** Height factor of bar [index] (0..4) at [timeSec], within [MIN_BAR_SCALE]..[MAX_BAR_SCALE]. */
    fun barScale(index: Int, timeSec: Double, level: Float, state: WheelState): Float {
        val k = when (state) {
            WheelState.LISTENING -> 0.55 + level.coerceIn(0f, 1f) * (0.6 + 0.4 * sin(timeSec * 14 + index * 1.7))
            WheelState.THINKING -> 0.6 + 0.25 * sin(timeSec * 5 - index * 0.9)
            WheelState.REPLYING -> 0.8 + 0.15 * sin(timeSec * 2.2 + index * 0.5)
            WheelState.IDLE -> 1.0
        }
        return k.toFloat().coerceIn(MIN_BAR_SCALE, MAX_BAR_SCALE)
    }

    /** Start of the spinning arc while thinking, in degrees. */
    fun arcStartDegrees(timeSec: Double): Float = ((timeSec * 230) % 360).toFloat()

    /** 0 to 1 and back, about every 2.9 s. */
    private fun breath(timeSec: Double): Float = (0.5 + 0.5 * sin(timeSec * 2.2 - PI / 2)).toFloat()
}
