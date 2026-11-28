package dev.edji.assistant

import java.io.InputStream
import java.security.MessageDigest

/**
 * Decisions of the in-app update (ADR 0007), in plain Kotlin so they run on
 * the JVM: hashing the download and checking a downloaded APK against the
 * installed app before handing it to the system installer.
 */
object UpdateRules {

    /** What the installer needs to know about an APK: package, version and SHA-256 of its signing certificates. */
    data class ApkFacts(val packageName: String, val versionCode: Long, val signers: Set<String>)

    /** Lowercase hex SHA-256 of [bytes], as GitHub's asset `digest` and `apksigner` print it. */
    fun sha256Hex(bytes: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))

    /** Lowercase hex SHA-256 of everything [input] yields. Doesn't close it. */
    fun sha256Hex(input: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(BUFFER_BYTES)
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            digest.update(buffer, 0, n)
        }
        return hex(digest.digest())
    }

    /**
     * Why the download can't be used, in short Portuguese, or null when it
     * matches what the release promised. [expectedSha256] may carry GitHub's
     * `sha256:` prefix.
     */
    fun downloadProblem(expectedSha256: String, expectedSize: Long, actualSha256: String, actualSize: Long): String? =
        when {
            expectedSize > 0 && actualSize != expectedSize -> "O download veio incompleto. Tente de novo."
            !actualSha256.equals(expectedSha256.removePrefix("sha256:"), ignoreCase = true) -> "O download veio corrompido. Tente de novo."
            else -> null
        }

    /**
     * Why [apk] can't update the installed app, in short Portuguese, or null
     * when it can. Android would refuse a different key anyway; checking first
     * gives a clear message instead of the installer's generic failure.
     */
    fun installProblem(installedPackage: String, installedVersionCode: Long, installedSigners: Set<String>, apk: ApkFacts?): String? =
        when {
            apk == null -> "O arquivo baixado não é um app válido."
            apk.packageName != installedPackage -> "Esse arquivo não é do Edji."
            apk.versionCode <= installedVersionCode -> "Essa versão não é mais nova que a instalada."
            apk.signers.isEmpty() || installedSigners.isEmpty() || apk.signers != installedSigners ->
                "A assinatura não bate com a do Edji instalado. Se ele veio de um build local, desinstale e instale pelo GitHub."
            else -> null
        }

    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    private const val BUFFER_BYTES = 64 * 1024
}
