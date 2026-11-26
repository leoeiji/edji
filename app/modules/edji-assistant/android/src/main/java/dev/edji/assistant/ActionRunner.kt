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
 * The catalog is closed: no arbitrary intents.
 */
object ActionRunner {

    private const val CHANNEL_ID = "routines"
    /** A "tap to open" notification disappears if left alone. */
    private const val TAP_TIMEOUT_MS = 2 * 60_000L

    fun run(context: Context, routine: Routine, action: JSONObject, vars: Map<String, String>, dedupeKey: String?): ActionOutcome =
        try {
            when (action.getString("kind")) {
                "open_app" -> openApp(context, routine, action.getString("packageName"), action.getString("label"))
                "open_url" -> openUrl(context, routine, action.getString("url"))
                "notify" -> notifyText(context, routine.name, action.getString("text"))
                "sound_mode" -> soundMode(context, action.getString("mode"))
                "ask_agent" -> askAgent(context, routine, action, vars, dedupeKey)
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
        return start(context, routine, launch, "Abriu $label", "Toque para abrir $label")
    }

    private fun openUrl(context: Context, routine: Routine, url: String): ActionOutcome {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        if (intent.resolveActivity(context.packageManager) == null) return ActionOutcome("failed", "Nenhum app abre esse link")
        return start(context, routine, intent, "Abriu o link", "Toque para abrir o link")
    }

    /**
     * Starts [intent] directly when Android allows it from the background;
     * otherwise posts a notification the user taps (ADR 0005, to validate).
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
    private fun askAgent(context: Context, routine: Routine, action: JSONObject, vars: Map<String, String>, dedupeKey: String?): ActionOutcome {
        if (!RoutineEngine.isAgentAllowed(context)) return ActionOutcome("blocked", "Rotinas não podem enviar texto ao agente (Configurações)")
        val prompt = RoutineJson.fill(action.getString("prompt"), vars)
        val queued = RoutineStore.get(context).enqueue(routine.id, prompt, action.getString("reply"), dedupeKey?.let { "${routine.id}|$it" })
        if (!queued) return ActionOutcome("done", "Já estava na fila")
        if (!EdjiCommandTaskService.start(context, "routine")) RoutineEngine.scheduleQueueWakeup(context)
        return ActionOutcome("done", "Na fila do agente")
    }

    /** Shows the agent's reply of an `ask_agent` routine. */
    fun notifyReply(context: Context, routineName: String, text: String) {
        if (canNotify(context)) post(context, routineName, text, null, null)
    }

    private fun canNotify(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 33) DevicePermissions.has(context, Manifest.permission.POST_NOTIFICATIONS)
        else context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

    private fun post(context: Context, title: String, text: String, tap: PendingIntent?, timeoutMs: Long?) {
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
        nm.notify(Random.nextInt(1, Int.MAX_VALUE), builder.build())
    }
}
