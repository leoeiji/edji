package dev.edji.assistant

import dev.edji.assistant.UpdateRules.ApkFacts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateRulesTest {

    private val key = setOf("16f9d969")
    private val pkg = "dev.edji.app"

    @Test
    fun `hashes like sha256sum`() {
        // printf 'edji' | shasum -a 256
        assertEquals("f1be76a5dba8a906c9d253a5f5d2b21d87a2bb86f1c96dbc2837b80ed1efb013", UpdateRules.sha256Hex("edji".toByteArray()))
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            UpdateRules.sha256Hex(ByteArray(0)),
        )
        assertEquals(UpdateRules.sha256Hex("edji".toByteArray()), UpdateRules.sha256Hex("edji".byteInputStream()))
    }

    @Test
    fun `accepts a download that matches the release digest, with or without the sha256 prefix`() {
        val sha = UpdateRules.sha256Hex("apk".toByteArray())
        assertNull(UpdateRules.downloadProblem("sha256:$sha", 3, sha, 3))
        assertNull(UpdateRules.downloadProblem(sha.uppercase(), 0, sha, 3))
    }

    @Test
    fun `rejects a truncated or corrupted download`() {
        val sha = UpdateRules.sha256Hex("apk".toByteArray())
        assertTrue(UpdateRules.downloadProblem(sha, 10, sha, 3)!!.contains("incompleto"))
        assertTrue(UpdateRules.downloadProblem("sha256:00ff", 3, sha, 3)!!.contains("corrompido"))
    }

    @Test
    fun `installs a newer Edji signed with the same key`() {
        assertNull(UpdateRules.installProblem(pkg, 200, key, ApkFacts(pkg, 300, key)))
    }

    @Test
    fun `refuses what is not a newer Edji with the same key`() {
        assertTrue(UpdateRules.installProblem(pkg, 200, key, null)!!.contains("não é um app válido"))
        assertTrue(UpdateRules.installProblem(pkg, 200, key, ApkFacts("com.other", 300, key))!!.contains("não é do Edji"))
        assertTrue(UpdateRules.installProblem(pkg, 200, key, ApkFacts(pkg, 200, key))!!.contains("não é mais nova"))
        assertTrue(UpdateRules.installProblem(pkg, 200, key, ApkFacts(pkg, 100, key))!!.contains("não é mais nova"))
        assertTrue(UpdateRules.installProblem(pkg, 200, key, ApkFacts(pkg, 300, setOf("debug")))!!.contains("assinatura"))
        assertTrue(UpdateRules.installProblem(pkg, 200, key, ApkFacts(pkg, 300, emptySet()))!!.contains("assinatura"))
        assertTrue(UpdateRules.installProblem(pkg, 200, emptySet(), ApkFacts(pkg, 300, emptySet()))!!.contains("assinatura"))
    }
}
