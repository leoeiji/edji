package dev.edji.assistant

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Diagnostic log of the voice path: writes to logcat (tag `Edji`) and keeps the
 * last lines in memory so the app's "Registro" screen can show them.
 */
object AssistantLog {
    const val TAG = "Edji"
    private const val MAX_LINES = 150

    private val lines = ArrayDeque<String>()
    private val listeners = CopyOnWriteArraySet<(String) -> Unit>()
    private val time = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    /** Logs [message] to logcat and to the in-memory buffer, and notifies listeners. */
    fun log(message: String) {
        Log.d(TAG, message)
        val line = synchronized(this) {
            val l = time.format(Date()) + "  " + message
            lines.addLast(l)
            while (lines.size > MAX_LINES) lines.removeFirst()
            l
        }
        listeners.forEach { it(line) }
    }

    /** Buffered lines, oldest first. */
    @Synchronized
    fun snapshot(): List<String> = lines.toList()

    fun addListener(listener: (String) -> Unit) = listeners.add(listener)

    fun removeListener(listener: (String) -> Unit) = listeners.remove(listener)
}
