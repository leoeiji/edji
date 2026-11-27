package dev.edji.assistant

/**
 * Picks the body of a notification from the candidates apps put in the extras.
 * Many apps leave `EXTRA_TEXT` empty and use InboxStyle lines, MessagingStyle
 * messages or only the sub text, so the first non-blank one wins, in this order.
 * Pure Kotlin so the order is tested on the JVM.
 */
object NotificationText {
    fun pick(
        bigText: CharSequence?,
        text: CharSequence?,
        lines: List<CharSequence>,
        messages: List<CharSequence>,
        subText: CharSequence?,
        ticker: CharSequence?,
        title: String,
    ): String {
        bigText?.toString()?.takeIf { it.isNotBlank() }?.let { return it }
        text?.toString()?.takeIf { it.isNotBlank() }?.let { return it }
        lines.map { it.toString() }.filter { it.isNotBlank() }.takeIf { it.isNotEmpty() }?.let { return it.joinToString("\n") }
        messages.map { it.toString() }.filter { it.isNotBlank() }.takeIf { it.isNotEmpty() }?.let { return it.joinToString("\n") }
        subText?.toString()?.takeIf { it.isNotBlank() }?.let { return it }
        // The ticker often repeats the title; only use it when it adds something.
        ticker?.toString()?.takeIf { it.isNotBlank() && it != title }?.let { return it }
        return ""
    }
}
