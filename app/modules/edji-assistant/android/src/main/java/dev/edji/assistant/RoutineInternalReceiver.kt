package dev.edji.assistant

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.LocationManager

/**
 * Not exported: only Edji's own PendingIntents reach it (alarms, proximity
 * alerts, network callbacks and the `ask_agent` queue wakeup).
 */
class RoutineInternalReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        val pending = goAsync()
        RoutineEngine.post {
            try {
                when (intent.action) {
                    ACTION_TIME -> intent.data?.lastPathSegment?.let { RoutineEngine.onTime(app, it) }
                    ACTION_PLACE -> {
                        val placeId = intent.data?.lastPathSegment ?: return@post
                        if (!intent.hasExtra(LocationManager.KEY_PROXIMITY_ENTERING)) return@post
                        RoutineEngine.onPlace(app, placeId, intent.getBooleanExtra(LocationManager.KEY_PROXIMITY_ENTERING, false))
                    }
                    ACTION_NETWORK -> RoutineEngine.onNetworkChanged(app)
                    ACTION_QUEUE -> if (!EdjiCommandTaskService.start(app, "routine")) RoutineEngine.scheduleQueueWakeup(app)
                }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_TIME = "dev.edji.assistant.ROUTINE_TIME"
        const val ACTION_PLACE = "dev.edji.assistant.ROUTINE_PLACE"
        const val ACTION_NETWORK = "dev.edji.assistant.ROUTINE_NETWORK"
        const val ACTION_QUEUE = "dev.edji.assistant.ROUTINE_QUEUE"
    }
}
