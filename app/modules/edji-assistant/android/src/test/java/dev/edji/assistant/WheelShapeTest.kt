package dev.edji.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI

class WheelShapeTest {
    private val angles = (0 until 72).map { 2 * PI * it / 72 }
    private val times = listOf(0.0, 0.37, 1.5, 4.2, 9.9)

    private fun spread(level: Float): Float {
        val radii = times.flatMap { t -> angles.map { a -> WheelShape.radiusAt(a, t, level, WheelState.LISTENING) } }
        return radii.max() - radii.min()
    }

    @Test
    fun silenceKeepsTheRingRound() {
        assertEquals(0f, spread(0f), 1e-6f)
    }

    @Test
    fun aLouderVoiceMovesTheRingMore() {
        assertTrue(spread(0.9f) > spread(0.3f))
        assertTrue(spread(0.3f) > 0f)
    }

    @Test
    fun theRingStaysWithinItsBounds() {
        for (t in times) for (a in angles) {
            val r = WheelShape.radiusAt(a, t, 5f, WheelState.LISTENING) // level is clamped to 1
            assertTrue(r in (1f - WheelShape.MAX_WOBBLE - 1e-5f)..(1f + WheelShape.MAX_WOBBLE + 1e-5f))
            val breath = WheelShape.radiusAt(a, t, 0f, WheelState.REPLYING)
            assertTrue(breath in 1f..(1f + WheelShape.BREATH + 1e-5f))
        }
    }

    @Test
    fun thinkingAndIdleAreRound() {
        for (state in listOf(WheelState.THINKING, WheelState.IDLE)) {
            assertEquals(1f, WheelShape.radiusAt(1.0, 2.0, 1f, state), 0f)
        }
    }

    @Test
    fun barsAreSymmetricAndBounded() {
        val h = WheelShape.BAR_HEIGHTS
        assertEquals(h[0], h[4], 0f)
        assertEquals(h[1], h[3], 0f)
        for (state in WheelState.values()) for (t in times) for (i in 0 until 5) {
            val s = WheelShape.barScale(i, t, 1f, state)
            assertTrue(s in WheelShape.MIN_BAR_SCALE..WheelShape.MAX_BAR_SCALE)
        }
        assertEquals(1f, WheelShape.barScale(2, 3.0, 0f, WheelState.IDLE), 0f)
    }

    @Test
    fun levelFollowsTheRecognizerRms() {
        assertEquals(0f, WheelShape.levelFromRms(-2f), 0f)
        assertEquals(0.5f, WheelShape.levelFromRms(5f), 1e-6f)
        assertEquals(1f, WheelShape.levelFromRms(14f), 0f)
    }
}
