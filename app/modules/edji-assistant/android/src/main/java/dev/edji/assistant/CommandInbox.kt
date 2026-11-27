package dev.edji.assistant

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.concurrent.ConcurrentHashMap

/** A voice command waiting for (or answered by) the JS agent. */
data class Command(
    val id: Long,
    val text: String,
    val createdAt: Long,
    val sessionId: String?,
)

/** A finished turn of a voice session: what the user said and what the agent answered. */
data class Turn(val text: String, val reply: String)

/**
 * Durable queue of voice commands. The session writes the transcript here
 * before anything else, then the JS agent answers it and streams the reply
 * back through [progress] and [complete].
 *
 * Statuses: `pending`, `done`, `setup` (the user must fix the key or model),
 * `failed` and `cancelled` (the session closed or gave up). A command only
 * makes sense while its session is open, so the session cancels what it
 * leaves behind and nothing is sent to the model afterwards.
 *
 * This is a native-only database (`edji-inbox.db`, Android SQLite). JS reaches
 * it only through [EdjiAssistantModule], never with expo-sqlite: two SQLite
 * copies in one process must not open the same file (ADR 0003).
 */
class CommandInbox private constructor(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "edji-inbox.db", null, 2) {

    /** Callbacks of the session waiting for a command, called on the JS thread. */
    class Waiter(
        val onProgress: (String) -> Unit,
        val onHeartbeat: () -> Unit,
        val onDone: (status: String, reply: String) -> Unit,
        val onTool: (toolCallId: String, label: String, state: String) -> Unit = { _, _, _ -> },
    )

    override fun onConfigure(db: SQLiteDatabase) {
        db.enableWriteAheadLogging()
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE command_inbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                reply TEXT,
                done_at INTEGER,
                session_id TEXT
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Never drop data: each version adds to the previous one.
        if (oldVersion < 2) db.execSQL("ALTER TABLE command_inbox ADD COLUMN session_id TEXT")
    }

    /** Stores [text] as a pending command of [sessionId] and returns its id. */
    fun add(text: String, sessionId: String, now: Long = System.currentTimeMillis()): Long =
        writableDatabase.insertOrThrow(
            "command_inbox",
            null,
            ContentValues().apply {
                put("text", text)
                put("created_at", now)
                put("session_id", sessionId)
            },
        )

    /** Pending commands, oldest first. */
    fun pending(): List<Command> =
        readableDatabase.rawQuery(
            "SELECT id, text, created_at, session_id FROM command_inbox WHERE status = 'pending' ORDER BY id",
            null,
        ).use { c ->
            buildList {
                while (c.moveToNext()) {
                    add(Command(c.getLong(0), c.getString(1), c.getLong(2), c.getString(3)))
                }
            }
        }

    /** Answered turns of [sessionId] before command [beforeId], oldest first: the chat history. */
    fun history(sessionId: String, beforeId: Long): List<Turn> =
        readableDatabase.rawQuery(
            "SELECT text, reply FROM command_inbox WHERE session_id = ? AND id < ? AND status = 'done' ORDER BY id",
            arrayOf(sessionId, beforeId.toString()),
        ).use { c ->
            buildList {
                while (c.moveToNext()) add(Turn(c.getString(0), c.getString(1).orEmpty()))
            }
        }

    /**
     * Marks [id] as handled with [status] and [reply]. Returns false if it was
     * not pending (already handled or cancelled).
     */
    fun complete(id: Long, status: String, reply: String): Boolean {
        val changed = writableDatabase.update(
            "command_inbox",
            ContentValues().apply {
                put("status", status)
                put("reply", reply)
                put("done_at", System.currentTimeMillis())
            },
            "id = ? AND status = 'pending'",
            arrayOf(id.toString()),
        )
        val waiter = waiters.remove(id)
        if (changed > 0) waiter?.onDone?.invoke(status, reply)
        return changed > 0
    }

    /** Passes the reply so far to the waiting session. False when nobody waits: the agent should stop. */
    fun progress(id: Long, textSoFar: String): Boolean {
        val waiter = waiters[id] ?: return false
        waiter.onProgress(textSoFar)
        return true
    }

    /** Passes a tool call's progress to the waiting session; also a sign of life. False when nobody waits. */
    fun tool(id: Long, toolCallId: String, label: String, state: String): Boolean {
        val waiter = waiters[id] ?: return false
        waiter.onTool(toolCallId, label, state)
        waiter.onHeartbeat()
        return true
    }

    /** Whether a session still waits for [id]. */
    fun isWaiting(id: Long): Boolean = waiters.containsKey(id)

    /** Tells the waiting session the agent is still working. False when nobody waits. */
    fun heartbeat(id: Long): Boolean {
        val waiter = waiters[id] ?: return false
        waiter.onHeartbeat()
        return true
    }

    /** Gives up on [id] without notifying anyone. */
    fun cancel(id: Long) {
        waiters.remove(id)
        complete(id, "cancelled", "")
    }

    /** Cancels every pending command, e.g. leftovers of a session that crashed. Returns how many. */
    fun cancelAllPending(): Int =
        writableDatabase.update(
            "command_inbox",
            ContentValues().apply {
                put("status", "cancelled")
                put("done_at", System.currentTimeMillis())
            },
            "status = 'pending'",
            null,
        )

    /** Calls [waiter] (on the reporting thread) as the agent streams and finishes [id]. */
    fun await(id: Long, waiter: Waiter) {
        waiters[id] = waiter
    }

    companion object {
        /** Command statuses JS may report. */
        val FINAL_STATUSES = setOf("done", "setup", "failed", "cancelled")

        private val waiters = ConcurrentHashMap<Long, Waiter>()

        @Volatile private var instance: CommandInbox? = null

        fun get(context: Context): CommandInbox =
            instance ?: synchronized(this) { instance ?: CommandInbox(context).also { instance = it } }
    }
}
