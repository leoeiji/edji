package dev.edji.assistant

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

/**
 * Outcome of an install session started by [AppUpdater] (ADR 0007). Not
 * exported: only the system installer, through our PendingIntent, reaches it.
 * When the system wants the user to confirm, it opens that screen.
 */
class AppUpdateReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val detail = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        AssistantLog.log("atualização: status $status${detail?.let { " ($it)" } ?: ""}")
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = confirmIntent(intent)
                if (confirm == null) {
                    AppUpdater.emit(AppUpdater.Event("failed", message = "O Android não abriu a confirmação. Tente de novo."))
                    return
                }
                context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                AppUpdater.emit(AppUpdater.Event("waiting_user"))
            }
            PackageInstaller.STATUS_SUCCESS -> AppUpdater.emit(AppUpdater.Event("installed"))
            PackageInstaller.STATUS_FAILURE_ABORTED -> AppUpdater.emit(AppUpdater.Event("cancelled"))
            else -> AppUpdater.emit(AppUpdater.Event("failed", message = failureMessage(status)))
        }
    }

    @Suppress("DEPRECATION")
    private fun confirmIntent(intent: Intent): Intent? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_INTENT)

    private fun failureMessage(status: Int): String =
        when (status) {
            PackageInstaller.STATUS_FAILURE_STORAGE -> "Falta espaço para instalar a atualização."
            PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
                "O Android recusou a atualização. Se o Edji veio de um build local, desinstale e instale pelo GitHub."
            PackageInstaller.STATUS_FAILURE_BLOCKED -> "O Android bloqueou a instalação."
            else -> "Não deu para instalar a atualização."
        }
}
