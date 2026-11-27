package dev.edji.assistant

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** A stored routine. [trigger], [steps], [actions] and [examples] are the JSON of ADR 0005, already validated and migrated. */
data class Routine(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val trigger: JSONObject,
    val steps: JSONArray,
    val actions: JSONArray,
    val examples: JSONArray,
    val createdBy: String,
    val createdAt: Long,
    val updatedAt: Long,
    val lastRunAt: Long?,
)

data class Place(val id: String, val name: String, val latitude: Double, val longitude: Double, val radiusM: Double)

data class RoutineRun(val id: Long, val routineId: String, val firedAt: Long, val outcome: String, val detail: String)

/**
 * A firing waiting for the JS runtime: `ask_agent` ([prompt], [reply]) or
 * `run_tool` ([payload] holds `tool` and the resolved `args`). [input] is the
 * trigger output, kept so a failure can go to the failure queue.
 */
data class QueuedRun(
    val id: Long,
    val routineId: String,
    val kind: String,
    val actionIndex: Int,
    val prompt: String,
    val reply: String,
    val payload: JSONObject,
    val input: Map<String, String>,
    val firedAt: Long,
)

/** A failed firing kept so the routine can be fixed and the input run again (ADR 0005). [where] is a step id or "ação N". */
data class RoutineFailure(
    val id: Long,
    val routineId: String,
    val failedAt: Long,
    val stage: String,
    val where: String,
    val reason: String,
    val input: Map<String, String>,
)

/**
 * Routines, saved places, the run log, the queue of firings for JS
 * (`ask_agent`, `run_tool`) and the failure queue (`edji-routines.db`, ADR 0005). Native-only like [CommandInbox]: JS reaches
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
                steps_json TEXT NOT NULL DEFAULT '[]',
                examples_json TEXT NOT NULL DEFAULT '[]',
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
        // `prompt`, `payload_json` and `input_json` are cleared as soon as a firing finishes; the row stays a while for deduplication.
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
        upgradeTo2(db, freshTables = true)
    }

    /** Never drop data: each version only adds to the previous one. */
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) upgradeTo2(db, freshTables = false)
    }

    /** Version 2: steps and examples on routines, `run_tool` in the queue, the failure queue. */
    private fun upgradeTo2(db: SQLiteDatabase, freshTables: Boolean) {
        if (!freshTables) {
            db.execSQL("ALTER TABLE routines ADD COLUMN steps_json TEXT NOT NULL DEFAULT '[]'")
            db.execSQL("ALTER TABLE routines ADD COLUMN examples_json TEXT NOT NULL DEFAULT '[]'")
        }
        db.execSQL("ALTER TABLE routine_queue ADD COLUMN kind TEXT NOT NULL DEFAULT 'ask_agent'")
        db.execSQL("ALTER TABLE routine_queue ADD COLUMN action_index INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE routine_queue ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}'")
        db.execSQL("ALTER TABLE routine_queue ADD COLUMN input_json TEXT NOT NULL DEFAULT '{}'")
        db.execSQL(
            """
            CREATE TABLE routine_failures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                routine_id TEXT NOT NULL,
                failed_at INTEGER NOT NULL,
                stage TEXT NOT NULL,
                location TEXT NOT NULL,
                reason TEXT NOT NULL,
                input_json TEXT NOT NULL
            )
            """.trimIndent(),
        )
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
            draftValues(draft).apply {
                put("id", id)
                put("enabled", 1)
                put("created_by", createdBy)
                put("created_at", now)
                put("updated_at", now)
            },
        )
        return requireNotNull(getRoutine(id))
    }

    /** Replaces name, trigger, steps, actions and examples of [id] with a validated draft. Keeps `enabled`. Null if missing. */
    fun updateRoutine(id: String, draft: JSONObject, now: Long = System.currentTimeMillis()): Routine? {
        val changed = writableDatabase.update("routines", draftValues(draft).apply { put("updated_at", now) }, "id = ?", arrayOf(id))
        return if (changed > 0) getRoutine(id) else null
    }

    private fun draftValues(draft: JSONObject) =
        ContentValues().apply {
            put("name", draft.getString("name"))
            put("trigger_json", draft.getJSONObject("trigger").toString())
            put("steps_json", draft.optJSONArray("steps")?.toString() ?: "[]")
            put("actions_json", draft.getJSONArray("actions").toString())
            put("examples_json", draft.optJSONArray("examples")?.toString() ?: "[]")
            put("schema_version", SCHEMA_VERSION)
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
        db.delete("routine_failures", "routine_id = ?", arrayOf(id))
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

    // Queue of firings for JS (ask_agent, run_tool)

    /**
     * Queues a firing for JS. Returns false when [dedupeKey] was already queued
     * (the same notification posted again).
     */
    fun enqueue(
        routineId: String,
        kind: String,
        actionIndex: Int,
        prompt: String,
        reply: String,
        payload: JSONObject,
        input: Map<String, String>,
        dedupeKey: String?,
        now: Long = System.currentTimeMillis(),
    ): Boolean {
        val id = writableDatabase.insertWithOnConflict(
            "routine_queue",
            null,
            ContentValues().apply {
                put("routine_id", routineId)
                put("kind", kind)
                put("action_index", actionIndex)
                put("prompt", prompt)
                put("reply", reply)
                put("payload_json", payload.toString())
                put("input_json", JSONObject(input).toString())
                put("fired_at", now)
                put("dedupe_key", dedupeKey)
                put("next_attempt_at", now)
            },
            SQLiteDatabase.CONFLICT_IGNORE,
        )
        return id != -1L
    }

    /**
     * Firings due now, oldest first. The ones older than [QUEUE_TTL_MS] are
     * dropped, logged and returned in [expired] so they reach the failure queue.
     */
    fun dueRuns(now: Long = System.currentTimeMillis(), expired: (QueuedRun) -> Unit = {}): List<QueuedRun> {
        val db = writableDatabase
        val stale = db.rawQuery(
            "SELECT $QUEUE_COLUMNS FROM routine_queue WHERE status = 'pending' AND fired_at < ?",
            arrayOf((now - QUEUE_TTL_MS).toString()),
        ).use { c -> buildList { while (c.moveToNext()) add(queuedAt(c)) } }
        for (run in stale) {
            finish(run.id)
            recordRun(run.routineId, "failed", EXPIRED, run.firedAt)
            expired(run)
        }
        db.delete("routine_queue", "status != 'pending' AND fired_at < ?", arrayOf((now - QUEUE_TTL_MS * 2).toString()))
        return db.rawQuery(
            "SELECT $QUEUE_COLUMNS FROM routine_queue WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id",
            arrayOf(now.toString()),
        ).use { c -> buildList { while (c.moveToNext()) add(queuedAt(c)) } }
    }

    fun queued(id: Long): QueuedRun? =
        readableDatabase.rawQuery(
            "SELECT $QUEUE_COLUMNS FROM routine_queue WHERE id = ? AND status = 'pending'",
            arrayOf(id.toString()),
        ).use { c -> if (c.moveToNext()) queuedAt(c) else null }

    private fun queuedAt(c: Cursor) =
        QueuedRun(
            id = c.getLong(0),
            routineId = c.getString(1),
            kind = c.getString(2),
            actionIndex = c.getInt(3),
            prompt = c.getString(4),
            reply = c.getString(5),
            payload = JSONObject(c.getString(6)),
            input = RoutineJson.stringMap(JSONObject(c.getString(7))),
            firedAt = c.getLong(8),
        )

    /** Marks [id] as finished and forgets its text. */
    fun finish(id: Long): Boolean =
        writableDatabase.update(
            "routine_queue",
            ContentValues().apply {
                put("status", "done")
                put("prompt", "")
                put("payload_json", "{}")
                put("input_json", "{}")
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

    // Failure queue

    /** Keeps a failed firing with its trigger input. Prunes old rows. Returns the id. */
    fun recordFailure(
        routineId: String,
        stage: String,
        where: String,
        reason: String,
        input: Map<String, String>,
        now: Long = System.currentTimeMillis(),
    ): Long {
        val db = writableDatabase
        val id = db.insert(
            "routine_failures",
            null,
            ContentValues().apply {
                put("routine_id", routineId)
                put("failed_at", now)
                put("stage", stage)
                put("location", where)
                put("reason", reason)
                put("input_json", JSONObject(input).toString())
            },
        )
        pruneFailures(now)
        return id
    }

    /** Open failures, newest first; only [routineId]'s when given. */
    fun listFailures(routineId: String? = null, now: Long = System.currentTimeMillis()): List<RoutineFailure> {
        pruneFailures(now)
        val (where, args) = if (routineId == null) "" to emptyArray<String>() else "WHERE routine_id = ?" to arrayOf(routineId)
        return readableDatabase.rawQuery("SELECT $FAILURE_COLUMNS FROM routine_failures $where ORDER BY id DESC", args).use { c ->
            buildList { while (c.moveToNext()) add(failureAt(c)) }
        }
    }

    fun getFailure(id: Long): RoutineFailure? =
        readableDatabase.rawQuery("SELECT $FAILURE_COLUMNS FROM routine_failures WHERE id = ?", arrayOf(id.toString())).use { c ->
            if (c.moveToNext()) failureAt(c) else null
        }

    fun deleteFailure(id: Long): Boolean = writableDatabase.delete("routine_failures", "id = ?", arrayOf(id.toString())) > 0

    fun countFailures(routineId: String): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM routine_failures WHERE routine_id = ?", arrayOf(routineId)).use { c ->
            if (c.moveToNext()) c.getInt(0) else 0
        }

    private fun pruneFailures(now: Long) {
        val db = writableDatabase
        db.delete("routine_failures", "failed_at < ?", arrayOf((now - FAILURE_TTL_MS).toString()))
        db.execSQL("DELETE FROM routine_failures WHERE id NOT IN (SELECT id FROM routine_failures ORDER BY id DESC LIMIT $MAX_FAILURES)")
    }

    private fun failureAt(c: Cursor) =
        RoutineFailure(c.getLong(0), c.getString(1), c.getLong(2), c.getString(3), c.getString(4), c.getString(5), RoutineJson.stringMap(JSONObject(c.getString(6))))

    /** A stored routine, migrated on read to the current schema. */
    private fun routineAt(c: Cursor): Routine {
        val (trigger, steps, actions) = RoutineJson.migrate(
            c.getInt(c.getColumnIndexOrThrow("schema_version")),
            JSONObject(c.getString(c.getColumnIndexOrThrow("trigger_json"))),
            JSONArray(c.getString(c.getColumnIndexOrThrow("steps_json"))),
            JSONArray(c.getString(c.getColumnIndexOrThrow("actions_json"))),
        )
        return Routine(
            id = c.getString(c.getColumnIndexOrThrow("id")),
            name = c.getString(c.getColumnIndexOrThrow("name")),
            enabled = c.getInt(c.getColumnIndexOrThrow("enabled")) == 1,
            trigger = trigger,
            steps = steps,
            actions = actions,
            examples = JSONArray(c.getString(c.getColumnIndexOrThrow("examples_json"))),
            createdBy = c.getString(c.getColumnIndexOrThrow("created_by")),
            createdAt = c.getLong(c.getColumnIndexOrThrow("created_at")),
            updatedAt = c.getLong(c.getColumnIndexOrThrow("updated_at")),
            lastRunAt = c.getColumnIndexOrThrow("last_run_at").let { if (c.isNull(it)) null else c.getLong(it) },
        )
    }

    companion object {
        private const val DB_VERSION = 2
        /** Version of the trigger, step, action and example JSON (`ROUTINE_SCHEMA_VERSION` in JS). */
        const val SCHEMA_VERSION = 2
        private const val QUEUE_COLUMNS = "id, routine_id, kind, action_index, prompt, reply, payload_json, input_json, fired_at"
        private const val FAILURE_COLUMNS = "id, routine_id, failed_at, stage, location, reason, input_json"
        const val EXPIRED = "Expirou sem conseguir rodar"
        /** Failures leave the queue after 30 days if nobody fixes or discards them. */
        const val FAILURE_TTL_MS = 30 * 24 * 60 * 60 * 1000L
        private const val MAX_FAILURES = 200
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
