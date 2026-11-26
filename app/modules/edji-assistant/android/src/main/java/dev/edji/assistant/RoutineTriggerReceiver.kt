package dev.edji.assistant

import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * System broadcasts that drive routines (ADR 0005): Bluetooth links (ACL,
 * delivered to manifest receivers even with the app closed) and boot or
 * update, after which Android forgets alarms and proximity alerts.
 * Every action here is a protected broadcast, so other apps can't fake it.
 */
class RoutineTriggerReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        val pending = goAsync()
        RoutineEngine.post {
            try {
                when (intent.action) {
                    BluetoothDevice.ACTION_ACL_CONNECTED, BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                        val device = deviceOf(intent) ?: return@post
                        val name = try {
                            device.name
                        } catch (e: SecurityException) {
                            null
                        } ?: device.address
                        RoutineEngine.onBluetooth(app, device.address, name, intent.action == BluetoothDevice.ACTION_ACL_CONNECTED)
                    }
                    Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
                    Intent.ACTION_TIMEZONE_CHANGED, Intent.ACTION_TIME_CHANGED -> RoutineEngine.sync(app)
                }
            } finally {
                pending.finish()
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun deviceOf(intent: Intent): BluetoothDevice? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        else intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
}
