package dev.edji.assistant

import android.content.Intent
import android.speech.RecognitionService
import android.speech.SpeechRecognizer

/**
 * Stub. Android only lists a voice interaction service as an assistant when it
 * names a recognition service, so Edji declares this one. It does no
 * recognition: [VoiceCapture] always picks a real recognizer explicitly.
 */
class EdjiRecognitionService : RecognitionService() {
    override fun onStartListening(recognizerIntent: Intent?, listener: RecognitionService.Callback?) {
        AssistantLog.log("stub de reconhecimento chamado; respondendo ERROR_CLIENT")
        listener?.error(SpeechRecognizer.ERROR_CLIENT)
    }

    override fun onCancel(listener: RecognitionService.Callback?) {}

    override fun onStopListening(listener: RecognitionService.Callback?) {}
}
