package dev.edji.spike

import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Spike event log: writes to logcat (tag `Edji`) and keeps the last lines in
 * memory so the app screen can show them. Used to record what the device
 * actually does (show flags, recognizer used, latencies).
 */
object SpikeLog {
    const val TAG = "Edji"

    private val _lines = MutableStateFlow<List<String>>(emptyList())

    /** Most recent log lines, oldest first, capped at 100. */
    val lines: StateFlow<List<String>> = _lines

    private val time = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    /** Logs [message] to logcat and to [lines]. */
    @Synchronized
    fun log(message: String) {
        Log.d(TAG, message)
        val line = time.format(Date()) + "  " + message
        _lines.update { (it + line).takeLast(100) }
    }
}
