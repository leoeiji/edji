package dev.edji.assistant

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import java.util.concurrent.Executors

/** What the agent can point a routine at: paired devices, installed apps and the current location. */
object DeviceInfo {

    /** Paired Bluetooth devices (name and address). Empty without the nearby devices permission. */
    @SuppressLint("MissingPermission")
    fun bondedDevices(context: Context): List<Map<String, String>> {
        if (Build.VERSION.SDK_INT >= 31 && !DevicePermissions.has(context, Manifest.permission.BLUETOOTH_CONNECT)) return emptyList()
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return emptyList()
        return adapter.bondedDevices.orEmpty()
            .map { mapOf("name" to (it.name ?: it.address), "address" to it.address) }
            .sortedBy { it["name"] }
    }

    /** Apps with a launcher icon, by label. */
    fun launchableApps(context: Context): List<Map<String, String>> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return pm.queryIntentActivities(intent, 0)
            .map { mapOf("packageName" to it.activityInfo.packageName, "label" to it.loadLabel(pm).toString()) }
            .filter { it["packageName"] != context.packageName }
            .distinctBy { it["packageName"] }
            .sortedBy { it["label"]?.lowercase() }
    }

    /**
     * A fresh location fix, falling back to the last known one. Calls [done]
     * with null when there is no permission or no fix.
     */
    @SuppressLint("MissingPermission")
    fun currentLocation(context: Context, done: (Location?) -> Unit) {
        if (!DevicePermissions.has(context, Manifest.permission.ACCESS_FINE_LOCATION)) return done(null)
        val lm = context.getSystemService(LocationManager::class.java)
        val last = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.time }
        if (Build.VERSION.SDK_INT < 30) return done(last)
        val provider = if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) LocationManager.GPS_PROVIDER else LocationManager.NETWORK_PROVIDER
        val signal = CancellationSignal()
        lm.getCurrentLocation(provider, signal, Executors.newSingleThreadExecutor()) { fix -> done(fix ?: last) }
    }
}
