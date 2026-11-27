package dev.edji.assistant

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import kotlin.random.Random

/** How one action ended: `done`, `failed` or `blocked` (a permission or the opt-in is missing). */
data class ActionOutcome(val outcome: String, val detail: String)

/**
 * Runs the actions of a routine (ADR 0005), in order, off the main thread.
 * The catalog is closed: no arbitrary intents. `ask_agent` and `run_tool`
 * only queue work for JS.
 */
object ActionRunner {

    private const val CHANNEL_ID = "routines"
    /** A "tap to open" notification disappears if left alone. */
    private const val TAP_TIMEOUT_MS = 2 * 60_000L

    /**
     * Runs action [index] of [routine]. [values] holds the trigger input and
     * the step outputs, by reference; [input] is the raw trigger output,
     * queued with JS actions so a failure can be retried.
     */
    fun run(
        context: Context,
        routine: Routine,
        action: JSONObject,
        index: Int,
        values: Map<String, Any>,
        input: Map<String, String>,
        dedupeKey: String?,
    ): ActionOutcome =
        try {
            when (action.getString("kind")) {
                "open_app" -> openApp(context, routine, action.getString("packageName"), action.getString("label"))
                "open_url" -> openUrl(context, routine, action.getString("url"))
                "notify" -> notifyText(context, routine.name, RoutinePipeline.fill(action.getString("text"), values))
                "sound_mode" -> soundMode(context, action.getString("mode"))
                "ask_agent" -> askAgent(context, routine, action, index, values, input, dedupeKey)
                "run_tool" -> runTool(context, routine, action, index, values, input, dedupeKey)
                else -> ActionOutcome("failed", "Ação desconhecida")
            }
        } catch (e: SecurityException) {
            ActionOutcome("blocked", "Falta permissão")
        } catch (e: Exception) {
            AssistantLog.log("rotina ${routine.id}: ação falhou: ${e.javaClass.simpleName} ${e.message}")
            ActionOutcome("failed", "Algo falhou")
        }

    private fun openApp(context: Context, routine: Routine, packageName: String, label: String): ActionOutcome {
        val launch = context.packageManager.getLaunchIntentForPackage(packageName)
            ?: return ActionOutcome("failed", "$label não está instalado")
        return start(context, routine, launch, "Pediu para abrir $label", "Toque para abrir $label")
    }

    private fun openUrl(context: Context, routine: Routine, url: String): ActionOutcome {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        if (intent.resolveActivity(context.packageManager) == null) return ActionOutcome("failed", "Nenhum app abre esse link")
        return start(context, routine, intent, "Pediu para abrir o link", "Toque para abrir o link")
    }

    /**
     * Starts [intent] directly when Android should allow it from the
     * background; otherwise posts a notification the user taps (ADR 0005, to
     * validate). Android blocks background starts silently, so the log says
     * "Pediu para abrir", never that it opened.
     */
    private fun start(context: Context, routine: Routine, intent: Intent, opened: String, tapText: String): ActionOutcome {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        if (DevicePermissions.canStartActivitiesInBackground(context)) {
            context.startActivity(intent)
            return ActionOutcome("done", opened)
        }
        if (!canNotify(context)) return ActionOutcome("blocked", "Falta permissão para abrir apps em segundo plano")
        val pending = PendingIntent.getActivity(
            context,
            Random.nextInt(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT,
        )
        post(context, routine.name, tapText, pending, TAP_TIMEOUT_MS)
        return ActionOutcome("done", "Avisou: ${tapText.lowercase()}")
    }

    private fun notifyText(context: Context, title: String, text: String): ActionOutcome {
        if (!canNotify(context)) return ActionOutcome("blocked", "Falta permissão de notificações")
        post(context, title, text, null, null)
        return ActionOutcome("done", "Avisou")
    }

    private fun soundMode(context: Context, mode: String): ActionOutcome {
        val audio = context.getSystemService(AudioManager::class.java)
        val nm = context.getSystemService(NotificationManager::class.java)
        val policy = nm.isNotificationPolicyAccessGranted
        when (mode) {
            "normal" -> {
                if (policy && nm.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL) {
                    nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
                }
                audio.ringerMode = AudioManager.RINGER_MODE_NORMAL
                return ActionOutcome("done", "Som normal")
            }
            "vibrate" -> {
                audio.ringerMode = AudioManager.RINGER_MODE_VIBRATE
                return ActionOutcome("done", "Vibrar")
            }
            "silent" -> {
                if (!policy) return ActionOutcome("blocked", "Falta acesso ao Não perturbe")
                audio.ringerMode = AudioManager.RINGER_MODE_SILENT
                return ActionOutcome("done", "Silencioso")
            }
            "dnd" -> {
                if (!policy) return ActionOutcome("blocked", "Falta acesso ao Não perturbe")
                nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
                return ActionOutcome("done", "Não perturbe")
            }
        }
        return ActionOutcome("failed", "Modo de som desconhecido")
    }

    /** Queues the prompt for the JS agent and wakes it. The result is logged when JS reports back. */
    private fun askAgent(
        context: Context,
        routine: Routine,
        action: JSONObject,
        index: Int,
        values: Map<String, Any>,
        input: Map<String, String>,
        dedupeKey: String?,
    ): ActionOutcome {
        if (!RoutineEngine.isAgentAllowed(context)) return ActionOutcome("blocked", "Rotinas não podem enviar texto ao agente (Configurações)")
        val prompt = RoutinePipeline.fill(action.getString("prompt"), values)
        return enqueue(context, routine, "ask_agent", index, prompt, action.getString("reply"), JSONObject(), input, dedupeKey, "Na fila do agente")
    }

    /**
     * Queues a plugin tool call with its arguments resolved and wakes JS,
     * which runs the tool's handler: no model, no network, no opt-in.
     */
    private fun runTool(
        context: Context,
        routine: Routine,
        action: JSONObject,
        index: Int,
        values: Map<String, Any>,
        input: Map<String, String>,
        dedupeKey: String?,
    ): ActionOutcome {
        val tool = action.getString("tool")
        val payload = JSONObject().put("tool", tool).put("args", RoutineJson.toolArgs(action, values))
        return enqueue(context, routine, "run_tool", index, "", "silent", payload, input, dedupeKey, "Na fila: $tool")
    }

    /** The dedupe key includes the action index, so two actions of one routine don't cancel each other. */
    private fun enqueue(
        context: Context,
        routine: Routine,
        kind: String,
        index: Int,
        prompt: String,
        reply: String,
        payload: JSONObject,
        input: Map<String, String>,
        dedupeKey: String?,
        queuedDetail: String,
    ): ActionOutcome {
        val key = dedupeKey?.let { "${routine.id}|$index|$it" }
        val queued = RoutineStore.get(context).enqueue(routine.id, kind, index, prompt, reply, payload, input, key)
        if (!queued) return ActionOutcome("done", "Já estava na fila")
        if (!EdjiCommandTaskService.start(context, "routine")) RoutineEngine.scheduleQueueWakeup(context)
        return ActionOutcome("done", queuedDetail)
    }

    /** Shows the agent's reply of an `ask_agent` routine. */
    fun notifyReply(context: Context, routineName: String, text: String) {
        if (canNotify(context)) post(context, routineName, text, null, null)
    }

    /**
     * Tells the user a routine failed. One notification per routine, replaced
     * on each failure, so a broken pattern doesn't flood the shade. Tapping
     * opens the Rotinas screen.
     */
    fun notifyFailure(context: Context, routine: Routine, reason: String, openFailures: Int) {
        if (!canNotify(context)) return
        val title = if (openFailures > 1) "Rotina ${routine.name} falhou $openFailures vezes" else "Rotina ${routine.name} falhou"
        val tap = PendingIntent.getActivity(
            context,
            routine.id.hashCode(),
            Intent(Intent.ACTION_VIEW, Uri.parse("edji://routines")).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        post(context, title, "$reason Peça ao Edji para corrigir.", tap, null, id = "failure|${routine.id}".hashCode())
    }

    private fun canNotify(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 33) DevicePermissions.has(context, Manifest.permission.POST_NOTIFICATIONS)
        else context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

    private fun post(context: Context, title: String, text: String, tap: PendingIntent?, timeoutMs: Long?, id: Int = Random.nextInt(1, Int.MAX_VALUE)) {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Rotinas", NotificationManager.IMPORTANCE_HIGH))
        }
        val builder = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setAutoCancel(true)
        if (tap != null) builder.setContentIntent(tap)
        if (timeoutMs != null) builder.setTimeoutAfter(timeoutMs)
        nm.notify(id, builder.build())
    }
}
