package dev.edji.assistant

import android.os.Bundle
import android.service.voice.VoiceInteractionService

/**
 * Kept running by the system while Edji is the default digital assistant.
 * The side-button long press reaches [EdjiSessionService] through it.
 */
class EdjiVoiceInteractionService : VoiceInteractionService() {
    override fun onReady() {
        super.onReady()
        AssistantLog.log("serviço de assistente pronto (Edji é o assistente padrão)")
    }

    override fun onLaunchVoiceAssistFromKeyguard() {
        AssistantLog.log("assistente pedido pela tela de bloqueio")
        showSession(Bundle(), 0)
    }
}
