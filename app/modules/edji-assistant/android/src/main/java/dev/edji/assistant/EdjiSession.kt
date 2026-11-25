package dev.edji.assistant

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
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
import android.widget.ScrollView
import android.widget.TextView
import java.util.UUID

/**
 * The voice session shown when the side button is held: a short chat.
 *
 * Each turn: open the mic natively (no JS), show the transcript as it comes,
 * write it to [CommandInbox] and wait while the JS agent streams the model's
 * reply into the bubble above the orb. Tapping the orb starts the next turn;
 * the mic never reopens on its own. Closing the session cancels whatever is
 * pending and forgets the conversation.
 */
class EdjiSession(context: Context) : VoiceInteractionSession(context), VoiceCapture.Listener {

    private enum class State { LISTENING, THINKING, IDLE }

    private val main = Handler(Looper.getMainLooper())
    private var capture: VoiceCapture? = null
    private var shownAt = 0L
    private var sessionId: String? = null
    private var state = State.IDLE
    private var waitingId: Long? = null

    private var scroll: ScrollView? = null
    private var messages: LinearLayout? = null
    private var halo: View? = null
    private var bars: List<View> = emptyList()
    private var status: TextView? = null
    private var userBubble: TextView? = null
    private var replyBubble: TextView? = null

    private val density get() = context.resources.displayMetrics.density
    private fun px(dp: Int) = (dp * density).toInt()

    // --- Layout ---

    override fun onCreateContentView(): View {
        val ctx = context
        val root = FrameLayout(ctx).apply {
            setPadding(0, px(96), 0, 0)
            setOnClickListener { cancel("toque fora") }
        }

        val sheet = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(20), px(20), px(20), px(40))
            background = GradientDrawable().apply {
                setColor(PAPER)
                val r = 28 * density
                cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
            }
            isClickable = true // taps on the sheet don't close the session
        }

        val list = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val scrollView = MaxHeightScrollView(ctx).apply {
            maxHeight = ctx.resources.displayMetrics.heightPixels - px(96 + 220)
            isVerticalFadingEdgeEnabled = true
            setFadingEdgeLength(px(48))
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(list)
        }
        sheet.addView(scrollView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        // The orb: five mint bars on pine, with a soft halo while listening.
        val orbSize = px(96)
        val orb = FrameLayout(ctx).apply {
            contentDescription = "Falar de novo"
            setOnClickListener { if (state == State.IDLE) startListening() }
        }
        val haloView = View(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(HALO)
            }
        }
        orb.addView(haloView, FrameLayout.LayoutParams(orbSize, orbSize))
        val core = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(PINE)
            }
        }
        val barViews = BAR_HEIGHTS_DP.map { h ->
            View(ctx).apply {
                background = GradientDrawable().apply {
                    setColor(MINT)
                    cornerRadius = 3 * density
                }
            }.also { core.addView(it, LinearLayout.LayoutParams(px(5), px(h)).apply { setMargins(px(2), 0, px(2), 0) }) }
        }
        orb.addView(core, FrameLayout.LayoutParams(px(72), px(72), Gravity.CENTER))
        sheet.addView(
            orb,
            LinearLayout.LayoutParams(orbSize, orbSize).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = px(28)
            },
        )

        val statusView = TextView(ctx).apply {
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(INK)
            gravity = Gravity.CENTER
        }
        sheet.addView(
            statusView,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(12) },
        )

        root.addView(sheet, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))

        scroll = scrollView
        messages = list
        halo = haloView
        bars = barViews
        status = statusView
        return root
    }

    // --- Lifecycle ---

    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        shownAt = SystemClock.elapsedRealtime()
        AssistantLog.log("sessão aberta: showFlags=0x${Integer.toHexString(showFlags)} invocation_type=${args?.getInt("invocation_type", -1)}")
        resetConversation()
        val leftovers = CommandInbox.get(context).cancelAllPending()
        if (leftovers > 0) AssistantLog.log("inbox: $leftovers comando(s) antigo(s) cancelado(s)")
        sessionId = UUID.randomUUID().toString()
        startListening()
        // Boot JS while the user speaks; the mic is already opening.
        EdjiCommandTaskService.start(context, "warmup")
    }

    override fun onHide() {
        endSession()
        super.onHide()
    }

    override fun onDestroy() {
        endSession()
        super.onDestroy()
    }

    /** Stops the mic, cancels a pending reply and forgets the conversation. */
    private fun endSession() {
        capture?.destroy()
        capture = null
        waitingId?.let { CommandInbox.get(context).cancel(it) }
        waitingId = null
        sessionId = null
        main.removeCallbacksAndMessages(null)
        resetConversation()
    }

    private fun resetConversation() {
        messages?.removeAllViews()
        userBubble = null
        replyBubble = null
        state = State.IDLE
    }

    // --- Turn: listening ---

    private fun startListening() {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            AssistantLog.log("sem permissão de microfone na sessão")
            setIdle("Permita o microfone no app do Edji.")
            return
        }
        setState(State.LISTENING, "Ouvindo...")
        userBubble = null
        Haptics.listening(context)
        capture?.destroy()
        capture = VoiceCapture(context, this).also { it.start() }
    }

    override fun onReady() {
        AssistantLog.log("latência gesto → microfone: ${SystemClock.elapsedRealtime() - shownAt} ms")
    }

    override fun onRms(rmsDb: Float) {
        if (state != State.LISTENING) return
        val level = rmsDb.coerceIn(0f, 10f) / 10f
        bars.forEachIndexed { i, bar -> bar.scaleY = 0.6f + level * BAR_GAIN[i] }
    }

    override fun onPartial(text: String) {
        if (state != State.LISTENING || text.isBlank()) return
        val bubble = userBubble ?: addBubble(user = true).also { userBubble = it }
        bubble.text = text
        scrollToEnd()
    }

    override fun onFinal(text: String) {
        capture?.destroy()
        capture = null
        val spoken = text.trim()
        if (spoken.isEmpty()) {
            userBubble?.let { messages?.removeView(it) }
            userBubble = null
            setIdle("Não ouvi direito. Toque para falar de novo.")
            return
        }
        (userBubble ?: addBubble(user = true)).text = spoken
        userBubble = null
        send(spoken)
    }

    override fun onError(code: Int, name: String) {
        capture?.destroy()
        capture = null
        userBubble?.let { messages?.removeView(it) }
        userBubble = null
        val message = when (code) {
            6, 7 -> "Não ouvi nada. Toque para falar de novo."
            9 -> "Sem permissão de microfone."
            12, 13 -> "Reconhecimento em português indisponível neste aparelho."
            else -> "Algo falhou no microfone ($name). Toque para tentar de novo."
        }
        setIdle(message)
    }

    // --- Turn: waiting for the agent ---

    private fun send(spoken: String) {
        val session = sessionId ?: return
        setState(State.THINKING, "Pensando...")
        val bubble = addBubble(user = false).also { replyBubble = it }
        startDots(bubble)

        val inbox = CommandInbox.get(context)
        val id = try {
            inbox.add(spoken, session)
        } catch (e: Exception) {
            AssistantLog.log("inbox: falha ao gravar: ${e.message}")
            showError("Não consegui guardar o que você disse.", setup = false)
            return
        }
        AssistantLog.log("inbox: comando $id gravado")
        waitingId = id
        inbox.await(
            id,
            CommandInbox.Waiter(
                onProgress = { text -> main.post { onReplyText(id, text) } },
                onHeartbeat = { main.post { if (waitingId == id) armTimeout(id, STALL_TIMEOUT_MS) } },
                onDone = { st, reply -> main.post { onReplyDone(id, st, reply) } },
            ),
        )
        if (!EdjiCommandTaskService.start(context, "command", id)) {
            inbox.cancel(id)
            waitingId = null
            showError("Não consegui iniciar o Edji. Tente de novo.", setup = false)
            return
        }
        armTimeout(id, FIRST_TEXT_TIMEOUT_MS)
    }

    private fun onReplyText(id: Long, text: String) {
        if (waitingId != id) return
        if (state == State.THINKING) {
            AssistantLog.log("gesto → primeiro texto: ${SystemClock.elapsedRealtime() - shownAt} ms")
            stopDots()
            setState(State.THINKING, "Respondendo...")
        }
        replyBubble?.text = text
        scrollToEnd()
        armTimeout(id, STALL_TIMEOUT_MS)
    }

    private fun onReplyDone(id: Long, st: String, reply: String) {
        if (waitingId != id) return
        waitingId = null
        main.removeCallbacks(timeout)
        stopDots()
        when (st) {
            "done" -> {
                replyBubble?.text = reply
                Haptics.replied(context)
                setIdle("Toque para falar de novo")
            }
            "setup" -> showError(reply, setup = true)
            "cancelled" -> setIdle("Toque para falar de novo")
            else -> showError(reply, setup = false)
        }
        replyBubble = null
        scrollToEnd()
    }

    private var timeout = Runnable {}

    /** Gives up if no new text arrives in [ms]. Reset on every chunk. */
    private fun armTimeout(id: Long, ms: Long) {
        main.removeCallbacks(timeout)
        timeout = Runnable {
            if (waitingId != id) return@Runnable
            AssistantLog.log("agente: sem texto novo em $ms ms; comando $id cancelado")
            CommandInbox.get(context).cancel(id)
            waitingId = null
            stopDots()
            showError("Demorou demais. Tente de novo.", setup = false)
        }
        main.postDelayed(timeout, ms)
    }

    // --- Views ---

    private fun setState(next: State, label: String) {
        state = next
        status?.text = label
        status?.textSize = if (next == State.IDLE) 15f else 18f
        status?.setTextColor(if (next == State.IDLE) MUTED else INK)
        status?.typeface = if (next == State.IDLE) Typeface.DEFAULT else Typeface.DEFAULT_BOLD
        halo?.visibility = if (next == State.LISTENING) View.VISIBLE else View.INVISIBLE
        if (next != State.LISTENING) bars.forEach { it.scaleY = 1f }
    }

    private fun setIdle(label: String) = setState(State.IDLE, label)

    /** Replaces the pending reply bubble with an error card; [setup] adds a button to the settings. */
    private fun showError(message: String, setup: Boolean) {
        stopDots()
        replyBubble?.let { messages?.removeView(it) }
        replyBubble = null
        val ctx = context
        val card = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(16), px(14), px(16), px(14))
            background = GradientDrawable().apply {
                setColor(ERROR_BG)
                setStroke(px(1), ERROR_LINE)
                cornerRadii = radii(bottomLeft = 6)
            }
        }
        card.addView(TextView(ctx).apply {
            text = message
            textSize = 17f
            setTextColor(INK)
            setLineSpacing(0f, 1.2f)
        })
        if (setup) {
            card.addView(
                TextView(ctx).apply {
                    text = "Abrir configurações"
                    textSize = 15f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.WHITE)
                    gravity = Gravity.CENTER
                    minHeight = px(44)
                    setPadding(px(18), 0, px(18), 0)
                    background = GradientDrawable().apply {
                        setColor(PINE)
                        cornerRadius = 999 * density
                    }
                    setOnClickListener { openSettings() }
                },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(12) },
            )
        }
        messages?.addView(card, bubbleParams(user = false, fill = true))
        setIdle(if (setup) "Sua fala não foi enviada." else "Toque para falar de novo")
        scrollToEnd()
    }

    private fun openSettings() {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("edji://settings"))
            .setPackage(context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startAssistantActivity(intent)
        } catch (e: Exception) {
            AssistantLog.log("não consegui abrir as configurações: ${e.javaClass.simpleName}")
        }
        hide()
    }

    private fun addBubble(user: Boolean): TextView {
        val bubble = TextView(context).apply {
            textSize = 17f
            setLineSpacing(0f, 1.2f)
            setPadding(px(16), px(12), px(16), px(12))
            setTextColor(if (user) Color.WHITE else INK)
            maxWidth = (context.resources.displayMetrics.widthPixels * if (user) 0.8f else 0.88f).toInt()
            background = GradientDrawable().apply {
                setColor(if (user) PINE else MIST)
                cornerRadii = if (user) radii(bottomRight = 6) else radii(bottomLeft = 6)
            }
        }
        messages?.addView(bubble, bubbleParams(user, fill = false))
        return bubble
    }

    private fun bubbleParams(user: Boolean, fill: Boolean) = LinearLayout.LayoutParams(
        if (fill) ViewGroup.LayoutParams.MATCH_PARENT else ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply {
        gravity = if (user) Gravity.END else Gravity.START
        if ((messages?.childCount ?: 0) > 0) topMargin = px(10)
    }

    /** Corner radii: 20 dp everywhere except the corner pointing at the speaker. */
    private fun radii(bottomRight: Int = 20, bottomLeft: Int = 20): FloatArray {
        val r = 20 * density
        val br = bottomRight * density
        val bl = bottomLeft * density
        return floatArrayOf(r, r, r, r, br, br, bl, bl)
    }

    private fun scrollToEnd() {
        scroll?.post { scroll?.fullScroll(View.FOCUS_DOWN) }
    }

    private var dots = Runnable {}

    /** "•", "• •", "• • •" while waiting for the first words. */
    private fun startDots(bubble: TextView) {
        stopDots()
        var n = 0
        dots = object : Runnable {
            override fun run() {
                bubble.text = List(n % 3 + 1) { "•" }.joinToString(" ")
                n++
                main.postDelayed(this, 350)
            }
        }
        dots.run()
    }

    private fun stopDots() {
        main.removeCallbacks(dots)
    }

    private fun cancel(reason: String) {
        AssistantLog.log("sessão fechada: $reason")
        hide()
    }

    /** A ScrollView that grows with its content up to [maxHeight], then scrolls. */
    private class MaxHeightScrollView(context: Context) : ScrollView(context) {
        var maxHeight = Int.MAX_VALUE

        override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
            super.onMeasure(widthMeasureSpec, MeasureSpec.makeMeasureSpec(maxHeight, MeasureSpec.AT_MOST))
        }

        override fun getTopFadingEdgeStrength() = if (canScrollVertically(-1)) 1f else 0f
        override fun getBottomFadingEdgeStrength() = 0f
    }

    companion object {
        /** Waits this long for the model's first words after the transcript is stored. */
        const val FIRST_TEXT_TIMEOUT_MS = 20_000L

        /** Gives up if the reply stops for this long mid-stream. */
        const val STALL_TIMEOUT_MS = 15_000L

        private val PINE = Color.parseColor("#073E2B")
        private val MINT = Color.parseColor("#78FF9B")
        private val INK = Color.parseColor("#152019")
        private val PAPER = Color.parseColor("#F7F9F5")
        private val MIST = Color.parseColor("#E8EFE8")
        private val MUTED = Color.parseColor("#5E6A61")
        private val HALO = Color.parseColor("#D8F9DF")
        private val ERROR_BG = Color.parseColor("#FBEDEA")
        private val ERROR_LINE = Color.parseColor("#E7C4BD")

        private val BAR_HEIGHTS_DP = listOf(10, 16, 22, 16, 10)
        private val BAR_GAIN = listOf(0.8f, 1.4f, 1.8f, 1.2f, 0.9f)
    }
}
