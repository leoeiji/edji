package dev.edji.assistant

import android.app.role.RoleManager
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge for the voice path: command inbox, assistant role status and the
 * diagnostic log. The voice session itself never needs JS to open the mic.
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

        /** Pending voice commands, oldest first. */
        AsyncFunction("pendingCommands") {
            CommandInbox.get(context).pending().map {
                mapOf("id" to it.id.toDouble(), "text" to it.text, "createdAt" to it.createdAt.toDouble())
            }
        }

        /**
         * Reports the agent's result for a command. Returns false if it was
         * already handled. Logs the time from end of STT to tool executed.
         */
        AsyncFunction("completeCommand") { id: Double, ok: Boolean, reply: String ->
            val inbox = CommandInbox.get(context)
            val createdAt = inbox.pending().firstOrNull { it.id == id.toLong() }?.createdAt
            val changed = inbox.complete(id.toLong(), if (ok) "done" else "failed", reply)
            if (changed && createdAt != null) {
                AssistantLog.log("fim do STT → tool executado: ${System.currentTimeMillis() - createdAt} ms (comando ${id.toLong()})")
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
