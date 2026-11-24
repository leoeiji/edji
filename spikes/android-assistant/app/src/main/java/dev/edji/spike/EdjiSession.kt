package dev.edji.spike

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
 * The voice session shown when the side button is held: Ouvindo... →
 * transcription → Anotado., then it hides itself. Built with plain Views
 * (no Compose) to keep the session window light.
 */
class EdjiSession(context: Context) : VoiceInteractionSession(context), VoiceCapture.Listener {

    private val main = Handler(Looper.getMainLooper())
    private var capture: VoiceCapture? = null
    private var shownAt = 0L

    private var title: TextView? = null
    private var detail: TextView? = null
    private var orb: View? = null

    override fun onCreate() {
        super.onCreate()
        TaskStore.init(context)
    }

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
                setColor(0xFFFBFFFC.toInt())
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
            setTextColor(0xFF123624.toInt())
            gravity = Gravity.CENTER
        }
        val detailView = TextView(ctx).apply {
            textSize = 14f
            setTextColor(0xFF5B6A60.toInt())
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
        // Raw data on purpose: we want to see how the Samsung long press arrives.
        SpikeLog.log("sessão aberta: showFlags=0x${Integer.toHexString(showFlags)} args=${describe(args)}")

        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            SpikeLog.log("sem permissão de microfone na sessão")
            setUi("Permita o microfone", "Abra o app Edji e toque em Permitir.")
            main.postDelayed({ hide() }, 3000)
            return
        }

        setUi("Ouvindo...", "Diga a tarefa.")
        Haptics.listening(context)
        capture?.destroy()
        capture = VoiceCapture(context, this).also { it.start() }
    }

    override fun onHide() {
        capture?.destroy()
        capture = null
        main.removeCallbacksAndMessages(null)
        super.onHide()
    }

    override fun onDestroy() {
        capture?.destroy()
        capture = null
        super.onDestroy()
    }

    // --- VoiceCapture.Listener ---

    override fun onReady() {
        SpikeLog.log("latência gesto → microfone: ${SystemClock.elapsedRealtime() - shownAt} ms")
    }

    override fun onRms(rmsDb: Float) {
        // Rough level meter: rmsDb is about -2..10.
        val scale = 1f + (rmsDb.coerceIn(0f, 10f) / 40f)
        orb?.scaleX = scale
        orb?.scaleY = scale
    }

    override fun onPartial(text: String) {
        setUi("Ouvindo...", "“$text”")
    }

    override fun onFinal(text: String) {
        val task = TaskText.clean(text)
        if (task.isEmpty()) {
            setUi("Não entendi.", "Pode repetir? Segure o botão de novo.")
            main.postDelayed({ hide() }, 1800)
            return
        }
        TaskStore.add(task, "voz")
        Haptics.saved(context)
        setUi("Anotado.", task)
        SpikeLog.log("gesto → tarefa salva: ${SystemClock.elapsedRealtime() - shownAt} ms")
        main.postDelayed({ hide() }, 1500)
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

    private fun cancel(reason: String) {
        SpikeLog.log("sessão cancelada: $reason")
        capture?.destroy()
        capture = null
        hide()
    }

    private fun setUi(titleText: String, detailText: String) {
        title?.text = titleText
        detail?.text = detailText
    }

    private fun describe(args: Bundle?): String {
        if (args == null) return "null"
        if (args.isEmpty) return "{}"
        @Suppress("DEPRECATION")
        return args.keySet().joinToString(prefix = "{", postfix = "}") { key -> "$key=${args.get(key)}" }
    }
}
