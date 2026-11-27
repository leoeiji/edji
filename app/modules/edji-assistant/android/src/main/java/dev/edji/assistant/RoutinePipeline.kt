package dev.edji.assistant

import com.google.re2j.Pattern
import com.google.re2j.PatternSyntaxException
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal

/** How the steps of one firing ended (ADR 0005, schema 2). */
sealed class PipelineResult {
    /** Every step passed. [values] maps each reference (`input.x`, `step.output.y`) to a String or Double. */
    data class Completed(val values: Map<String, Any>) : PipelineResult()

    /** A step with `onNoMatch = skip` stopped the routine on purpose: nothing runs, nothing is logged. */
    data class Skipped(val stepId: String) : PipelineResult()

    /** A step failed; the firing goes to the failure queue. [reason] is short Portuguese, without the input text. */
    data class Failed(val stepId: String, val reason: String) : PipelineResult()
}

/**
 * The steps between a routine's trigger and its actions, and the values they
 * pass along (ADR 0005, schema 2). Pure Kotlin with no `Context`, so the JVM
 * tests cover it. Regexes run on RE2J: linear time, so a pattern written by a
 * model can't hang on text from another app, and the same engine runs on the
 * JVM and on the device (Android's `java.util.regex` is ICU and has no timeout).
 */
object RoutinePipeline {

    const val MAX_STEPS = 5
    const val MAX_PATTERN_LENGTH = 300
    const val MAX_CONTAINS_LENGTH = 100
    const val MAX_TEMPLATE_LENGTH = 500
    /** Longer trigger text is cut before the steps see it. */
    const val MAX_INPUT_LENGTH = 4000

    enum class Type { TEXT, NUMBER }

    /** What each trigger kind hands to the steps and actions, as `input.<name>`. Always text. */
    val TRIGGER_OUTPUTS: Map<String, List<String>> = mapOf(
        "bluetooth" to listOf("device_name", "device_address"),
        "wifi" to listOf("ssid"),
        "place" to listOf("place_name"),
        "time" to listOf("time"),
        "notification" to listOf("app_name", "notification_title", "notification_message", "notification_id", "posted_at"),
    )

    private const val NAME = "[a-z][a-z0-9_]{0,39}"
    private val ID = Regex("^$NAME$")
    private val REF = Regex("^(input\\.$NAME|$NAME\\.output\\.$NAME)$")
    /** `{input.x}` or `{step.output.y}` inside a template. Other braces stay as typed. */
    val PLACEHOLDER = Regex("\\{($NAME(?:\\.$NAME)+)\\}")
    /** Anything that looks like a variable; validation requires it to be a valid reference (an old `{text}` never passes). */
    private val VARIABLE = Regex("\\{([A-Za-z_][\\w.]*)\\}")
    private val FORMATS = setOf("pt-BR", "en-US")
    private val PT_BR = Regex("^-?(\\d{1,3}(\\.\\d{3})+|\\d+)(,\\d+)?$")
    private val EN_US = Regex("^-?(\\d{1,3}(,\\d{3})+|\\d+)(\\.\\d+)?$")

    /** References a trigger offers before any step. */
    fun inputRefs(triggerKind: String): Map<String, Type> =
        TRIGGER_OUTPUTS[triggerKind].orEmpty().associate { "input.$it" to Type.TEXT }

    // Validation

    /**
     * Validates [raw] steps against the references [available] before them.
     * Returns a clean copy and every reference available after the steps.
     */
    fun validateSteps(raw: JSONArray?, available: Map<String, Type>): Pair<JSONArray, Map<String, Type>> {
        val steps = raw ?: JSONArray()
        if (steps.length() > MAX_STEPS) fail("Uma rotina pode ter no máximo $MAX_STEPS etapas.")
        val refs = available.toMutableMap()
        val ids = mutableSetOf<String>()
        val clean = JSONArray()
        for (i in 0 until steps.length()) {
            val s = steps.optJSONObject(i) ?: fail("Não entendi a etapa ${i + 1}.")
            val id = s.optString("id").trim()
            if (!ID.matches(id) || id == "input") fail("Cada etapa precisa de um id em snake_case, ex.: extract_value.")
            if (!ids.add(id)) fail("O id de etapa $id se repete.")
            val input = s.optJSONObject("input") ?: fail("Falta o texto de entrada da etapa $id.")
            val text = value(input.opt("text"), refs, literals = false, what = "a entrada da etapa $id")
            val out = JSONObject().put("id", id).put("kind", s.optString("kind")).put("input", JSONObject().put("text", text))
            when (s.optString("kind")) {
                "match" -> {
                    val contains = s.optString("contains").trim()
                    if (contains.isEmpty() || contains.length > MAX_CONTAINS_LENGTH) fail("A etapa $id precisa de um texto curto para procurar.")
                    out.put("contains", contains).put("onNoMatch", onNoMatch(s, "skip", id))
                }
                "extract" -> {
                    val pattern = s.optString("pattern")
                    if (pattern.isEmpty() || pattern.length > MAX_PATTERN_LENGTH) fail("A regex da etapa $id está vazia ou longa demais.")
                    for (group in groupNames(pattern, id)) refs["$id.output.$group"] = Type.TEXT
                    out.put("pattern", pattern).put("onNoMatch", onNoMatch(s, "fail", id))
                }
                "number" -> {
                    val format = s.optString("format", "pt-BR")
                    if (format !in FORMATS) fail("A etapa $id precisa do formato pt-BR ou en-US.")
                    out.put("format", format)
                    refs["$id.output.value"] = Type.NUMBER
                }
                else -> fail("Não conheço o tipo da etapa $id.")
            }
            clean.put(out)
        }
        return clean to refs
    }

    /** Named groups of an RE2 [pattern]; they become the step's outputs. Throws a Portuguese reason on a bad pattern. */
    fun groupNames(pattern: String, stepId: String): Set<String> {
        val compiled = try {
            Pattern.compile(pattern)
        } catch (e: PatternSyntaxException) {
            fail("A regex da etapa $stepId não vale no RE2 (sem lookaround nem backreference): ${e.description}.")
        }
        val names = compiled.namedGroups().keys
        for (name in names) if (!ID.matches(name)) fail("Use nomes de grupo em snake_case na etapa $stepId, ex.: (?<value>...).")
        return names
    }

    /**
     * Validates a value of a step or `run_tool` input: a reference
     * `{"ref": ...}`, a template `{"template": ...}` or, when [literals], a
     * plain string, number or boolean. Returns a clean copy.
     */
    fun value(v: Any?, refs: Map<String, Type>, literals: Boolean, what: String): Any =
        when {
            v is JSONObject && v.has("ref") -> {
                val ref = v.optString("ref").trim()
                if (!REF.matches(ref) || ref !in refs) fail("A referência $ref, usada em $what, não existe ou vem depois.")
                JSONObject().put("ref", ref)
            }
            v is JSONObject && v.has("template") -> JSONObject().put("template", template(v.optString("template"), refs, what))
            literals && v is String -> {
                if (v.length > MAX_TEMPLATE_LENGTH) fail("O texto de $what é longo demais.")
                v
            }
            literals && (v is Number || v is Boolean) -> v
            else -> fail("Não entendi $what. Use {\"ref\": ...} ou {\"template\": ...}.")
        }

    /** Validates the `{ref}` placeholders of a template. */
    fun template(text: String, refs: Map<String, Type>, what: String): String {
        if (text.isBlank()) fail("Falta o texto de $what.")
        if (text.length > MAX_TEMPLATE_LENGTH) fail("O texto de $what é longo demais.")
        for (m in VARIABLE.findAll(text)) {
            val ref = m.groupValues[1]
            if (!REF.matches(ref) || ref !in refs) fail("A referência {$ref}, usada em $what, não existe ou vem depois.")
        }
        return text
    }

    private fun onNoMatch(s: JSONObject, default: String, id: String): String {
        val v = s.optString("onNoMatch", default).ifEmpty { default }
        if (v != "skip" && v != "fail") fail("Na etapa $id, onNoMatch é skip ou fail.")
        return v
    }

    // Execution

    /** Runs [steps] (already validated) on the trigger's [input]. Never throws. */
    fun run(steps: JSONArray, input: Map<String, String>): PipelineResult {
        val values = linkedMapOf<String, Any>()
        for ((k, v) in input) values["input.$k"] = v.take(MAX_INPUT_LENGTH)
        for (i in 0 until steps.length()) {
            val s = steps.getJSONObject(i)
            val id = s.getString("id")
            try {
                val text = resolve(s.getJSONObject("input").get("text"), values)?.let(::format).orEmpty()
                when (s.getString("kind")) {
                    "match" -> if (!text.contains(s.getString("contains"), ignoreCase = true)) {
                        return noMatch(s, id, "Etapa $id: o texto não contém “${s.getString("contains")}”.")
                    }
                    "extract" -> {
                        val m = Pattern.compile(s.getString("pattern")).matcher(text)
                        if (!m.find()) return noMatch(s, id, "Etapa $id: a regex não encontrou nada.")
                        for (name in m.pattern().namedGroups().keys) values["$id.output.$name"] = m.group(name) ?: ""
                    }
                    "number" -> values["$id.output.value"] = parseNumber(text, s.getString("format"))
                        ?: return PipelineResult.Failed(id, "Etapa $id: o texto não é um número.")
                    else -> return PipelineResult.Failed(id, "Etapa $id: tipo desconhecido.")
                }
            } catch (e: Exception) {
                return PipelineResult.Failed(id, "Etapa $id: algo falhou.")
            }
        }
        return PipelineResult.Completed(values)
    }

    private fun noMatch(s: JSONObject, id: String, reason: String): PipelineResult =
        if (s.optString("onNoMatch") == "skip") PipelineResult.Skipped(id) else PipelineResult.Failed(id, reason)

    /** A value with references resolved: a reference keeps its type, a template is text, literals stay. */
    fun resolve(v: Any?, values: Map<String, Any>): Any? =
        when {
            v is JSONObject && v.has("ref") -> values[v.getString("ref")]
            v is JSONObject && v.has("template") -> fill(v.getString("template"), values)
            v == JSONObject.NULL -> null
            else -> v
        }

    /** Replaces `{ref}` placeholders; unknown ones stay as typed. */
    fun fill(template: String, values: Map<String, Any>): String =
        PLACEHOLDER.replace(template) { m -> values[m.groupValues[1]]?.let(::format) ?: m.value }

    /** Text form of a value: numbers without a trailing `.0` or exponent ("45.9", "1234"). */
    fun format(v: Any): String =
        when (v) {
            is Double -> BigDecimal.valueOf(v).stripTrailingZeros().toPlainString()
            is Float -> BigDecimal.valueOf(v.toDouble()).stripTrailingZeros().toPlainString()
            else -> v.toString()
        }

    /** "R$ 1.234,56" (pt-BR) or "$1,234.56" (en-US) → 1234.56. Null when it isn't a number. */
    fun parseNumber(text: String, format: String): Double? {
        val s = text.replace("R$", "").replace("$", "").filterNot { it.isWhitespace() || it == ' ' }
        return when (format) {
            "pt-BR" -> if (PT_BR.matches(s)) s.replace(".", "").replace(',', '.').toDoubleOrNull() else null
            "en-US" -> if (EN_US.matches(s)) s.replace(",", "").toDoubleOrNull() else null
            else -> null
        }
    }

    private fun fail(reason: String): Nothing = throw IllegalArgumentException(reason)
}
