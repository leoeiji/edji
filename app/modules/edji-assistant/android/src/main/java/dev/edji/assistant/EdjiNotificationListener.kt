package dev.edji.assistant

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Feeds the `notification` trigger (ADR 0005). Android binds it only after
 * the user grants notification access. The text is matched on the device;
 * it leaves only through an `ask_agent` routine with the opt-in on.
 */
class EdjiNotificationListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName) return
        val n = sbn.notification
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0 || n.flags and Notification.FLAG_ONGOING_EVENT != 0) return
        val extras = n.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
        if (title.isEmpty() && text.isEmpty()) return
        val app = applicationContext
        RoutineEngine.post { RoutineEngine.onNotification(app, sbn.packageName, title, text, sbn.postTime, sbn.key) }
    }
}
