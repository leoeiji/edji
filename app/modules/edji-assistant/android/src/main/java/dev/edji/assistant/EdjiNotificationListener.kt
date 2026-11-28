package dev.edji.assistant

import android.app.Notification
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Feeds the `notification` trigger (ADR 0005). Android binds it only after
 * the user grants notification access. The text is matched on the device;
 * it is stored only in the failure queue and in routine examples, and leaves
 * only through an `ask_agent` routine with the opt-in on or when the user asks
 * the agent about a routine.
 */
class EdjiNotificationListener : NotificationListenerService() {

    override fun onListenerConnected() {
        instance = this
    }

    override fun onListenerDisconnected() {
        if (instance === this) instance = null
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName) return
        val (title, text) = textOf(sbn) ?: return
        val app = applicationContext
        RoutineEngine.post { RoutineEngine.onNotification(app, sbn.packageName, title, text, sbn.postTime, sbn.key) }
    }

    /**
     * Notifications of [pkg] showing now, newest first, as the trigger would
     * see them. For `routines.sample_notifications`: read live, never stored.
     */
    fun active(pkg: String): List<Map<String, Any>> =
        activeNotifications.orEmpty()
            .filter { it.packageName == pkg }
            .sortedByDescending { it.postTime }
            .mapNotNull { sbn ->
                val (title, text) = textOf(sbn) ?: return@mapNotNull null
                val sample = mutableMapOf<String, Any>(
                    "notification_title" to title,
                    "notification_message" to text,
                    "posted_at" to java.time.Instant.ofEpochMilli(sbn.postTime).toString(),
                )
                // Without a body, say what the app did send, so the cause can be seen (keys only, never values).
                if (text.isEmpty()) sample["debug_extras"] = sbn.notification.extras.keySet().sorted().joinToString(",")
                sample
            }
            .take(MAX_SAMPLES)

    /** Title and text, or null for what the trigger ignores (group summaries, ongoing, empty). */
    private fun textOf(sbn: StatusBarNotification): Pair<String, String>? {
        val n = sbn.notification
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0 || n.flags and Notification.FLAG_ONGOING_EVENT != 0) return null
        val extras = n.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val messages = extras.getParcelableArray(Notification.EXTRA_MESSAGES).orEmpty()
            .mapNotNull { (it as? Bundle)?.getCharSequence("text") }
        val text = NotificationText.pick(
            bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT),
            text = extras.getCharSequence(Notification.EXTRA_TEXT),
            lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.toList().orEmpty(),
            messages = messages,
            subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT),
            ticker = n.tickerText,
            title = title,
        )
        val body = text.ifEmpty { remoteViewsText(n, title) }
        if (title.isEmpty() && body.isEmpty()) return null
        return title to body
    }

    /**
     * Last resort for apps that draw their own layout and leave the extras
     * empty: inflate the custom RemoteViews and read its text views. The
     * title is dropped; blank and repeated texts too.
     */
    @Suppress("DEPRECATION")
    private fun remoteViewsText(n: Notification, title: String): String {
        val views = n.bigContentView ?: n.contentView ?: return ""
        return try {
            val root = views.apply(applicationContext, FrameLayout(applicationContext))
            val texts = LinkedHashSet<String>()
            fun walk(v: View) {
                if (v is TextView) v.text?.toString()?.trim()?.takeIf { it.isNotEmpty() && it != title }?.let { texts.add(it) }
                if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
            }
            walk(root)
            texts.joinToString("\n")
        } catch (e: Exception) {
            ""
        }
    }

    companion object {
        private const val MAX_SAMPLES = 5

        /** The bound listener, or null without notification access. */
        @Volatile
        var instance: EdjiNotificationListener? = null
            private set
    }
}
