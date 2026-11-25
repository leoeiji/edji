package dev.edji.assistant

import android.app.role.RoleManager
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge for the voice path: command inbox (with streamed replies),
 * assistant role status and the diagnostic log. The voice session itself never needs JS to open the mic.
 */
class EdjiAssistantModule : Module() {

    private val context
        get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

    private val logListener: (String) -> Unit = { line -> sendEvent("onLog", mapOf("line" to line)) }

    override fun definition() = ModuleDefinition {
        Name("EdjiAssistant")

        Events("onLog")

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

        Function("openAssistantSettings") {
            val intent = Intent(Settings.ACTION_VOICE_INPUT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
            } catch (e: Exception) {
                context.startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
    }
}
