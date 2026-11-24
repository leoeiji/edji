package dev.edji.spike

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** A to-do item. [source] is "voz" (side button session) or "teste" (in-app test). */
data class Task(val id: Long, val text: String, val done: Boolean, val source: String)

/**
 * Process-wide task list persisted as JSON in the app's private files.
 * Both the voice session and the activity call [init]; whichever runs first
 * loads the file. Spike-only: the MVP will replace this with versioned storage.
 */
object TaskStore {
    private val _tasks = MutableStateFlow<List<Task>>(emptyList())

    /** Current tasks, newest first. */
    val tasks: StateFlow<List<Task>> = _tasks

    private var file: File? = null

    /** Loads the stored list once per process. Safe to call repeatedly. */
    @Synchronized
    fun init(context: Context) {
        if (file != null) return
        val f = File(context.applicationContext.filesDir, "tasks.json")
        file = f
        _tasks.value = try {
            if (f.exists()) parse(f.readText()) else emptyList()
        } catch (e: Exception) {
            SpikeLog.log("tasks.json ilegível, começando vazio: ${e.message}")
            emptyList()
        }
    }

    /** Adds [text] at the top of the list and saves. */
    @Synchronized
    fun add(text: String, source: String) {
        val current = _tasks.value
        val id = maxOf(System.currentTimeMillis(), (current.maxOfOrNull { it.id } ?: 0L) + 1)
        _tasks.value = listOf(Task(id, text, false, source)) + current
        save()
        SpikeLog.log("task salva: \"$text\" ($source)")
    }

    /** Flips the done state of the task with [id] and saves. */
    @Synchronized
    fun toggle(id: Long) {
        _tasks.value = _tasks.value.map { if (it.id == id) it.copy(done = !it.done) else it }
        save()
    }

    /** Removes the task with [id] and saves. */
    @Synchronized
    fun remove(id: Long) {
        _tasks.value = _tasks.value.filterNot { it.id == id }
        save()
    }

    private fun save() {
        val f = file ?: return
        val array = JSONArray()
        for (t in _tasks.value) {
            array.put(
                JSONObject()
                    .put("id", t.id)
                    .put("text", t.text)
                    .put("done", t.done)
                    .put("source", t.source),
            )
        }
        // Write then rename, so an interrupted write never leaves a half file.
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeText(array.toString())
        if (!tmp.renameTo(f)) {
            f.writeText(array.toString())
            tmp.delete()
        }
    }

    private fun parse(json: String): List<Task> {
        val array = JSONArray(json)
        return (0 until array.length()).map { i ->
            val o = array.getJSONObject(i)
            Task(o.getLong("id"), o.getString("text"), o.optBoolean("done"), o.optString("source", "voz"))
        }
    }
}
