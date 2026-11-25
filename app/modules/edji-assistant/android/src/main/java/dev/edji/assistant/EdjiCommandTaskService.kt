package dev.edji.assistant

import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs the JS task `EdjiCommand` without UI. Started twice per voice session:
 * once with `warmup` when the session opens (so the JS runtime boots while the
 * user speaks) and once after the transcript is in the inbox.
 */
class EdjiCommandTaskService : HeadlessJsTaskService() {

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
        val extras = intent?.extras
        return HeadlessJsTaskConfig(
            TASK_NAME,
            if (extras != null) Arguments.fromBundle(extras) else Arguments.createMap(),
            TIMEOUT_MS,
            true, // also allowed while the app is in the foreground
        )
    }

    companion object {
        const val TASK_NAME = "EdjiCommand"
        /** Long enough for a model reply; the session gives up earlier on its own. */
        private const val TIMEOUT_MS = 60_000L

        /** Starts the JS task. Returns false (and logs) if Android refuses to start the service. */
        fun start(context: Context, reason: String, commandId: Long? = null): Boolean = try {
            val intent = Intent(context, EdjiCommandTaskService::class.java).apply {
                putExtra("reason", reason)
                putExtra("requestedAt", System.currentTimeMillis().toDouble())
                if (commandId != null) putExtra("commandId", commandId.toDouble())
            }
            context.startService(intent)
            HeadlessJsTaskService.acquireWakeLockNow(context)
            true
        } catch (e: Exception) {
            AssistantLog.log("js: não consegui iniciar o serviço ($reason): ${e.javaClass.simpleName} ${e.message}")
            false
        }
    }
}
