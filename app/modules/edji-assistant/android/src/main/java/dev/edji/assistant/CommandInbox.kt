package dev.edji.assistant

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.concurrent.ConcurrentHashMap

/** A voice command waiting for (or done by) the JS agent. */
data class Command(
    val id: Long,
    val text: String,
    val createdAt: Long,
    val status: String,
    val reply: String?,
)

/**
 * Durable queue of voice commands. The session writes the transcript here
 * before anything else, so a command is never lost even if JS never runs.
 *
 * This is a native-only database (`edji-inbox.db`, Android SQLite). JS reaches
 * it only through [EdjiAssistantModule], never with expo-sqlite: two SQLite
 * copies in one process must not open the same file (ADR 0003).
 */
class CommandInbox private constructor(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "edji-inbox.db", null, 1) {

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
                done_at INTEGER
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Version 1 only. Future versions migrate here without dropping data.
    }

    /** Stores [text] as a pending command and returns its id. */
    fun add(text: String, now: Long = System.currentTimeMillis()): Long =
        writableDatabase.insertOrThrow(
            "command_inbox",
            null,
            ContentValues().apply {
                put("text", text)
                put("created_at", now)
            },
        )

    /** Pending commands, oldest first. */
    fun pending(): List<Command> =
        readableDatabase.rawQuery(
            "SELECT id, text, created_at, status, reply FROM command_inbox WHERE status = 'pending' ORDER BY id",
            null,
        ).use { c ->
            buildList {
                while (c.moveToNext()) {
                    add(Command(c.getLong(0), c.getString(1), c.getLong(2), c.getString(3), c.getString(4)))
                }
            }
        }

    /**
     * Marks [id] as handled with [status] ("done" or "failed") and [reply].
     * Returns false if it was not pending (already handled elsewhere).
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
        if (changed > 0) waiters.remove(id)?.invoke(status, reply)
        return changed > 0
    }

    /** Calls [onDone] (on the completing thread) when [id] is completed. */
    fun await(id: Long, onDone: (status: String, reply: String) -> Unit) {
        waiters[id] = onDone
    }

    fun stopWaiting(id: Long) {
        waiters.remove(id)
    }

    companion object {
        private val waiters = ConcurrentHashMap<Long, (String, String) -> Unit>()

        @Volatile private var instance: CommandInbox? = null

        fun get(context: Context): CommandInbox =
            instance ?: synchronized(this) { instance ?: CommandInbox(context).also { instance = it } }
    }
}
