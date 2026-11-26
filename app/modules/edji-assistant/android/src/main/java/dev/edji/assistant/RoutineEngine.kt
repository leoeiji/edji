package dev.edji.assistant

import android.Manifest
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.net.wifi.WifiManager
import java.time.ZonedDateTime
import java.util.concurrent.Executors

/**
 * The routines engine (ADR 0005). [sync] registers with Android what the
 * enabled routines listen to (alarms, proximity alerts, network callbacks);
 * the receivers and the notification listener call the `on*` methods, which
 * match routines and run their actions on a background thread.
 *
 * Bluetooth (ACL broadcasts) and notifications (listener service) are
 * declared in the manifest and filtered here, so they need no registration.
 */
object RoutineEngine {

    private const val PREFS = "edji-routines"
    private const val KEY_AGENT_ALLOWED = "agent_allowed"
    private const val KEY_WIFI_SSID = "wifi_last_ssid"
    private const val KEY_TIME_IDS = "time_routine_ids"
    private const val KEY_PLACES = "proximity_places"
    private const val KEY_PAUSED = "paused"
    /** Ignore a second firing of the same routine this soon (Bluetooth and Wi-Fi flap). */
    private const val COOLDOWN_MS = 30_000L
    private const val MAX_SEEN_KEYS = 200

    private val worker = Executors.newSingleThreadExecutor()
    private val seenKeys = LinkedHashSet<String>()

    /** Runs [block] on the engine thread; never on the main thread (no I/O there). */
    fun post(block: () -> Unit) {
        worker.execute {
            try {
                block()
            } catch (e: Exception) {
                AssistantLog.log("rotinas: erro: ${e.javaClass.simpleName} ${e.message}")
            }
        }
    }

    fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isAgentAllowed(context: Context): Boolean = prefs(context).getBoolean(KEY_AGENT_ALLOWED, false)

    fun setAgentAllowed(context: Context, allowed: Boolean) {
        prefs(context).edit().putBoolean(KEY_AGENT_ALLOWED, allowed).apply()
    }

    /** Paused when the user turns the Rotinas plugin off: nothing fires, nothing is registered. */
    fun isPaused(context: Context): Boolean = prefs(context).getBoolean(KEY_PAUSED, false)

    fun setPaused(context: Context, paused: Boolean) {
        prefs(context).edit().putBoolean(KEY_PAUSED, paused).apply()
    }

    /** Routines that may fire now: none while paused. */
    private fun active(context: Context): List<Routine> =
        if (isPaused(context)) emptyList() else RoutineStore.get(context).enabledRoutines()

    // Registration

    /**
     * Brings Android's registrations in line with the enabled routines. Call
     * after any change. [afterBoot]: Android forgot the proximity alerts
     * (boot, app update), so they are all added again.
     */
    fun sync(context: Context, afterBoot: Boolean = false) {
        val app = context.applicationContext
        val routines = active(app)
        syncTime(app, routines)
        syncPlaces(app, routines, afterBoot)
        syncWifi(app, routines.any { it.trigger.optString("kind") == "wifi" })
        val due = RoutineStore.get(app).nextDueAt()
        if (due != null) scheduleQueueWakeup(app, due)
    }

    private fun syncTime(context: Context, routines: List<Routine>) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        val timed = routines.filter { it.trigger.optString("kind") == "time" }
        val previous = prefs(context).getStringSet(KEY_TIME_IDS, emptySet()).orEmpty()
        for (id in previous - timed.map { it.id }.toSet()) alarms.cancel(timePendingIntent(context, id))
        for (r in timed) {
            val days = r.trigger.optJSONArray("days")?.let { a -> (0 until a.length()).map { a.getInt(it) } }.orEmpty()
            val next = nextTime(r.trigger.getString("at"), days, ZonedDateTime.now()).toInstant().toEpochMilli()
            val pi = timePendingIntent(context, r.id)
            if (DevicePermissions.canScheduleExact(context)) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi)
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi)
        }
        prefs(context).edit().putStringSet(KEY_TIME_IDS, timed.map { it.id }.toSet()).apply()
    }

    /**
     * Diff-based: an alert added while the phone is already inside the
     * radius reports "entering", so re-adding unchanged places on every sync
     * would fire their routines again. Each place is kept as `id|lat|lng|radius`.
     */
    private fun syncPlaces(context: Context, routines: List<Routine>, afterBoot: Boolean) {
        val location = context.getSystemService(LocationManager::class.java)
        val ids = routines.filter { it.trigger.optString("kind") == "place" }.map { it.trigger.getString("placeId") }.toSet()
        val places = RoutineStore.get(context).listPlaces().filter { it.id in ids }
        val wanted = places.associateBy { "${it.id}|${it.latitude}|${it.longitude}|${it.radiusM}" }
        val previous = if (afterBoot) emptySet() else prefs(context).getStringSet(KEY_PLACES, emptySet()).orEmpty()
        for (key in previous - wanted.keys) location.removeProximityAlert(placePendingIntent(context, key.substringBefore('|')))
        if (wanted.isNotEmpty() && !DevicePermissions.has(context, Manifest.permission.ACCESS_FINE_LOCATION)) {
            AssistantLog.log("rotinas: sem localização, lugares não são vigiados")
            prefs(context).edit().putStringSet(KEY_PLACES, emptySet()).apply()
            return
        }
        val registered = previous.intersect(wanted.keys).toMutableSet()
        for ((key, p) in wanted) {
            if (key in registered) continue
            try {
                location.addProximityAlert(p.latitude, p.longitude, p.radiusM.toFloat(), -1, placePendingIntent(context, p.id))
                registered.add(key)
            } catch (e: SecurityException) {
                AssistantLog.log("rotinas: proximidade negada para ${p.name}")
            }
        }
        prefs(context).edit().putStringSet(KEY_PLACES, registered).apply()
    }

    private fun syncWifi(context: Context, wanted: Boolean) {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val wifi = networkPendingIntent(context, 1)
        val other = networkPendingIntent(context, 2)
        for (pi in listOf(wifi, other)) {
            try {
                cm.unregisterNetworkCallback(pi)
            } catch (_: Exception) {
                // Not registered yet.
            }
        }
        if (!wanted) return
        // The current network first: the callbacks deliver right away and must not see a change.
        prefs(context).edit().putString(KEY_WIFI_SSID, currentSsid(context)).commit()
        // Available Wi-Fi tells us we connected; available cellular usually means Wi-Fi was lost.
        cm.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), wifi)
        cm.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR).build(), other)
    }

    // Events

    fun onBluetooth(context: Context, address: String, name: String, connected: Boolean) {
        val event = if (connected) "connected" else "disconnected"
        AssistantLog.log("rotinas: Bluetooth $event: $name")
        fire(context, mapOf("device" to name), null) { t ->
            t.optString("kind") == "bluetooth" && t.optString("event") == event &&
                t.optJSONObject("device")?.optString("address").equals(address, ignoreCase = true)
        }
    }

    /** Compares the current Wi-Fi with the last one seen and fires disconnect and connect transitions. */
    fun onNetworkChanged(context: Context) {
        val prefs = prefs(context)
        val last = prefs.getString(KEY_WIFI_SSID, null)
        val now = currentSsid(context)
        if (last == now) return
        prefs.edit().putString(KEY_WIFI_SSID, now).apply()
        AssistantLog.log("rotinas: Wi-Fi ${last ?: "nenhum"} → ${now ?: "nenhum"}")
        if (last != null) fire(context, mapOf("ssid" to last), null) { t -> isWifi(t, "disconnected", last) }
        if (now != null) fire(context, mapOf("ssid" to now), null) { t -> isWifi(t, "connected", now) }
    }

    fun onPlace(context: Context, placeId: String, entering: Boolean) {
        val event = if (entering) "enter" else "exit"
        val name = RoutineStore.get(context).listPlaces().firstOrNull { it.id == placeId }?.name ?: placeId
        AssistantLog.log("rotinas: lugar $event: $name")
        fire(context, mapOf("place" to name), null) { t ->
            t.optString("kind") == "place" && t.optString("event") == event && t.optString("placeId") == placeId
        }
    }

    fun onTime(context: Context, routineId: String) {
        val routine = RoutineStore.get(context).getRoutine(routineId)
        if (routine != null && routine.enabled && !isPaused(context)) runRoutine(context, routine, mapOf("time" to routine.trigger.optString("at")), null)
        sync(context) // schedules the next occurrence
    }

    fun onNotification(context: Context, packageName: String, title: String, text: String, postedAt: Long, key: String) {
        val dedupe = "$key|$postedAt"
        synchronized(seenKeys) {
            if (!seenKeys.add(dedupe)) return
            if (seenKeys.size > MAX_SEEN_KEYS) seenKeys.remove(seenKeys.first())
        }
        val label = try {
            context.packageManager.getApplicationLabel(context.packageManager.getApplicationInfo(packageName, 0)).toString()
        } catch (e: Exception) {
            packageName
        }
        val haystack = "$title\n$text"
        val vars = mapOf("app" to label, "title" to title, "text" to text, "postedAt" to java.time.Instant.ofEpochMilli(postedAt).toString())
        fire(context, vars, dedupe, cooldown = false) { t ->
            t.optString("kind") == "notification" && t.optString("packageName") == packageName &&
                t.optString("textContains").let { it.isEmpty() || haystack.contains(it, ignoreCase = true) }
        }
    }

    private fun fire(
        context: Context,
        vars: Map<String, String>,
        dedupeKey: String?,
        cooldown: Boolean = true,
        matches: (org.json.JSONObject) -> Boolean,
    ) {
        for (r in active(context)) {
            if (!matches(r.trigger)) continue
            // From the stored last run: the receiver's process may have died since.
            if (cooldown && System.currentTimeMillis() - (r.lastRunAt ?: 0L) < COOLDOWN_MS) continue
            runRoutine(context, r, vars, dedupeKey)
        }
    }

    /** Runs every action in order and logs one run. `ask_agent` logs its own result when JS reports back. */
    fun runRoutine(context: Context, routine: Routine, vars: Map<String, String>, dedupeKey: String?) {
        val outcomes = (0 until routine.actions.length()).map { i ->
            ActionRunner.run(context, routine, routine.actions.getJSONObject(i), vars, dedupeKey)
        }
        val outcome = when {
            outcomes.any { it.outcome == "blocked" } -> "blocked"
            outcomes.any { it.outcome == "failed" } -> "failed"
            else -> "done"
        }
        RoutineStore.get(context).recordRun(routine.id, outcome, outcomes.joinToString(" · ") { it.detail })
        AssistantLog.log("rotinas: ${routine.name} → $outcome")
    }

    /** Wakes the JS runtime when the next queued `ask_agent` firing is due. */
    fun scheduleQueueWakeup(context: Context, at: Long = System.currentTimeMillis() + 60_000L) {
        val pi = PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, RoutineInternalReceiver::class.java).setAction(RoutineInternalReceiver.ACTION_QUEUE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        context.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    // Helpers

    private fun isWifi(t: org.json.JSONObject, event: String, ssid: String) =
        t.optString("kind") == "wifi" && t.optString("event") == event && t.optString("ssid") == ssid

    /** The connected Wi-Fi name, or null. Needs location permission; Android hides it otherwise. */
    @Suppress("DEPRECATION")
    fun currentSsid(context: Context): String? {
        val info = context.getSystemService(WifiManager::class.java)?.connectionInfo ?: return null
        val ssid = info.ssid?.removeSurrounding("\"") ?: return null
        return ssid.takeUnless { it.isBlank() || it == WifiManager.UNKNOWN_SSID.removeSurrounding("\"") || it == "<unknown ssid>" }
    }

    /** Next local time at [at] (`HH:mm`) on one of [days] (ISO; empty = every day), strictly after [now]. */
    fun nextTime(at: String, days: List<Int>, now: ZonedDateTime): ZonedDateTime {
        val (h, m) = at.split(":").map { it.toInt() }
        for (offset in 0..7) {
            val candidate = now.toLocalDate().plusDays(offset.toLong()).atTime(h, m).atZone(now.zone)
            if (candidate.isAfter(now) && (days.isEmpty() || candidate.dayOfWeek.value in days)) return candidate
        }
        return now.plusDays(1)
    }

    private fun timePendingIntent(context: Context, routineId: String): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, RoutineInternalReceiver::class.java)
                .setAction(RoutineInternalReceiver.ACTION_TIME)
                .setData(Uri.parse("edji://routine-time/$routineId")),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    // Mutable: the system adds the proximity and network extras.
    private fun placePendingIntent(context: Context, placeId: String): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, RoutineInternalReceiver::class.java)
                .setAction(RoutineInternalReceiver.ACTION_PLACE)
                .setData(Uri.parse("edji://place/$placeId")),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private fun networkPendingIntent(context: Context, code: Int): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            code,
            Intent(context, RoutineInternalReceiver::class.java).setAction(RoutineInternalReceiver.ACTION_NETWORK),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
}
