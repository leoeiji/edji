package dev.edji.assistant

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Steps, references, examples and the schema 1 → 2 migration (ADR 0005). Phrases are made up; no bank pattern ships with the app. */
class RoutinePipelineTest {

    private fun ref(path: String) = JSONObject().put("ref", path)
    private fun template(text: String) = JSONObject().put("template", text)

    private val notification = JSONObject().put("kind", "notification").put("packageName", "com.example.bank").put("appLabel", "Banco")

    /** Made-up message format, as the agent would write from a user's example. */
    private val extract = JSONObject().put("id", "extract_from_message").put("kind", "extract")
        .put("input", JSONObject().put("text", ref("input.notification_message")))
        .put("pattern", "Compra de R\\$ ?(?<value>[\\d.,]+) aprovada em (?<merchant>.+?)\\.?$")
    private val amount = JSONObject().put("id", "amount").put("kind", "number")
        .put("input", JSONObject().put("text", ref("extract_from_message.output.value"))).put("format", "pt-BR")
    private val addExpense = JSONObject().put("kind", "run_tool").put("tool", "finance.add").put(
        "input",
        JSONObject()
            .put("amount", ref("amount.output.value"))
            .put("description", ref("extract_from_message.output.merchant"))
            .put("direction", "out")
            .put("dedupKey", ref("input.notification_id")),
    )

    private fun draft(steps: List<JSONObject>, actions: List<JSONObject> = listOf(addExpense), examples: List<JSONObject> = emptyList()) =
        JSONObject().put("name", "Gastos").put("trigger", notification).put("steps", JSONArray(steps))
            .put("actions", JSONArray(actions)).put("examples", JSONArray(examples))

    private fun reason(d: JSONObject): String? =
        try {
            RoutineJson.validate(d, emptySet())
            null
        } catch (e: IllegalArgumentException) {
            e.message
        }

    private fun purchase(message: String) = mapOf("notification_message" to message, "notification_id" to "k|1")

    @Test
    fun `extracts, converts and resolves the tool input with types kept`() {
        val routine = RoutineJson.validate(draft(listOf(extract, amount)), emptySet())
        val result = RoutinePipeline.run(routine.getJSONArray("steps"), purchase("Compra de R$ 1.234,56 aprovada em PADARIA X."))
        result as PipelineResult.Completed
        assertEquals("PADARIA X", result.values["extract_from_message.output.merchant"])
        assertEquals(1234.56, result.values["amount.output.value"])
        val args = RoutineJson.toolArgs(routine.getJSONArray("actions").getJSONObject(0), result.values)
        assertEquals(1234.56, args.get("amount"))
        assertEquals("PADARIA X", args.get("description"))
        assertEquals("out", args.get("direction"))
        assertEquals("k|1", args.get("dedupKey"))
    }

    @Test
    fun `extract fails by default and match skips by default`() {
        val steps = RoutineJson.validate(draft(listOf(extract, amount)), emptySet()).getJSONArray("steps")
        val failed = RoutinePipeline.run(steps, purchase("Sua fatura fechou."))
        assertEquals(PipelineResult.Failed("extract_from_message", "Etapa extract_from_message: a regex não encontrou nada."), failed)

        val onlyPurchases = JSONObject().put("id", "only_purchases").put("kind", "match")
            .put("input", JSONObject().put("text", ref("input.notification_message"))).put("contains", "compra")
        val filtered = RoutineJson.validate(draft(listOf(onlyPurchases, extract, amount)), emptySet()).getJSONArray("steps")
        assertEquals(PipelineResult.Skipped("only_purchases"), RoutinePipeline.run(filtered, purchase("Sua fatura fechou.")))
    }

    @Test
    fun `parses Brazilian and US numbers and rejects the rest`() {
        assertEquals(1234.56, RoutinePipeline.parseNumber("R$ 1.234,56", "pt-BR"))
        assertEquals(-45.9, RoutinePipeline.parseNumber("-45,90", "pt-BR"))
        assertEquals(45.0, RoutinePipeline.parseNumber("45", "pt-BR"))
        assertEquals(1234.56, RoutinePipeline.parseNumber("$1,234.56", "en-US"))
        assertNull(RoutinePipeline.parseNumber("1,234.56", "pt-BR"))
        assertNull(RoutinePipeline.parseNumber("", "pt-BR"))
        assertNull(RoutinePipeline.parseNumber("abc", "pt-BR"))
        assertEquals("45.9", RoutinePipeline.format(45.9))
        assertEquals("10000000", RoutinePipeline.format(1.0E7))
    }

    @Test
    fun `rejects references that don't exist or come later`() {
        val early = JSONObject(amount.toString())
        assertEquals(
            "A referência extract_from_message.output.value, usada em a entrada da etapa amount, não existe ou vem depois.",
            reason(draft(listOf(early, extract))),
        )
        val badTool = JSONObject(addExpense.toString())
        badTool.getJSONObject("input").put("amount", ref("amount.output.total"))
        assertTrue(reason(draft(listOf(extract, amount), listOf(badTool)))!!.startsWith("A referência amount.output.total"))
        val badNotify = JSONObject().put("kind", "notify").put("text", "Gasto de {amount.output.total}")
        assertTrue(reason(draft(listOf(extract, amount), listOf(badNotify)))!!.startsWith("A referência {amount.output.total}"))
        assertTrue(reason(draft(listOf(extract, JSONObject(extract.toString())), listOf(addExpense)))!!.contains("se repete"))
    }

    @Test
    fun `rejects patterns RE2 can't run in linear time and bad group names`() {
        val backref = JSONObject(extract.toString()).put("pattern", "(?<value>a)\\1")
        assertTrue(reason(draft(listOf(backref), listOf(JSONObject().put("kind", "notify").put("text", "x"))))!!.contains("não vale no RE2"))
        val camel = JSONObject(extract.toString()).put("pattern", "(?<merchantName>.+)")
        assertEquals(
            "Use nomes de grupo em snake_case na etapa extract_from_message, ex.: (?<value>...).",
            reason(draft(listOf(camel), listOf(JSONObject().put("kind", "notify").put("text", "x")))),
        )
    }

    @Test
    fun `a literal with dots is never a reference`() {
        val tool = JSONObject(addExpense.toString())
        tool.getJSONObject("input").put("description", "amount.output.value")
        val routine = RoutineJson.validate(draft(listOf(extract, amount), listOf(tool)), emptySet())
        val values = (RoutinePipeline.run(routine.getJSONArray("steps"), purchase("Compra de R$ 10,00 aprovada em LOJA")) as PipelineResult.Completed).values
        assertEquals("amount.output.value", RoutineJson.toolArgs(routine.getJSONArray("actions").getJSONObject(0), values).get("description"))
    }

    @Test
    fun `templates render numbers as text`() {
        val notify = JSONObject().put("kind", "notify").put("text", "Gasto de {amount.output.value} em {extract_from_message.output.merchant}")
        val routine = RoutineJson.validate(draft(listOf(extract, amount), listOf(notify)), emptySet())
        val values = (RoutinePipeline.run(routine.getJSONArray("steps"), purchase("Compra de R$ 45,90 aprovada em CAFÉ")) as PipelineResult.Completed).values
        assertEquals("Gasto de 45.9 em CAFÉ", RoutineJson.resolvedAction(routine.getJSONArray("actions").getJSONObject(0), values)["text"])
    }

    @Test
    fun `examples are the routine's tests`() {
        val good = JSONObject().put("input", JSONObject().put("notification_message", "Compra de R$ 45,90 aprovada em CAFÉ"))
            .put("outputs", JSONObject().put("amount.output.value", 45.9).put("extract_from_message.output.merchant", "CAFÉ"))
        assertNull(reason(draft(listOf(extract, amount), examples = listOf(good))))

        val wrong = JSONObject(good.toString()).put("outputs", JSONObject().put("amount.output.value", 45.0))
        assertEquals("O exemplo 1 deu “45.9” em amount.output.value, mas devia dar “45”.", reason(draft(listOf(extract, amount), examples = listOf(wrong))))

        val ad = JSONObject().put("input", JSONObject().put("notification_message", "Fatura fechou")).put("skip", true)
        assertTrue(reason(draft(listOf(extract, amount), examples = listOf(ad)))!!.startsWith("O exemplo 1 devia ser ignorado, mas falhou"))

        val unknownField = JSONObject().put("input", JSONObject().put("ssid", "x"))
        assertTrue(reason(draft(listOf(extract, amount), examples = listOf(unknownField)))!!.contains("que esse gatilho não tem"))
    }

    @Test
    fun `test reports each case without running anything`() {
        val routine = RoutineJson.validate(draft(listOf(extract, amount)), emptySet())
        val results = RoutineJson.test(
            routine,
            listOf("amostra 1" to purchase("Compra de R$ 7,50 aprovada em PÃO"), "falha 3" to purchase("Pix recebido")),
        )
        assertEquals("run", results[0]["outcome"])
        @Suppress("UNCHECKED_CAST")
        val action = (results[0]["actions"] as List<Map<String, Any?>>)[0]
        assertEquals(mapOf("amount" to 7.5, "description" to "PÃO", "direction" to "out", "dedupKey" to "k|1"), action["input"])
        assertEquals("fail", results[1]["outcome"])
        assertEquals("extract_from_message", results[1]["step"])
    }

    @Test
    fun `migrates schema 1 text filter and prompt variables`() {
        val v1Trigger = JSONObject(notification.toString()).put("textContains", "Compra")
        val v1Actions = JSONArray().put(JSONObject().put("kind", "ask_agent").put("prompt", "Registre {title}: {text} ({app})").put("reply", "silent"))
        val (trigger, steps, actions) = RoutineJson.migrate(1, v1Trigger, JSONArray(), v1Actions)
        assertTrue(!trigger.has("textContains"))
        assertEquals("Registre {input.notification_title}: {input.notification_message} ({input.app_name})", actions.getJSONObject(0).getString("prompt"))
        val input = mapOf("notification_title" to "Banco", "notification_message" to "Nova compra")
        assertTrue(RoutinePipeline.run(steps, input) is PipelineResult.Completed)
        assertEquals(PipelineResult.Skipped("filter"), RoutinePipeline.run(steps, mapOf("notification_title" to "Banco", "notification_message" to "Fatura")))
        // The migrated routine passes today's validation.
        assertNull(reason(JSONObject().put("name", "x").put("trigger", trigger).put("steps", steps).put("actions", actions)))
    }

    @Test
    fun `an old prompt variable is rejected, not sent as plain text`() {
        val notify = JSONObject().put("kind", "notify").put("text", "Gasto: {text}")
        assertTrue(reason(draft(listOf(extract, amount), listOf(notify)))!!.startsWith("A referência {text}"))
    }

    @Test
    fun `a run_tool action can't call routines tools`() {
        val tool = JSONObject(addExpense.toString()).put("tool", "routines.delete")
        assertEquals("Esse tool não pode ser usado por uma rotina.", reason(draft(listOf(extract, amount), listOf(tool))))
    }
}
