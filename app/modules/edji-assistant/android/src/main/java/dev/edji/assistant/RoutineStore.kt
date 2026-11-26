package dev.edji.assistant

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** A stored routine. [trigger] and [actions] are the JSON of ADR 0005, already validated. */
data class Routine(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val trigger: JSONObject,
    val actions: JSONArray,
    val createdBy: String,
    val createdAt: Long,
    val updatedAt: Long,
    val lastRunAt: Long?,
)

data class Place(val id: String, val name: String, val latitude: Double, val longitude: Double, val radiusM: Double)

data class RoutineRun(val id: Long, val routineId: String, val firedAt: Long, val outcome: String, val detail: String)

/** An `ask_agent` firing waiting for the JS runtime. */
data class QueuedRun(val id: Long, val routineId: String, val prompt: String, val reply: String, val firedAt: Long)

/**
 * Routines, saved places, the run log and the `ask_agent` queue
 * (`edji-routines.db`, ADR 0005). Native-only like [CommandInbox]: JS reaches
 * it only through [EdjiAssistantModule], because the triggers fire while JS is dead.
 */
class RoutineStore private constructor(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "edji-routines.db", null, DB_VERSION) {

    override fun onConfigure(db: SQLiteDatabase) {
        db.enableWriteAheadLogging()
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE routines (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                trigger_json TEXT NOT NULL,
                actions_json TEXT NOT NULL,
                schema_version INTEGER NOT NULL,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_run_at INTEGER
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE places (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                radius_m REAL NOT NULL,
                created_at INTEGER NOT NULL
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE routine_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                routine_id TEXT NOT NULL,
                fired_at INTEGER NOT NULL,
                outcome TEXT NOT NULL,
                detail TEXT NOT NULL
            )
            """.trimIndent(),
        )
        // `prompt` is cleared as soon as a firing finishes; the row stays a while for deduplication.
        db.execSQL(
            """
            CREATE TABLE routine_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                routine_id TEXT NOT NULL,
                prompt TEXT NOT NULL,
                reply TEXT NOT NULL,
                fired_at INTEGER NOT NULL,
                dedupe_key TEXT UNIQUE,
                status TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at INTEGER NOT NULL
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Version 1 only. Never drop data: each version adds to the previous one.
    }

    // Routines

    fun listRoutines(): List<Routine> =
        readableDatabase.rawQuery("SELECT * FROM routines ORDER BY created_at", null).use { c ->
            buildList { while (c.moveToNext()) add(routineAt(c)) }
        }

    fun enabledRoutines(): List<Routine> = listRoutines().filter { it.enabled }

    fun getRoutine(id: String): Routine? =
        readableDatabase.rawQuery("SELECT * FROM routines WHERE id = ?", arrayOf(id)).use { c ->
            if (c.moveToNext()) routineAt(c) else null
        }

    /** Stores a validated draft as a new, enabled routine. */
    fun insertRoutine(draft: JSONObject, createdBy: String, now: Long = System.currentTimeMillis()): Routine {
        val id = "r_" + UUID.randomUUID().toString().replace("-", "").take(10)
        writableDatabase.insertOrThrow(
            "routines",
            null,
            ContentValues().apply {
                put("id", id)
                put("name", draft.getString("name"))
                put("enabled", 1)
                put("trigger_json", draft.getJSONObject("trigger").toString())
                put("actions_json", draft.getJSONArray("actions").toString())
                put("schema_version", SCHEMA_VERSION)
                put("created_by", createdBy)
                put("created_at", now)
                put("updated_at", now)
            },
        )
        return requireNotNull(getRoutine(id))
    }

    fun setEnabled(id: String, enabled: Boolean): Boolean =
        writableDatabase.update(
            "routines",
            ContentValues().apply {
                put("enabled", if (enabled) 1 else 0)
                put("updated_at", System.currentTimeMillis())
            },
            "id = ?",
            arrayOf(id),
        ) > 0

    fun deleteRoutine(id: String): Boolean {
        val db = writableDatabase
        db.delete("routine_queue", "routine_id = ?", arrayOf(id))
        return db.delete("routines", "id = ?", arrayOf(id)) > 0
    }

    // Runs

    fun recordRun(routineId: String, outcome: String, detail: String, firedAt: Long = System.currentTimeMillis()) {
        val db = writableDatabase
        db.insert(
            "routine_runs",
            null,
            ContentValues().apply {
                put("routine_id", routineId)
                put("fired_at", firedAt)
                put("outcome", outcome)
                put("detail", detail)
            },
        )
        db.update("routines", ContentValues().apply { put("last_run_at", firedAt) }, "id = ?", arrayOf(routineId))
        db.execSQL("DELETE FROM routine_runs WHERE id NOT IN (SELECT id FROM routine_runs ORDER BY id DESC LIMIT $MAX_RUNS)")
    }

    fun recentRuns(limit: Int): List<RoutineRun> =
        readableDatabase.rawQuery(
            "SELECT id, routine_id, fired_at, outcome, detail FROM routine_runs ORDER BY id DESC LIMIT ?",
            arrayOf(limit.toString()),
        ).use { c ->
            buildList { while (c.moveToNext()) add(RoutineRun(c.getLong(0), c.getString(1), c.getLong(2), c.getString(3), c.getString(4))) }
        }

    // Places

    fun listPlaces(): List<Place> =
        readableDatabase.rawQuery("SELECT id, name, latitude, longitude, radius_m FROM places ORDER BY name", null).use { c ->
            buildList { while (c.moveToNext()) add(Place(c.getString(0), c.getString(1), c.getDouble(2), c.getDouble(3), c.getDouble(4))) }
        }

    /** Saves [name] at the given point; a place with the same name (any case) moves there and keeps its id. */
    fun savePlace(name: String, latitude: Double, longitude: Double, radiusM: Double = DEFAULT_RADIUS_M): Place {
        val existing = listPlaces().firstOrNull { it.name.equals(name, ignoreCase = true) }
        val id = existing?.id ?: ("p_" + UUID.randomUUID().toString().replace("-", "").take(10))
        writableDatabase.insertWithOnConflict(
            "places",
            null,
            ContentValues().apply {
                put("id", id)
                put("name", existing?.name ?: name)
                put("latitude", latitude)
                put("longitude", longitude)
                put("radius_m", radiusM)
                put("created_at", System.currentTimeMillis())
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
        return Place(id, existing?.name ?: name, latitude, longitude, radiusM)
    }

    // ask_agent queue

    /** Queues a firing. Returns false when [dedupeKey] was already queued (the same notification posted again). */
    fun enqueue(routineId: String, prompt: String, reply: String, dedupeKey: String?, now: Long = System.currentTimeMillis()): Boolean {
        val id = writableDatabase.insertWithOnConflict(
            "routine_queue",
            null,
            ContentValues().apply {
                put("routine_id", routineId)
                put("prompt", prompt)
                put("reply", reply)
                put("fired_at", now)
                put("dedupe_key", dedupeKey)
                put("next_attempt_at", now)
            },
            SQLiteDatabase.CONFLICT_IGNORE,
        )
        return id != -1L
    }

    /** Firings due now, oldest first. Expires (and logs) the ones older than [QUEUE_TTL_MS]. */
    fun dueRuns(now: Long = System.currentTimeMillis()): List<QueuedRun> {
        val db = writableDatabase
        db.rawQuery(
            "SELECT id, routine_id, fired_at FROM routine_queue WHERE status = 'pending' AND fired_at < ?",
            arrayOf((now - QUEUE_TTL_MS).toString()),
        ).use { c ->
            while (c.moveToNext()) {
                finish(c.getLong(0))
                recordRun(c.getString(1), "failed", "Expirou sem conseguir falar com o agente", c.getLong(2))
            }
        }
        db.delete("routine_queue", "status != 'pending' AND fired_at < ?", arrayOf((now - QUEUE_TTL_MS * 2).toString()))
        return db.rawQuery(
            "SELECT id, routine_id, prompt, reply, fired_at FROM routine_queue WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id",
            arrayOf(now.toString()),
        ).use { c ->
            buildList { while (c.moveToNext()) add(QueuedRun(c.getLong(0), c.getString(1), c.getString(2), c.getString(3), c.getLong(4))) }
        }
    }

    fun queued(id: Long): QueuedRun? =
        readableDatabase.rawQuery(
            "SELECT id, routine_id, prompt, reply, fired_at FROM routine_queue WHERE id = ? AND status = 'pending'",
            arrayOf(id.toString()),
        ).use { c -> if (c.moveToNext()) QueuedRun(c.getLong(0), c.getString(1), c.getString(2), c.getString(3), c.getLong(4)) else null }

    /** Marks [id] as finished and forgets its text. */
    fun finish(id: Long): Boolean =
        writableDatabase.update(
            "routine_queue",
            ContentValues().apply {
                put("status", "done")
                put("prompt", "")
            },
            "id = ? AND status = 'pending'",
            arrayOf(id.toString()),
        ) > 0

    /** Pushes [id] back with a growing delay. Returns when it is due again. */
    fun postpone(id: Long, now: Long = System.currentTimeMillis()): Long? {
        val attempts = readableDatabase.rawQuery("SELECT attempts FROM routine_queue WHERE id = ?", arrayOf(id.toString())).use { c ->
            if (c.moveToNext()) c.getInt(0) else return null
        }
        val due = now + RETRY_DELAYS_MS[minOf(attempts, RETRY_DELAYS_MS.lastIndex)]
        writableDatabase.update(
            "routine_queue",
            ContentValues().apply {
                put("attempts", attempts + 1)
                put("next_attempt_at", due)
            },
            "id = ? AND status = 'pending'",
            arrayOf(id.toString()),
        )
        return due
    }

    /** When the next pending firing is due, if any. */
    fun nextDueAt(): Long? =
        readableDatabase.rawQuery("SELECT MIN(next_attempt_at) FROM routine_queue WHERE status = 'pending'", null).use { c ->
            if (c.moveToNext() && !c.isNull(0)) c.getLong(0) else null
        }

    private fun routineAt(c: Cursor): Routine =
        Routine(
            id = c.getString(c.getColumnIndexOrThrow("id")),
            name = c.getString(c.getColumnIndexOrThrow("name")),
            enabled = c.getInt(c.getColumnIndexOrThrow("enabled")) == 1,
            trigger = JSONObject(c.getString(c.getColumnIndexOrThrow("trigger_json"))),
            actions = JSONArray(c.getString(c.getColumnIndexOrThrow("actions_json"))),
            createdBy = c.getString(c.getColumnIndexOrThrow("created_by")),
            createdAt = c.getLong(c.getColumnIndexOrThrow("created_at")),
            updatedAt = c.getLong(c.getColumnIndexOrThrow("updated_at")),
            lastRunAt = c.getColumnIndexOrThrow("last_run_at").let { if (c.isNull(it)) null else c.getLong(it) },
        )

    companion object {
        private const val DB_VERSION = 1
        /** Version of the trigger and action JSON (`ROUTINE_SCHEMA_VERSION` in JS). */
        const val SCHEMA_VERSION = 1
        private const val MAX_RUNS = 300
        const val DEFAULT_RADIUS_M = 150.0
        /** An `ask_agent` firing gives up after a day without reaching the agent. */
        const val QUEUE_TTL_MS = 24 * 60 * 60 * 1000L
        private val RETRY_DELAYS_MS = longArrayOf(60_000L, 5 * 60_000L, 15 * 60_000L, 60 * 60_000L)

        @Volatile private var instance: RoutineStore? = null

        fun get(context: Context): RoutineStore =
            instance ?: synchronized(this) { instance ?: RoutineStore(context).also { instance = it } }
    }
}
