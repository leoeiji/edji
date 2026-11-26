package dev.edji.assistant

import org.json.JSONArray
import org.json.JSONObject

/**
 * Second check of a routine draft on the native side (the first is
 * `parseRoutineDraft` in JS), plus JSON helpers for the bridge. The native
 * side is the source of truth, so it never stores a shape it can't run.
 * Errors are short Portuguese reasons for the voice session.
 */
object RoutineJson {

    private const val MAX_ACTIONS = 5
    private val BLOCKED_SCHEMES = setOf("http", "intent", "file", "content", "javascript", "data", "about", "android-app", "blob")
    private val MAC = Regex("^([0-9A-F]{2}:){5}[0-9A-F]{2}$")
    private val TIME = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
    private val PACKAGE = Regex("^[A-Za-z][\\w]*(\\.[A-Za-z][\\w]*)+$")

    /** Validates [draft] and returns a clean copy with only known fields. */
    fun validate(draft: JSONObject, placeIds: Set<String>): JSONObject {
        val name = text(draft, "name", 60, "A rotina precisa de um nome.")
        val trigger = trigger(draft.optJSONObject("trigger") ?: fail("Não conheço esse tipo de gatilho."), placeIds)
        val actions = draft.optJSONArray("actions")
        if (actions == null || actions.length() == 0) fail("A rotina precisa de pelo menos uma ação.")
        if (actions.length() > MAX_ACTIONS) fail("Uma rotina pode ter no máximo $MAX_ACTIONS ações.")
        val clean = JSONArray()
        for (i in 0 until actions.length()) clean.put(action(actions.optJSONObject(i) ?: fail("Não conheço esse tipo de ação.")))
        return JSONObject().put("name", name).put("trigger", trigger).put("actions", clean)
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
            "notification" -> {
                val out = JSONObject().put("kind", "notification").put("packageName", packageName(t))
                    .put("appLabel", text(t, "appLabel", 60, "Falta o app."))
                val filter = t.optString("textContains").trim()
                if (filter.isNotEmpty()) out.put("textContains", filter.take(100))
                out
            }
            else -> fail("Não conheço esse tipo de gatilho.")
        }

    private fun action(a: JSONObject): JSONObject =
        when (a.optString("kind")) {
            "open_app" -> JSONObject().put("kind", "open_app").put("packageName", packageName(a)).put("label", text(a, "label", 60, "Falta o app."))
            "notify" -> JSONObject().put("kind", "notify").put("text", text(a, "text", 200, "Falta o texto do aviso."))
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
            "ask_agent" -> JSONObject().put("kind", "ask_agent").put("prompt", text(a, "prompt", 500, "Falta o pedido para o agente."))
                .put("reply", oneOf(a, "reply", setOf("silent", "notify")))
            else -> fail("Não conheço esse tipo de ação.")
        }

    /** Fills `{name}` variables of a prompt; unknown ones stay as typed. */
    fun fill(template: String, vars: Map<String, String>): String =
        Regex("\\{(\\w+)\\}").replace(template) { m -> vars[m.groupValues[1]] ?: m.value }

    /** JSON → plain maps and lists, for the Expo bridge. */
    fun toValue(value: Any?): Any? =
        when (value) {
            is JSONObject -> value.keys().asSequence().associateWith { toValue(value.opt(it)) }
            is JSONArray -> (0 until value.length()).map { toValue(value.opt(it)) }
            JSONObject.NULL -> null
            else -> value
        }

    fun routineToMap(r: Routine): Map<String, Any?> =
        mapOf(
            "id" to r.id,
            "name" to r.name,
            "enabled" to r.enabled,
            "trigger" to toValue(r.trigger),
            "actions" to toValue(r.actions),
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
