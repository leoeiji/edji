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
 * reply into the bubble above the wheel, with a chip per tool call. The wheel
 * ([VoiceWheel]) trembles with the voice while listening. Tapping it starts
 * the next turn; the mic never reopens on its own. Closing the session
 * cancels whatever is pending; the conversation stays in the app's history
 * when the JS side saved it ("Abrir no Edji"), and is gone otherwise.
 */
class EdjiSession(context: Context) : VoiceInteractionSession(context), VoiceCapture.Listener {

    private enum class State { LISTENING, THINKING, REPLYING, IDLE }

    private val main = Handler(Looper.getMainLooper())
    private var capture: VoiceCapture? = null
    private var shownAt = 0L
    private var sessionId: String? = null
    private var state = State.IDLE
    private var waitingId: Long? = null

    private var scroll: ScrollView? = null
    private var messages: LinearLayout? = null
    private var wheel: VoiceWheel? = null
    private var status: TextView? = null
    private var openInApp: TextView? = null
    /** Whether the JS side saved this session as a conversation (ADR 0006). */
    private var saved = false
    /** Tool chips of the current turn, by tool call id. */
    private val chips = mutableMapOf<String, TextView>()
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

        // The wheel: pine disc, mint ring and the five bars; it trembles with the voice.
        val wheelSize = px(132)
        val wheelView = VoiceWheel(ctx).apply {
            contentDescription = "Falar de novo"
            setOnClickListener { if (this@EdjiSession.state == State.IDLE) startListening() }
        }
        sheet.addView(
            wheelView,
            LinearLayout.LayoutParams(wheelSize, wheelSize).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = px(20)
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

        val openView = TextView(ctx).apply {
            text = "Abrir no Edji"
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(PINE)
            gravity = Gravity.CENTER
            minHeight = px(44)
            visibility = View.GONE
            setOnClickListener { openConversation() }
        }
        sheet.addView(
            openView,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = px(4)
            },
        )

        root.addView(sheet, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))

        scroll = scrollView
        messages = list
        wheel = wheelView
        status = statusView
        openInApp = openView
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
        wheel?.stop()
        resetConversation()
    }

    private fun resetConversation() {
        messages?.removeAllViews()
        userBubble = null
        replyBubble = null
        chips.clear()
        saved = false
        openInApp?.visibility = View.GONE
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
        wheel?.setLevel(WheelShape.levelFromRms(rmsDb))
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
        chips.clear()
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
                onTool = { callId, label, toolState -> main.post { onTool(id, callId, label, toolState) } },
                onSaved = { main.post { if (waitingId == id) saved = true } },
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
            setState(State.REPLYING, "Respondendo...")
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
                if (saved) openInApp?.visibility = View.VISIBLE
            }
            "setup" -> showError(reply, setup = true)
            "cancelled" -> setIdle("Toque para falar de novo")
            else -> showError(reply, setup = false)
        }
        replyBubble = null
        scrollToEnd()
    }

    /** Adds or updates the chip of a tool call, just above the reply bubble. */
    private fun onTool(id: Long, toolCallId: String, label: String, toolState: String) {
        if (waitingId != id) return
        val chip = chips[toolCallId] ?: addChip().also { chips[toolCallId] = it }
        val mark = when (toolState) {
            "running" -> "…"
            "failed" -> "!"
            else -> "✓"
        }
        chip.text = "$mark  $label"
        chip.setTextColor(if (toolState == "failed") ERROR_TEXT else PINE)
        chip.contentDescription = "$label, " + when (toolState) {
            "running" -> "rodando"
            "failed" -> "falhou"
            else -> "concluída"
        }
        armTimeout(id, STALL_TIMEOUT_MS)
        scrollToEnd()
    }

    private fun addChip(): TextView {
        val chip = TextView(context).apply {
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(px(12), px(6), px(14), px(6))
            background = GradientDrawable().apply {
                setColor(MIST)
                cornerRadius = 999 * density
            }
        }
        val list = messages ?: return chip
        val at = replyBubble?.let { list.indexOfChild(it) }?.takeIf { it >= 0 } ?: list.childCount
        val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.START
            topMargin = px(8)
        }
        list.addView(chip, at, params)
        return chip
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
        wheel?.state = when (next) {
            State.LISTENING -> WheelState.LISTENING
            State.THINKING -> WheelState.THINKING
            State.REPLYING -> WheelState.REPLYING
            State.IDLE -> WheelState.IDLE
        }
        if (next == State.LISTENING) openInApp?.visibility = View.GONE
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

    private fun openSettings() = openLink("edji://settings")

    /** Continues the session in the app's chat, where it was saved. */
    private fun openConversation() {
        val id = sessionId ?: return
        openLink("edji://chat/voice/$id")
    }

    private fun openLink(link: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link))
            .setPackage(context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startAssistantActivity(intent)
        } catch (e: Exception) {
            AssistantLog.log("não consegui abrir $link: ${e.javaClass.simpleName}")
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
        private val INK = Color.parseColor("#152019")
        private val PAPER = Color.parseColor("#F7F9F5")
        private val MIST = Color.parseColor("#E8EFE8")
        private val MUTED = Color.parseColor("#5E6A61")
        private val ERROR_BG = Color.parseColor("#FBEDEA")
        private val ERROR_LINE = Color.parseColor("#E7C4BD")
        private val ERROR_TEXT = Color.parseColor("#9A2A1F")
    }
}
