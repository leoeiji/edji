package dev.edji.assistant

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.service.voice.VoiceInteractionSession
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The voice session shown when the side button is held.
 *
 * Path (ADR 0003): open the mic natively (no JS), boot the JS runtime in the
 * background while the user speaks, write the transcript to [CommandInbox],
 * then wait for the JS agent to run a plugin tool and report the reply. If JS
 * doesn't answer in [JS_TIMEOUT_MS], the command stays pending and the session
 * says so instead of confirming.
 */
class EdjiSession(context: Context) : VoiceInteractionSession(context), VoiceCapture.Listener {

    private val main = Handler(Looper.getMainLooper())
    private var capture: VoiceCapture? = null
    private var shownAt = 0L
    private var waitingId: Long? = null

    private var title: TextView? = null
    private var detail: TextView? = null
    private var orb: View? = null

    override fun onCreateContentView(): View {
        val ctx = context
        val density = ctx.resources.displayMetrics.density
        fun px(dp: Int) = (dp * density).toInt()

        val root = FrameLayout(ctx).apply { setOnClickListener { cancel("toque fora") } }

        val card = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(px(20), px(24), px(20), px(22))
            background = GradientDrawable().apply {
                setColor(0xFFF7F9F5.toInt())
                cornerRadius = 24 * density
            }
            isClickable = true // taps on the card don't cancel
        }

        val orbView = View(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(0xFF073E2B.toInt())
                setStroke(px(6), 0xFFD8F9DF.toInt())
            }
        }
        val titleView = TextView(ctx).apply {
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFF152019.toInt())
            gravity = Gravity.CENTER
        }
        val detailView = TextView(ctx).apply {
            textSize = 14f
            setTextColor(0xFF6F7B72.toInt())
            gravity = Gravity.CENTER
        }

        card.addView(orbView, LinearLayout.LayoutParams(px(64), px(64)).apply { bottomMargin = px(14) })
        card.addView(titleView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        card.addView(detailView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(4) })

        root.addView(
            card,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM)
                .apply { setMargins(px(12), 0, px(12), px(48)) },
        )

        title = titleView
        detail = detailView
        orb = orbView
        return root
    }

    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        shownAt = SystemClock.elapsedRealtime()
        main.removeCallbacksAndMessages(null)
        stopWaiting()
        AssistantLog.log("sessão aberta: showFlags=0x${Integer.toHexString(showFlags)} invocation_type=${args?.getInt("invocation_type", -1)}")

        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            AssistantLog.log("sem permissão de microfone na sessão")
            setUi("Permita o microfone", "Abra o Edji e toque em Permitir.")
            main.postDelayed({ hide() }, 3000)
            return
        }

        setUi("Ouvindo...", "Diga o que precisa.")
        Haptics.listening(context)
        capture?.destroy()
        capture = VoiceCapture(context, this).also { it.start() }
        // Boot JS while the user speaks; the mic is already opening.
        EdjiCommandTaskService.start(context, "warmup")
    }

    override fun onHide() {
        capture?.destroy()
        capture = null
        stopWaiting()
        main.removeCallbacksAndMessages(null)
        super.onHide()
    }

    override fun onDestroy() {
        capture?.destroy()
        capture = null
        stopWaiting()
        super.onDestroy()
    }

    // --- VoiceCapture.Listener ---

    override fun onReady() {
        AssistantLog.log("latência gesto → microfone: ${SystemClock.elapsedRealtime() - shownAt} ms")
    }

    override fun onRms(rmsDb: Float) {
        val scale = 1f + (rmsDb.coerceIn(0f, 10f) / 40f)
        orb?.scaleX = scale
        orb?.scaleY = scale
    }

    override fun onPartial(text: String) {
        setUi("Ouvindo...", "“$text”")
    }

    override fun onFinal(text: String) {
        val spoken = text.trim()
        if (spoken.isEmpty()) {
            setUi("Não entendi.", "Pode repetir? Segure o botão de novo.")
            main.postDelayed({ hide() }, 1800)
            return
        }
        orb?.scaleX = 1f
        orb?.scaleY = 1f
        setUi("Entendi.", "“$spoken”")

        val inbox = CommandInbox.get(context)
        val id = try {
            inbox.add(spoken)
        } catch (e: Exception) {
            AssistantLog.log("inbox: falha ao gravar: ${e.message}")
            setUi("Algo falhou.", "Não consegui guardar o comando.")
            main.postDelayed({ hide() }, 2200)
            return
        }
        AssistantLog.log("inbox: comando $id gravado")
        waitingId = id
        inbox.await(id) { status, reply -> main.post { onCommandDone(id, status, reply) } }
        EdjiCommandTaskService.start(context, "command", id)
        main.postDelayed({ onJsTimeout(id) }, JS_TIMEOUT_MS)
    }

    override fun onError(code: Int, name: String) {
        val message = when (code) {
            6, 7 -> "Não ouvi nada. Segure o botão e fale de novo."
            9 -> "Sem permissão de microfone."
            12, 13 -> "Reconhecimento em português indisponível neste aparelho."
            else -> "Algo falhou ($name)."
        }
        setUi("Não entendi.", message)
        main.postDelayed({ hide() }, 2200)
    }

    // --- Agent result ---

    private fun onCommandDone(id: Long, status: String, reply: String) {
        if (waitingId != id) return
        waitingId = null
        main.removeCallbacksAndMessages(null)
        AssistantLog.log("gesto → resposta: ${SystemClock.elapsedRealtime() - shownAt} ms")
        if (status == "done") {
            Haptics.saved(context)
            setUi(reply, detail?.text?.toString().orEmpty())
        } else {
            setUi("Não consegui.", reply)
        }
        main.postDelayed({ hide() }, 1500)
    }

    private fun onJsTimeout(id: Long) {
        if (waitingId != id) return
        stopWaiting()
        AssistantLog.log("js: sem resposta em $JS_TIMEOUT_MS ms; comando $id fica pendente")
        setUi("Guardei.", "Termino quando você abrir o Edji.")
        main.postDelayed({ hide() }, 2200)
    }

    private fun stopWaiting() {
        waitingId?.let { CommandInbox.get(context).stopWaiting(it) }
        waitingId = null
    }

    private fun cancel(reason: String) {
        AssistantLog.log("sessão cancelada: $reason")
        capture?.destroy()
        capture = null
        hide()
    }

    private fun setUi(titleText: String, detailText: String) {
        title?.text = titleText
        detail?.text = detailText
    }

    companion object {
        /** How long the session waits for the JS agent after the transcript is stored. */
        const val JS_TIMEOUT_MS = 4_000L
    }
}
