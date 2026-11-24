package dev.edji.spike

import org.junit.Assert.assertEquals
import org.junit.Test

class TaskTextTest {
    @Test
    fun collapsesSpacesTrimsPunctuationAndCapitalizes() {
        assertEquals("Comprar pão", TaskText.clean("  comprar   pão. "))
    }

    @Test
    fun keepsTextThatIsAlreadyClean() {
        assertEquals("Ligar pro dentista", TaskText.clean("Ligar pro dentista"))
    }

    @Test
    fun dropsTrailingQuestionAndExclamationMarks() {
        assertEquals("Pagar a conta de luz", TaskText.clean("pagar a conta de luz!?"))
    }

    @Test
    fun capitalizesAccentedFirstLetter() {
        assertEquals("Água das plantas", TaskText.clean("água das plantas"))
    }

    @Test
    fun returnsEmptyForBlankInput() {
        assertEquals("", TaskText.clean("   "))
        assertEquals("", TaskText.clean("..."))
    }
}
