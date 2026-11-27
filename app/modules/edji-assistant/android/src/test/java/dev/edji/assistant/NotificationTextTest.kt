package dev.edji.assistant

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationTextTest {
    private fun pick(
        big: String? = null, text: String? = null, lines: List<String> = emptyList(),
        messages: List<String> = emptyList(), sub: String? = null, ticker: String? = null, title: String = "Compra autorizada",
    ) = NotificationText.pick(big, text, lines, messages, sub, ticker, title)

    @Test fun bigTextWinsOverText() = assertEquals("longo", pick(big = "longo", text = "curto"))

    @Test fun blankTextFallsThroughToInboxLines() =
        assertEquals("Sua compra de R$ 87,34 em Loja foi autorizada\nOutra", pick(text = " ", lines = listOf("Sua compra de R$ 87,34 em Loja foi autorizada", "", "Outra")))

    @Test fun messagingStyleMessagesAreUsed() = assertEquals("oi\ntudo bem?", pick(messages = listOf("oi", "tudo bem?")))

    @Test fun subTextIsTheLastExtra() = assertEquals("conta final 1234", pick(sub = "conta final 1234", ticker = "x"))

    @Test fun tickerThatRepeatsTheTitleIsIgnored() = assertEquals("", pick(ticker = "Compra autorizada"))

    @Test fun tickerWithMoreThanTheTitleIsUsed() = assertEquals("Compra autorizada: R$ 5", pick(ticker = "Compra autorizada: R$ 5"))
}
