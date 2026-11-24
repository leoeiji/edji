package dev.edji.spike

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * One speech-to-text capture in pt-BR, preferring on-device recognition.
 *
 * Edji ships a stub RecognitionService (needed to be listed as an assistant),
 * and becoming the default assistant can make that stub the system default
 * recognizer. So this never relies on the default: it uses the on-device
 * recognizer when available, otherwise another app's service chosen
 * explicitly, and logs which one ran.
 *
 * Must be created and used on the main thread. Call [destroy] when done.
 */
class VoiceCapture(private val context: Context, private val listener: Listener) {

    /** Callbacks, all on the main thread. */
    interface Listener {
        fun onReady() {}
        fun onRms(rmsDb: Float) {}
        fun onPartial(text: String) {}
        /** The settled transcription (may be empty). */
        fun onFinal(text: String)
        fun onError(code: Int, name: String)
    }

    private var recognizer: SpeechRecognizer? = null
    private var startedAt = 0L
    private var endOfSpeechAt = 0L
    private var triedFallback = false

    /** Which recognizer is in use: "on-device", a component name, or "padrão do sistema". */
    var engine: String = ""
        private set

    /** Starts listening. */
    fun start() {
        startedAt = SystemClock.elapsedRealtime()
        triedFallback = false
        begin(preferOnDevice = true)
    }

    /** Stops listening and waits for the final result. */
    fun stop() {
        recognizer?.stopListening()
    }

    /** Releases the recognizer. No callbacks arrive afterwards. */
    fun destroy() {
        recognizer?.destroy()
        recognizer = null
    }

    private fun begin(preferOnDevice: Boolean) {
        destroy()
        val r = create(preferOnDevice)
        recognizer = r
        r.setRecognitionListener(callbacks)
        SpikeLog.log("stt: usando $engine")
        r.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
            },
        )
    }

    private fun create(preferOnDevice: Boolean): SpeechRecognizer {
        if (preferOnDevice && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
            engine = "on-device"
            return SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        }
        val external = findExternalService()
        if (external != null) {
            engine = external.flattenToShortString()
            return SpeechRecognizer.createSpeechRecognizer(context, external)
        }
        engine = "padrão do sistema"
        return SpeechRecognizer.createSpeechRecognizer(context)
    }

    /** Another app's recognition service, preferring Google's. Never Edji's stub. */
    private fun findExternalService(): ComponentName? {
        @Suppress("DEPRECATION")
        val services = context.packageManager
            .queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0)
            .map { it.serviceInfo }
            .filter { it.packageName != context.packageName }
        val chosen = services.firstOrNull { it.packageName.startsWith("com.google.") } ?: services.firstOrNull()
        SpikeLog.log("stt: serviços encontrados = ${services.joinToString { it.packageName }}")
        return chosen?.let { ComponentName(it.packageName, it.name) }
    }

    private fun since(t: Long) = SystemClock.elapsedRealtime() - t

    private val callbacks = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            SpikeLog.log("stt: microfone pronto em ${since(startedAt)} ms")
            listener.onReady()
        }

        override fun onBeginningOfSpeech() {}

        override fun onRmsChanged(rmsdB: Float) = listener.onRms(rmsdB)

        override fun onBufferReceived(buffer: ByteArray?) {}

        override fun onEndOfSpeech() {
            endOfSpeechAt = SystemClock.elapsedRealtime()
        }

        override fun onError(error: Int) {
            val name = errorName(error)
            SpikeLog.log("stt: erro $error $name ($engine)")
            // On-device model missing for pt-BR, or support check failed: retry once elsewhere.
            if (engine == "on-device" && !triedFallback && error in setOf(5, 12, 13, 14, 15)) {
                triedFallback = true
                SpikeLog.log("stt: tentando outro serviço")
                begin(preferOnDevice = false)
                return
            }
            listener.onError(error, name)
        }

        override fun onResults(results: Bundle?) {
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            val afterSpeech = if (endOfSpeechAt > 0) "${since(endOfSpeechAt)} ms após o fim da fala" else "sem fim de fala"
            SpikeLog.log("stt: resultado \"$text\" ($afterSpeech, ${since(startedAt)} ms no total)")
            listener.onFinal(text)
        }

        override fun onPartialResults(partialResults: Bundle?) {
            val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            if (!text.isNullOrBlank()) listener.onPartial(text)
        }

        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    companion object {
        /** SpeechRecognizer error codes as names (ints, so no API-level symbols are needed). */
        fun errorName(code: Int): String = when (code) {
            1 -> "NETWORK_TIMEOUT"
            2 -> "NETWORK"
            3 -> "AUDIO"
            4 -> "SERVER"
            5 -> "CLIENT"
            6 -> "SPEECH_TIMEOUT"
            7 -> "NO_MATCH"
            8 -> "RECOGNIZER_BUSY"
            9 -> "INSUFFICIENT_PERMISSIONS"
            10 -> "TOO_MANY_REQUESTS"
            11 -> "SERVER_DISCONNECTED"
            12 -> "LANGUAGE_NOT_SUPPORTED"
            13 -> "LANGUAGE_UNAVAILABLE"
            14 -> "CANNOT_CHECK_SUPPORT"
            15 -> "CANNOT_LISTEN_TO_DOWNLOAD_EVENTS"
            else -> "UNKNOWN"
        }
    }
}
