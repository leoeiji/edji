package dev.edji.spike

import java.util.Locale

/** Turns a raw transcription into the text stored as a task. */
object TaskText {
    private val ptBr: Locale = Locale.forLanguageTag("pt-BR")
    private val spaces = Regex("\\s+")

    /**
     * Collapses whitespace, drops trailing sentence punctuation and capitalizes
     * the first letter. Returns "" when nothing is left.
     *
     * Example: `clean("  comprar   pão. ")` returns `"Comprar pão"`.
     */
    fun clean(raw: String): String {
        val text = raw.replace(spaces, " ").trim().trimEnd('.', '!', '?', '…', ' ')
        return text.replaceFirstChar { if (it.isLowerCase()) it.titlecase(ptBr) else it.toString() }
    }
}
