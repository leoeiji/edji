package dev.edji.assistant

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class RoutineLogicTest {

    private val car = JSONObject().put("kind", "bluetooth").put("event", "connected")
        .put("device", JSONObject().put("address", "4c:11:22:33:44:9a").put("name", "Carro"))
    private val spotify = JSONObject().put("kind", "open_app").put("packageName", "com.spotify.music").put("label", "Spotify")

    private fun draft(trigger: JSONObject, vararg actions: JSONObject) =
        JSONObject().put("name", " Spotify no carro ").put("trigger", trigger).put("actions", JSONArray(actions.toList()))

    private fun reason(draft: JSONObject, places: Set<String> = emptySet()): String? =
        try {
            RoutineJson.validate(draft, places)
            null
        } catch (e: IllegalArgumentException) {
            e.message
        }

    @Test
    fun `validates and normalizes the car routine`() {
        val clean = RoutineJson.validate(draft(car, spotify).put("extra", 1), emptySet())
        assertEquals("Spotify no carro", clean.getString("name"))
        assertEquals("4C:11:22:33:44:9A", clean.getJSONObject("trigger").getJSONObject("device").getString("address"))
        assertEquals(setOf("name", "trigger", "steps", "actions", "examples"), clean.keys().asSequence().toSet())
    }

    @Test
    fun `rejects what the engine can't run`() {
        assertEquals("A rotina precisa de pelo menos uma ação.", reason(draft(car)))
        assertEquals("Não conheço esse lugar. Salve o lugar antes.", reason(draft(JSONObject().put("kind", "place").put("event", "enter").put("placeId", "x"), spotify)))
        assertEquals("Esse link não pode ser aberto por uma rotina.", reason(draft(car, JSONObject().put("kind", "open_url").put("url", "intent://x#Intent;end"))))
        assertEquals("Esse link não pode ser aberto por uma rotina.", reason(draft(car, JSONObject().put("kind", "open_url").put("url", "http://example.com"))))
        assertEquals("Horário inválido. Use horas e minutos, como 07:30.", reason(draft(JSONObject().put("kind", "time").put("at", "24:00"), spotify)))
        assertEquals("Não conheço esse tipo de ação.", reason(draft(car, JSONObject().put("kind", "wifi_off"))))
    }

    @Test
    fun `accepts days as numbers from JS and sorts them`() {
        val time = JSONObject().put("kind", "time").put("at", "07:00").put("days", JSONArray(listOf(5.0, 1.0, 3.0, 1.0)))
        val clean = RoutineJson.validate(draft(time, spotify), emptySet())
        assertEquals("[1,3,5]", clean.getJSONObject("trigger").getJSONArray("days").toString())
    }

    @Test
    fun `fills prompt references and keeps unknown ones`() {
        val values = mapOf("input.notification_title" to "Compra aprovada", "input.notification_message" to "R$ 45,90 em PADARIA")
        assertEquals(
            "Registre: Compra aprovada — R$ 45,90 em PADARIA {x} {input.missing}",
            RoutinePipeline.fill("Registre: {input.notification_title} — {input.notification_message} {x} {input.missing}", values),
        )
    }

    private val zone = ZoneId.of("America/Sao_Paulo")
    private fun at(day: Int, h: Int, m: Int) = ZonedDateTime.of(2026, 11, day, h, m, 0, 0, zone) // 2026-11-25 is a Wednesday

    @Test
    fun `next time is later today, tomorrow or the next chosen weekday`() {
        assertEquals(at(25, 22, 0), RoutineEngine.nextTime("22:00", emptyList(), at(25, 21, 0)))
        assertEquals(at(26, 7, 0), RoutineEngine.nextTime("07:00", emptyList(), at(25, 21, 0)))
        assertEquals(at(26, 21, 0), RoutineEngine.nextTime("21:00", emptyList(), at(25, 21, 0)))
        assertEquals(at(30, 7, 0), RoutineEngine.nextTime("07:00", listOf(1), at(25, 21, 0)))
        assertEquals(at(27, 18, 0), RoutineEngine.nextTime("18:00", listOf(5), at(25, 21, 0)))
    }

    @Test
    fun `invalid names throw`() {
        assertThrows(IllegalArgumentException::class.java) { RoutineJson.validate(draft(car, spotify).put("name", "  "), emptySet()) }
    }
}
