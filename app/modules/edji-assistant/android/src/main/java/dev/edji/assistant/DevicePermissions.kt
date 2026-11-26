package dev.edji.assistant

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/**
 * Status of the permissions in the JS catalog (`core/permissions.ts`) and
 * the Android screen where each special one is granted (ADR 0005).
 */
object DevicePermissions {

    fun status(context: Context, id: String): String =
        when (id) {
            "microphone" -> granted(has(context, Manifest.permission.RECORD_AUDIO))
            "assistant_role" -> granted(isAssistant(context))
            "notifications" -> granted(
                if (Build.VERSION.SDK_INT >= 33) has(context, Manifest.permission.POST_NOTIFICATIONS)
                else context.getSystemService(NotificationManager::class.java).areNotificationsEnabled(),
            )
            "nearby_devices" -> granted(Build.VERSION.SDK_INT < 31 || has(context, Manifest.permission.BLUETOOTH_CONNECT))
            "fine_location" -> granted(has(context, Manifest.permission.ACCESS_FINE_LOCATION))
            "background_location" -> granted(has(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION))
            "exact_alarms" -> granted(canScheduleExact(context))
            "notification_access" -> granted(hasNotificationAccess(context))
            "dnd_access" -> granted(context.getSystemService(NotificationManager::class.java).isNotificationPolicyAccessGranted)
            "background_launch" -> granted(canStartActivitiesInBackground(context))
            "battery_unrestricted" -> granted(
                context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName),
            )
            else -> "unavailable"
        }

    fun has(context: Context, permission: String): Boolean =
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    fun isAssistant(context: Context): Boolean =
        context.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_ASSISTANT) == true

    fun canScheduleExact(context: Context): Boolean =
        Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    fun hasNotificationAccess(context: Context): Boolean {
        val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners").orEmpty()
        val me = ComponentName(context, EdjiNotificationListener::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
    }

    /**
     * Hypothesis to validate on the device (ADR 0005): Android lets an app
     * start activities from the background when the system binds its
     * VoiceInteractionService (Edji as default assistant) or when it may draw
     * over other apps. Without either, routines post a notification to tap.
     */
    fun canStartActivitiesInBackground(context: Context): Boolean =
        isAssistant(context) || Settings.canDrawOverlays(context)

    /** Opens the screen where the user grants [id]. Falls back to the app's details screen. */
    fun openSettings(context: Context, id: String) {
        val pkg = Uri.parse("package:${context.packageName}")
        val intent = when (id) {
            "assistant_role" -> Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)
            "exact_alarms" -> if (Build.VERSION.SDK_INT >= 31) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg) else null
            "notification_access" -> if (Build.VERSION.SDK_INT >= 30) {
                Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(
                    Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                    ComponentName(context, EdjiNotificationListener::class.java).flattenToString(),
                )
            } else {
                Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            }
            "dnd_access" -> Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
            "background_launch" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg)
            "battery_unrestricted" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            else -> null
        } ?: Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)
        try {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    private fun granted(ok: Boolean) = if (ok) "granted" else "denied"
}
