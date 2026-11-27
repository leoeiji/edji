package dev.edji.assistant

import android.app.role.RoleManager
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * JS bridge for the voice path (command inbox with streamed replies,
 * assistant role, diagnostic log) and for routines and permissions (ADR 0005).
 * The voice session itself never needs JS to open the mic.
 */
class EdjiAssistantModule : Module() {

    private val context
        get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

    private val logListener: (String) -> Unit = { line -> sendEvent("onLog", mapOf("line" to line)) }

    override fun definition() = ModuleDefinition {
        Name("EdjiAssistant")

        Events("onLog")

        // Re-registers routine triggers on every app start, not only at boot.
        OnCreate { appContext.reactContext?.applicationContext?.let { ctx -> RoutineEngine.post { RoutineEngine.sync(ctx) } } }

        OnStartObserving { AssistantLog.addListener(logListener) }
        OnStopObserving { AssistantLog.removeListener(logListener) }

        /** Pending voice commands, oldest first, each with the earlier turns of its session. */
        AsyncFunction("pendingCommands") {
            val inbox = CommandInbox.get(context)
            inbox.pending().map { c ->
                val history = c.sessionId?.let { inbox.history(it, c.id) }.orEmpty().flatMap { turn ->
                    listOf(
                        mapOf("role" to "user", "content" to turn.text),
                        mapOf("role" to "assistant", "content" to turn.reply),
                    )
                }
                mapOf(
                    "id" to c.id.toDouble(),
                    "text" to c.text,
                    "createdAt" to c.createdAt.toDouble(),
                    "sessionId" to c.sessionId,
                    "history" to history,
                )
            }
        }

        /**
         * Shows the reply so far in the open session. Returns false when the
         * session no longer waits for it, so the agent can stop streaming.
         */
        Function("pushReply") { id: Double, textSoFar: String ->
            CommandInbox.get(context).progress(id.toLong(), textSoFar)
        }

        /**
         * Shows a tool call as a chip in the session: [label] is already in
         * Portuguese ("Finanças · Registrar gasto"), [state] is `running`,
         * `done` or `failed`. Returns false once nobody is waiting.
         */
        Function("pushTool") { id: Double, toolCallId: String, label: String, state: String ->
            CommandInbox.get(context).tool(id.toLong(), toolCallId, label, state)
        }

        /** The command's turn was saved as a conversation: the session offers "Abrir no Edji". */
        Function("markSaved") { id: Double -> CommandInbox.get(context).saved(id.toLong()) }

        /** Whether the session still waits for the command. Doesn't extend its deadline. */
        Function("isWaiting") { id: Double -> CommandInbox.get(context).isWaiting(id.toLong()) }

        /** The model is still working without visible text (e.g. reasoning): extends the session's deadline. */
        Function("heartbeat") { id: Double -> CommandInbox.get(context).heartbeat(id.toLong()) }

        /**
         * Reports how the agent finished a command (`done`, `setup`, `failed`
         * or `cancelled`). Returns false if it was no longer pending. Logs the
         * time from end of STT to full reply.
         */
        AsyncFunction("completeCommand") { id: Double, status: String, reply: String ->
            require(status in CommandInbox.FINAL_STATUSES) { "Unknown status $status" }
            val inbox = CommandInbox.get(context)
            val createdAt = inbox.pending().firstOrNull { it.id == id.toLong() }?.createdAt
            val changed = inbox.complete(id.toLong(), status, reply)
            if (changed && createdAt != null) {
                AssistantLog.log("fim do STT → resposta completa: ${System.currentTimeMillis() - createdAt} ms (comando ${id.toLong()})")
            }
            changed
        }

        Function("log") { message: String -> AssistantLog.log(message) }

        Function("logLines") { AssistantLog.snapshot() }

        Function("isAssistant") {
            context.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_ASSISTANT) == true
        }

        // Routines (ADR 0005)

        AsyncFunction("listRoutines") { RoutineStore.get(context).listRoutines().map(RoutineJson::routineToMap) }

        /** Validates again (examples included), stores the routine enabled and registers its trigger. */
        AsyncFunction("saveRoutine") { draft: Map<String, Any?> ->
            val store = RoutineStore.get(context)
            val routine = store.insertRoutine(validated(draft), "agent")
            RoutineEngine.sync(context)
            AssistantLog.log("rotinas: criada ${routine.name}")
            RoutineJson.routineToMap(routine)
        }

        /** Replaces a routine with a validated draft (examples included). Null if the id is unknown. */
        AsyncFunction("updateRoutine") { id: String, draft: Map<String, Any?> ->
            val store = RoutineStore.get(context)
            val routine = store.updateRoutine(id, validated(draft)) ?: return@AsyncFunction null
            RoutineEngine.sync(context)
            AssistantLog.log("rotinas: alterada ${routine.name}")
            RoutineJson.routineToMap(routine)
        }

        /**
         * Dry run of a draft on its examples, on [samples] (trigger outputs)
         * and on the stored input of [failureIds]. Nothing runs or is stored.
         */
        AsyncFunction("testRoutine") { draft: Map<String, Any?>, samples: List<Map<String, Any?>>, failureIds: List<Double> ->
            val store = RoutineStore.get(context)
            val clean = validated(draft, runExamples = false)
            val examples = clean.getJSONArray("examples")
            val cases = buildList {
                for (i in 0 until examples.length()) add("exemplo ${i + 1}" to RoutineJson.stringMap(examples.getJSONObject(i).getJSONObject("input")))
                samples.forEachIndexed { i, s -> add("amostra ${i + 1}" to s.mapValues { (_, v) -> v?.toString().orEmpty() }) }
                for (id in failureIds) store.getFailure(id.toLong())?.let { add("falha ${it.id}" to it.input) }
            }
            RoutineJson.test(clean, cases)
        }

        /** Notifications of [packageName] showing now, newest first. Read live, never stored. */
        AsyncFunction("activeNotifications") { packageName: String ->
            val listener = EdjiNotificationListener.instance
                ?: throw CodedException("ERR_NOTIFICATIONS", "Falta permitir acesso a notificações. Abra Permissões.", null)
            listener.active(packageName)
        }

        AsyncFunction("listFailures") { routineId: String? ->
            RoutineStore.get(context).listFailures(routineId).map {
                mapOf(
                    "id" to it.id.toDouble(),
                    "routineId" to it.routineId,
                    "failedAt" to it.failedAt.toDouble(),
                    "stage" to it.stage,
                    "where" to it.where,
                    "reason" to it.reason,
                    "input" to it.input,
                )
            }
        }

        /** Runs a failure's input again with the routine as it is now. Null if the failure is gone. */
        AsyncFunction("retryFailure") { id: Double ->
            RoutineEngine.retryFailure(context, id.toLong())?.let { mapOf("outcome" to it.outcome, "detail" to it.detail) }
        }

        AsyncFunction("discardFailure") { id: Double -> RoutineStore.get(context).deleteFailure(id.toLong()) }

        AsyncFunction("deleteRoutine") { id: String ->
            RoutineStore.get(context).deleteRoutine(id).also { RoutineEngine.sync(context) }
        }

        AsyncFunction("setRoutineEnabled") { id: String, enabled: Boolean ->
            RoutineStore.get(context).setEnabled(id, enabled).also { RoutineEngine.sync(context) }
        }

        AsyncFunction("recentRuns") { limit: Int ->
            RoutineStore.get(context).recentRuns(limit).map {
                mapOf("id" to it.id.toDouble(), "routineId" to it.routineId, "firedAt" to it.firedAt.toDouble(), "outcome" to it.outcome, "detail" to it.detail)
            }
        }

        AsyncFunction("listPlaces") { RoutineStore.get(context).listPlaces().map(::placeToMap) }

        /** Saves the current location as [name]; a place with the same name moves here. */
        AsyncFunction("savePlaceHere") { name: String, promise: Promise ->
            DeviceInfo.currentLocation(context) { fix ->
                if (fix == null) {
                    promise.reject(CodedException("ERR_LOCATION", "Não consegui achar sua localização agora.", null))
                } else {
                    val place = RoutineStore.get(context).savePlace(name.trim().take(60), fix.latitude, fix.longitude)
                    RoutineEngine.post { RoutineEngine.sync(context) }
                    promise.resolve(placeToMap(place))
                }
            }
        }

        AsyncFunction("listBluetoothDevices") { DeviceInfo.bondedDevices(context) }

        AsyncFunction("currentWifi") { RoutineEngine.currentSsid(context)?.let { mapOf("ssid" to it) } }

        AsyncFunction("listLaunchableApps") { DeviceInfo.launchableApps(context) }

        /** `ask_agent` and `run_tool` firings due now; expired ones are logged, dropped and kept as failures. */
        AsyncFunction("pendingRoutineRuns") {
            val store = RoutineStore.get(context)
            store.dueRuns(expired = { run -> keepFailure(run, RoutineStore.EXPIRED) }).map {
                val base = mapOf("id" to it.id.toDouble(), "routineId" to it.routineId, "kind" to it.kind, "firedAt" to it.firedAt.toDouble())
                if (it.kind == "run_tool") {
                    base + mapOf("tool" to it.payload.optString("tool"), "args" to RoutineJson.toValue(it.payload.optJSONObject("args") ?: JSONObject()))
                } else {
                    base + mapOf("prompt" to it.prompt, "reply" to it.reply)
                }
            }
        }

        /**
         * Reports a queued firing: `done`, `failed` (also kept in the failure
         * queue), `blocked` or `retry` (kept queued, retried later).
         */
        AsyncFunction("completeRoutineRun") { id: Double, outcome: String, detail: String, notifyText: String? ->
            val store = RoutineStore.get(context)
            val run = store.queued(id.toLong()) ?: return@AsyncFunction false
            if (outcome == "retry") {
                store.postpone(run.id)?.let { RoutineEngine.scheduleQueueWakeup(context, it) }
                return@AsyncFunction true
            }
            require(outcome in setOf("done", "failed", "blocked")) { "Unknown outcome $outcome" }
            store.finish(run.id)
            store.recordRun(run.routineId, outcome, detail, run.firedAt)
            if (outcome == "failed") keepFailure(run, detail)
            if (notifyText != null) {
                val name = store.getRoutine(run.routineId)?.name ?: "Edji"
                ActionRunner.notifyReply(context, name, notifyText)
            }
            true
        }

        Function("isRoutinesAgentAllowed") { RoutineEngine.isAgentAllowed(context) }

        Function("setRoutinesAgentAllowed") { allowed: Boolean -> RoutineEngine.setAgentAllowed(context, allowed) }

        /** Pauses every routine while the Rotinas plugin is off, and resumes them when it is back on. */
        AsyncFunction("setRoutinesPaused") { paused: Boolean ->
            RoutineEngine.setPaused(context, paused)
            RoutineEngine.sync(context)
        }

        // Permissions (ADR 0005)

        Function("permissionStatus") { ids: List<String> -> ids.associateWith { DevicePermissions.status(context, it) } }

        Function("openPermissionSettings") { id: String -> DevicePermissions.openSettings(context, id) }

        /** Registers the triggers again, e.g. after the user granted location or exact alarms. */
        Function("syncRoutines") {
            val app = context.applicationContext
            RoutineEngine.post { RoutineEngine.sync(app) }
        }

        Function("openAssistantSettings") {
            val intent = Intent(Settings.ACTION_VOICE_INPUT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
            } catch (e: Exception) {
                context.startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
    }

    /** Validates a draft from JS; a bad one rejects with the short Portuguese reason. */
    private fun validated(draft: Map<String, Any?>, runExamples: Boolean = true): JSONObject =
        try {
            RoutineJson.validate(JSONObject(draft), RoutineStore.get(context).listPlaces().map { it.id }.toSet(), runExamples)
        } catch (e: IllegalArgumentException) {
            throw CodedException("ERR_ROUTINE", e.message ?: "Não entendi a rotina.", null)
        }

    /** A queued firing that failed in JS (or expired) goes to the failure queue with its trigger input. */
    private fun keepFailure(run: QueuedRun, reason: String) {
        val routine = RoutineStore.get(context).getRoutine(run.routineId) ?: return
        RoutineEngine.reportFailure(context, routine, "action", "ação ${run.actionIndex + 1}", reason, run.input)
    }

    private fun placeToMap(p: Place): Map<String, Any> =
        mapOf("id" to p.id, "name" to p.name, "latitude" to p.latitude, "longitude" to p.longitude, "radiusM" to p.radiusM)
}
