package dev.edji.assistant

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors

/**
 * In-app update from GitHub Releases (ADR 0007). JS finds the release and
 * asks; this downloads the APK into the cache, checks its digest, package,
 * version and signing key, and hands it to the system installer, which asks
 * the user to confirm. Nothing here runs unless the user asked for it.
 *
 * Downloads and installs run on their own thread, never on the module's
 * queue, so a slow download doesn't hold up the voice path.
 */
object AppUpdater {

    /** Progress and outcome for JS: `downloading`, `waiting_user`, `installed`, `cancelled` or `failed`. */
    data class Event(val state: String, val downloaded: Long = 0, val total: Long = 0, val message: String? = null)

    private val listeners = CopyOnWriteArraySet<(Event) -> Unit>()
    private val worker = Executors.newSingleThreadExecutor()

    fun addListener(listener: (Event) -> Unit) = listeners.add(listener)

    fun removeListener(listener: (Event) -> Unit) = listeners.remove(listener)

    internal fun emit(event: Event) = listeners.forEach { it(event) }

    /** The installed app's version name and code. */
    fun installedVersion(context: Context): Map<String, Any> {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return mapOf("versionName" to (info.versionName ?: ""), "versionCode" to versionCode(info).toDouble())
    }

    /** Whether the user let Edji install apps ("Instalar apps desconhecidos"). */
    fun canInstall(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

    /** Deletes leftover downloads, e.g. the APK of the update that just installed. */
    fun cleanUp(context: Context) = worker.execute { dir(context).deleteRecursively() }

    /**
     * Downloads [url] (following GitHub's redirect), checks it against
     * [sha256] and [size] and against the installed app, then starts the
     * system install. Calls [done] with null once the installer has it, or with
     * a short Portuguese reason. The outcome comes later as an [Event].
     */
    fun update(context: Context, url: String, sha256: String, size: Long, done: (String?) -> Unit) = worker.execute {
        val app = context.applicationContext
        val problem = try {
            val apk = download(app, url, sha256, size)
            val refused = check(app, apk)
            if (refused == null) install(app, apk)
            refused
        } catch (e: DownloadProblem) {
            e.message
        } catch (e: Exception) {
            AssistantLog.log("atualização: falhou (${e.javaClass.simpleName}: ${e.message})")
            "Não deu para baixar a atualização. Confira a internet e tente de novo."
        }
        if (problem != null) AssistantLog.log("atualização: $problem")
        done(problem)
    }

    private fun download(context: Context, url: String, sha256: String, size: Long): File {
        val dir = dir(context).apply { deleteRecursively(); mkdirs() }
        val file = File(dir, "edji-update.apk")
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
            instanceFollowRedirects = true
        }
        try {
            if (conn.responseCode != HttpURLConnection.HTTP_OK) throw IllegalStateException("HTTP ${conn.responseCode}")
            val total = if (size > 0) size else conn.contentLengthLong
            val digest = MessageDigest.getInstance("SHA-256")
            var downloaded = 0L
            var lastPercent = -1L
            conn.inputStream.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(BUFFER_BYTES)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        digest.update(buffer, 0, n)
                        downloaded += n
                        val percent = if (total > 0) downloaded * 100 / total else -1
                        if (percent != lastPercent) {
                            lastPercent = percent
                            emit(Event("downloading", downloaded, total))
                        }
                    }
                }
            }
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            UpdateRules.downloadProblem(sha256, size, actual, downloaded)?.let { throw DownloadProblem(it) }
            AssistantLog.log("atualização: baixada ($downloaded bytes, sha256 confere)")
            return file
        } finally {
            conn.disconnect()
        }
    }

    /** Why [apk] can't update this app, or null. */
    private fun check(context: Context, apk: File): String? {
        val pm = context.packageManager
        val installed = pm.getPackageInfo(context.packageName, signingFlags())
        val archive = archiveInfo(pm, apk)
        val facts = archive?.let { UpdateRules.ApkFacts(it.packageName, versionCode(it), signers(it)) }
        return UpdateRules.installProblem(context.packageName, versionCode(installed), signers(installed), facts)
    }

    private fun install(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite("edji.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out, BUFFER_BYTES) }
                session.fsync(out)
            }
            val intent = Intent(context, AppUpdateReceiver::class.java).setPackage(context.packageName)
            // Mutable: the installer adds the status and the confirmation intent.
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            session.commit(PendingIntent.getBroadcast(context, sessionId, intent, flags).intentSender)
        }
        AssistantLog.log("atualização: entregue ao instalador (sessão $sessionId)")
    }

    @Suppress("DEPRECATION")
    private fun archiveInfo(pm: PackageManager, apk: File): PackageInfo? =
        if (Build.VERSION.SDK_INT >= 33) {
            pm.getPackageArchiveInfo(apk.path, PackageManager.PackageInfoFlags.of(signingFlags().toLong()))
        } else {
            pm.getPackageArchiveInfo(apk.path, signingFlags())
        }

    @Suppress("DEPRECATION")
    private fun signingFlags(): Int =
        if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

    /** SHA-256 of the certificates [info] is signed with now (no rotation history). */
    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<String> {
        val certs = if (Build.VERSION.SDK_INT >= 28) {
            val signing = info.signingInfo ?: return emptySet()
            if (signing.hasMultipleSigners()) signing.apkContentsSigners else signing.signingCertificateHistory.takeLast(1).toTypedArray()
        } else {
            info.signatures
        }
        return certs.orEmpty().map { UpdateRules.sha256Hex(it.toByteArray()) }.toSet()
    }

    @Suppress("DEPRECATION")
    private fun versionCode(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    private fun dir(context: Context) = File(context.cacheDir, "updates")

    private class DownloadProblem(message: String) : Exception(message)

    private const val TIMEOUT_MS = 30_000
    private const val BUFFER_BYTES = 64 * 1024
}
