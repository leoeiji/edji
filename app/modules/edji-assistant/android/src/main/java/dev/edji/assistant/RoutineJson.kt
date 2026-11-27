package dev.edji.assistant

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs

/**
 * Second check of a routine draft on the native side (the first is
 * `parseRoutineDraft` in JS), the schema 1 → 2 migration, example runs and
 * JSON helpers for the bridge. The native side is the source of truth, so it
 * never stores a shape it can't run. Errors are short Portuguese reasons for
 * the voice session.
 */
object RoutineJson {

    private const val MAX_ACTIONS = 5
    private const val MAX_EXAMPLES = 10
    private const val MAX_TOOL_INPUTS = 10
    private val BLOCKED_SCHEMES = setOf("http", "intent", "file", "content", "javascript", "data", "about", "android-app", "blob")
    private val MAC = Regex("^([0-9A-F]{2}:){5}[0-9A-F]{2}$")
    private val TIME = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
    private val PACKAGE = Regex("^[A-Za-z][\\w]*(\\.[A-Za-z][\\w]*)+$")
    private val TOOL = Regex("^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$")
    private val PARAM = Regex("^[A-Za-z][A-Za-z0-9_]{0,39}$")

    /**
     * Validates [draft] and returns a clean copy with only known fields:
     * `name`, `trigger`, `steps`, `actions`, `examples`. With [runExamples],
     * every example must pass, or the reason says which one broke.
     */
    fun validate(draft: JSONObject, placeIds: Set<String>, runExamples: Boolean = true): JSONObject {
        val name = text(draft, "name", 60, "A rotina precisa de um nome.")
        val trigger = trigger(draft.optJSONObject("trigger") ?: fail("Não conheço esse tipo de gatilho."), placeIds)
        val (steps, refs) = RoutinePipeline.validateSteps(draft.optJSONArray("steps"), RoutinePipeline.inputRefs(trigger.getString("kind")))
        val actions = draft.optJSONArray("actions")
        if (actions == null || actions.length() == 0) fail("A rotina precisa de pelo menos uma ação.")
        if (actions.length() > MAX_ACTIONS) fail("Uma rotina pode ter no máximo $MAX_ACTIONS ações.")
        val cleanActions = JSONArray()
        for (i in 0 until actions.length()) cleanActions.put(action(actions.optJSONObject(i) ?: fail("Não conheço esse tipo de ação."), refs))
        val examples = examples(draft.optJSONArray("examples"), trigger.getString("kind"), refs)
        if (runExamples) checkExamples(steps, examples)
        return JSONObject().put("name", name).put("trigger", trigger).put("steps", steps).put("actions", cleanActions).put("examples", examples)
    }

    private fun trigger(t: JSONObject, placeIds: Set<String>): JSONObject =
        when (t.optString("kind")) {
            "bluetooth" -> {
                val device = t.optJSONObject("device") ?: fail("Não reconheci o aparelho Bluetooth.")
                val address = device.optString("address").trim().uppercase()
                if (!MAC.matches(address)) fail("Não reconheci o aparelho Bluetooth.")
                JSONObject().put("kind", "bluetooth").put("event", oneOf(t, "event", setOf("connected", "disconnected")))
                    .put("device", JSONObject().put("address", address).put("name", text(device, "name", 60, "Não reconheci o aparelho Bluetooth.")))
            }
            "wifi" -> JSONObject().put("kind", "wifi").put("event", oneOf(t, "event", setOf("connected", "disconnected")))
                .put("ssid", text(t, "ssid", 32, "Falta o nome da rede Wi-Fi."))
            "place" -> {
                val placeId = t.optString("placeId")
                if (placeId !in placeIds) fail("Não conheço esse lugar. Salve o lugar antes.")
                JSONObject().put("kind", "place").put("event", oneOf(t, "event", setOf("enter", "exit"))).put("placeId", placeId)
            }
            "time" -> {
                val at = t.optString("at").trim()
                if (!TIME.matches(at)) fail("Horário inválido. Use horas e minutos, como 07:30.")
                val days = sortedSetOf<Int>()
                val raw = t.optJSONArray("days") ?: JSONArray()
                for (i in 0 until raw.length()) {
                    val d = raw.optDouble(i, Double.NaN)
                    if (d.isNaN() || d % 1.0 != 0.0 || d < 1 || d > 7) fail("Não entendi os dias da semana.")
                    days.add(d.toInt())
                }
                JSONObject().put("kind", "time").put("at", at).put("days", JSONArray(days.toList()))
            }
            // Filtering by text is a `match` step since schema 2.
            "notification" -> JSONObject().put("kind", "notification").put("packageName", packageName(t))
                .put("appLabel", text(t, "appLabel", 60, "Falta o app."))
            else -> fail("Não conheço esse tipo de gatilho.")
        }

    private fun action(a: JSONObject, refs: Map<String, RoutinePipeline.Type>): JSONObject =
        when (a.optString("kind")) {
            "open_app" -> JSONObject().put("kind", "open_app").put("packageName", packageName(a)).put("label", text(a, "label", 60, "Falta o app."))
            "notify" -> JSONObject().put("kind", "notify")
                .put("text", RoutinePipeline.template(text(a, "text", 200, "Falta o texto do aviso."), refs, "o aviso"))
            "open_url" -> {
                val url = a.optString("url").trim()
                val scheme = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):.+").find(url)?.groupValues?.get(1)?.lowercase()
                if (scheme == null || scheme in BLOCKED_SCHEMES || url.any { it.isWhitespace() }) fail("Esse link não pode ser aberto por uma rotina.")
                if (scheme == "https" && !Regex("^https://[^/?#]+", RegexOption.IGNORE_CASE).containsMatchIn(url)) {
                    fail("Esse link não pode ser aberto por uma rotina.")
                }
                JSONObject().put("kind", "open_url").put("url", url)
            }
            "sound_mode" -> JSONObject().put("kind", "sound_mode").put("mode", oneOf(a, "mode", setOf("normal", "vibrate", "silent", "dnd")))
            "ask_agent" -> JSONObject().put("kind", "ask_agent")
                .put("prompt", RoutinePipeline.template(text(a, "prompt", 500, "Falta o pedido para o agente."), refs, "o pedido ao agente"))
                .put("reply", oneOf(a, "reply", setOf("silent", "notify")))
            "run_tool" -> {
                val tool = a.optString("tool").trim()
                if (!TOOL.matches(tool) || tool.startsWith("routines.")) fail("Esse tool não pode ser usado por uma rotina.")
                val input = a.optJSONObject("input") ?: JSONObject()
                if (input.length() > MAX_TOOL_INPUTS) fail("O tool $tool recebe valores demais.")
                val clean = JSONObject()
                for (key in input.keys()) {
                    if (!PARAM.matches(key)) fail("Parâmetro inválido para $tool: $key.")
                    clean.put(key, RoutinePipeline.value(input.opt(key), refs, literals = true, what = "$key de $tool"))
                }
                JSONObject().put("kind", "run_tool").put("tool", tool).put("input", clean)
            }
            else -> fail("Não conheço esse tipo de ação.")
        }

    private fun examples(raw: JSONArray?, triggerKind: String, refs: Map<String, RoutinePipeline.Type>): JSONArray {
        val list = raw ?: JSONArray()
        if (list.length() > MAX_EXAMPLES) fail("Uma rotina pode ter no máximo $MAX_EXAMPLES exemplos.")
        val fields = RoutinePipeline.TRIGGER_OUTPUTS[triggerKind].orEmpty().toSet()
        val clean = JSONArray()
        for (i in 0 until list.length()) {
            val e = list.optJSONObject(i) ?: fail("Não entendi o exemplo ${i + 1}.")
            val input = e.optJSONObject("input") ?: fail("Falta a entrada do exemplo ${i + 1}.")
            val cleanInput = JSONObject()
            for (key in input.keys()) {
                if (key !in fields) fail("O exemplo ${i + 1} usa $key, que esse gatilho não tem. Use: ${fields.joinToString()}.")
                val v = input.optString(key)
                if (v.length > RoutinePipeline.MAX_INPUT_LENGTH) fail("O exemplo ${i + 1} é longo demais.")
                cleanInput.put(key, v)
            }
            val out = JSONObject().put("input", cleanInput)
            if (e.optBoolean("skip", false)) out.put("skip", true)
            val outputs = e.optJSONObject("outputs")
            if (outputs != null && outputs.length() > 0) {
                val cleanOutputs = JSONObject()
                for (key in outputs.keys()) {
                    if (key !in refs) fail("O exemplo ${i + 1} espera $key, que a rotina não produz.")
                    val v = outputs.opt(key)
                    if (v !is String && v !is Number) fail("O exemplo ${i + 1} espera um valor inválido em $key.")
                    cleanOutputs.put(key, v)
                }
                out.put("outputs", cleanOutputs)
            }
            clean.put(out)
        }
        return clean
    }

    /** Runs every example; throws the first broken one as a Portuguese reason. */
    fun checkExamples(steps: JSONArray, examples: JSONArray) {
        for (i in 0 until examples.length()) {
            val problem = exampleProblem(steps, examples.getJSONObject(i))
            if (problem != null) fail("O exemplo ${i + 1} $problem")
        }
    }

    /** Why [example] doesn't hold for [steps], or null when it does. */
    fun exampleProblem(steps: JSONArray, example: JSONObject): String? {
        val result = RoutinePipeline.run(steps, stringMap(example.getJSONObject("input")))
        val skip = example.optBoolean("skip", false)
        return when (result) {
            is PipelineResult.Skipped -> if (skip) null else "foi ignorado na etapa ${result.stepId}, mas devia passar."
            is PipelineResult.Failed -> if (skip) "devia ser ignorado, mas falhou: ${result.reason}" else "falhou: ${result.reason}"
            is PipelineResult.Completed -> {
                if (skip) return "devia ser ignorado, mas passou por todas as etapas."
                val outputs = example.optJSONObject("outputs") ?: return null
                for (key in outputs.keys()) {
                    val expected = outputs.get(key)
                    val got = result.values[key]
                    if (!same(expected, got)) return "deu “${got?.let(RoutinePipeline::format) ?: "nada"}” em $key, mas devia dar “${RoutinePipeline.format(expected)}”."
                }
                null
            }
        }
    }

    private fun same(expected: Any, got: Any?): Boolean =
        when {
            got == null -> false
            expected is Number && got is Number -> abs(expected.toDouble() - got.toDouble()) < 1e-9
            else -> RoutinePipeline.format(expected) == RoutinePipeline.format(got)
        }

    /**
     * Dry run for `routines.test`: each case through the steps, then every
     * action's values resolved. Nothing runs and nothing is stored.
     */
    fun test(routine: JSONObject, cases: List<Pair<String, Map<String, String>>>): List<Map<String, Any?>> {
        val steps = routine.getJSONArray("steps")
        val actions = routine.getJSONArray("actions")
        return cases.map { (label, input) ->
            when (val r = RoutinePipeline.run(steps, input)) {
                is PipelineResult.Skipped -> mapOf("label" to label, "outcome" to "skip", "step" to r.stepId)
                is PipelineResult.Failed -> mapOf("label" to label, "outcome" to "fail", "step" to r.stepId, "reason" to r.reason)
                is PipelineResult.Completed -> mapOf(
                    "label" to label,
                    "outcome" to "run",
                    "values" to r.values.filterKeys { !it.startsWith("input.") },
                    "actions" to (0 until actions.length()).map { i -> resolvedAction(actions.getJSONObject(i), r.values) },
                )
            }
        }
    }

    /** An action as it would run with [values]: templates filled, `run_tool` inputs resolved. */
    fun resolvedAction(action: JSONObject, values: Map<String, Any>): Map<String, Any?> =
        when (action.getString("kind")) {
            "notify" -> mapOf("kind" to "notify", "text" to RoutinePipeline.fill(action.getString("text"), values))
            "ask_agent" -> mapOf("kind" to "ask_agent", "prompt" to RoutinePipeline.fill(action.getString("prompt"), values))
            "run_tool" -> mapOf("kind" to "run_tool", "tool" to action.getString("tool"), "input" to toValue(toolArgs(action, values)))
            else -> mapOf("kind" to action.getString("kind"))
        }

    /** Arguments of a `run_tool` action with every reference resolved. A missing reference becomes null. */
    fun toolArgs(action: JSONObject, values: Map<String, Any>): JSONObject {
        val input = action.optJSONObject("input") ?: JSONObject()
        val args = JSONObject()
        for (key in input.keys()) args.put(key, RoutinePipeline.resolve(input.get(key), values) ?: JSONObject.NULL)
        return args
    }

    // Schema migration

    /** Prompt variables of schema 1 and the references that replace them. */
    private val V1_VARIABLES = mapOf(
        "app" to "input.app_name",
        "title" to "input.notification_title",
        "text" to "input.notification_message",
        "postedAt" to "input.posted_at",
        "device" to "input.device_name",
        "ssid" to "input.ssid",
        "place" to "input.place_name",
        "time" to "input.time",
    )

    /**
     * Brings a stored routine from [version] to the current schema. Schema 1 →
     * 2: the notification `textContains` becomes a `match` step named
     * `filter` on title and text (as it matched before), and `ask_agent`
     * prompt variables become `{input.*}` references.
     */
    fun migrate(version: Int, trigger: JSONObject, steps: JSONArray, actions: JSONArray): Triple<JSONObject, JSONArray, JSONArray> {
        if (version >= RoutineStore.SCHEMA_VERSION) return Triple(trigger, steps, actions)
        val newTrigger = JSONObject(trigger.toString())
        val newSteps = JSONArray(steps.toString())
        val filter = newTrigger.optString("textContains").trim()
        newTrigger.remove("textContains")
        if (filter.isNotEmpty()) {
            newSteps.put(
                JSONObject().put("id", "filter").put("kind", "match")
                    .put("input", JSONObject().put("text", JSONObject().put("template", "{input.notification_title}\n{input.notification_message}")))
                    .put("contains", filter).put("onNoMatch", "skip"),
            )
        }
        val newActions = JSONArray()
        for (i in 0 until actions.length()) {
            val a = JSONObject(actions.getJSONObject(i).toString())
            if (a.optString("kind") == "ask_agent") {
                a.put("prompt", Regex("\\{(\\w+)\\}").replace(a.optString("prompt")) { m -> V1_VARIABLES[m.groupValues[1]]?.let { "{$it}" } ?: m.value })
            }
            newActions.put(a)
        }
        return Triple(newTrigger, newSteps, newActions)
    }

    // Bridge helpers

    /** JSON → plain maps and lists, for the Expo bridge. */
    fun toValue(value: Any?): Any? =
        when (value) {
            is JSONObject -> value.keys().asSequence().associateWith { toValue(value.opt(it)) }
            is JSONArray -> (0 until value.length()).map { toValue(value.opt(it)) }
            JSONObject.NULL -> null
            else -> value
        }

    fun stringMap(o: JSONObject): Map<String, String> = o.keys().asSequence().associateWith { o.optString(it) }

    fun routineToMap(r: Routine): Map<String, Any?> =
        mapOf(
            "id" to r.id,
            "name" to r.name,
            "enabled" to r.enabled,
            "trigger" to toValue(r.trigger),
            "steps" to toValue(r.steps),
            "actions" to toValue(r.actions),
            "examples" to toValue(r.examples),
            "createdBy" to r.createdBy,
            "createdAt" to r.createdAt.toDouble(),
            "updatedAt" to r.updatedAt.toDouble(),
            "lastRunAt" to r.lastRunAt?.toDouble(),
        )

    private fun packageName(o: JSONObject): String {
        val name = o.optString("packageName").trim()
        if (!PACKAGE.matches(name)) fail("Falta o app.")
        return name
    }

    private fun text(o: JSONObject, key: String, max: Int, missing: String): String {
        val s = o.optString(key).trim()
        if (s.isEmpty()) fail(missing)
        if (s.length > max) fail(missing)
        return s
    }

    private fun oneOf(o: JSONObject, key: String, options: Set<String>): String {
        val s = o.optString(key)
        if (s !in options) fail("Não entendi a rotina.")
        return s
    }

    private fun fail(reason: String): Nothing = throw IllegalArgumentException(reason)
}
