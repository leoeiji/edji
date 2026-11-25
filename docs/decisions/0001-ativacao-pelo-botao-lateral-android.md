# 0001: Ativação pelo botão lateral no Android

- **Status:** aceita (validada em um aparelho)
- **Data:** 2026-11-23
- **Evidência:** spike `spikes/android-assistant/` (removido da árvore; branch `0.0.1`, commit `7d16948`)

## Contexto

Toda a proposta do Edji depende de segurar o botão lateral e cair direto no modo de voz, sem abrir o app (ver a hipótese crítica no `AGENTS.md`). Faltava saber se um app de terceiros recebe esse gesto num Samsung, onde o botão é customizado pela One UI, e se o reconhecimento de voz em português funciona no aparelho, sem rede e com latência aceitável.

## Alternativas

1. **Assistente digital padrão** (`VoiceInteractionService` + papel `android.app.role.ASSISTANT`), acionado por Botão lateral → Pressionar e manter → Assistente digital.
2. **Pressionar duas vezes → Abrir app**, apontando para uma atividade de voz do Edji.
3. **Atalho ou bloco no painel rápido**, sem botão físico.

## Resultado no aparelho

Aparelho: Galaxy S26 Ultra, One UI 9. Teste manual feito pelo mantenedor.

| Verificação | Resultado |
| --- | --- |
| Edji aparece como assistente digital e o botão lateral abre a sessão | Sim |
| Reconhecedor usado | On-device do sistema (`createOnDeviceSpeechRecognizer`), pt-BR |
| Funciona em modo avião | Sim |
| Funciona com a tela bloqueada | Sim |
| Teste de voz no app depois de o Edji virar assistente | Sim (o stub de `RecognitionService` não atrapalhou) |
| Gesto → microfone aberto | 156 ms e 161 ms (no app, sem gesto: 230 ms) |
| Gesto → tarefa salva (inclui o tempo falando) | 4,1 s e 6,6 s |
| Com a tela apagada | Não verificado |

Valores registrados na sessão aberta pelo botão:

- `showFlags=0x107` = `SHOW_WITH_ASSIST` (0x1) + `SHOW_WITH_SCREENSHOT` (0x2) + `SHOW_SOURCE_ASSIST_GESTURE` (0x4) + um bit 0x100 não documentado.
- `args`: `invocation_type=6`, `invocation_phone_state=9`, `android.intent.extra.ASSIST_DISPLAY_ID=0`, `invocation_time_ms`.

## Decisão

Usar a alternativa 1 no MVP Android: o Edji é um `VoiceInteractionService` escolhido como assistente digital, e o usuário configura o botão lateral em Pressionar e manter → Assistente digital. O STT é o reconhecedor on-device do sistema, escolhido explicitamente (nunca o reconhecedor padrão, que pode ser o próprio stub do Edji).

## Consequências

- **Não depender de `SHOW_SOURCE_PUSH_TO_TALK`.** Na Samsung, o botão chega como `SHOW_SOURCE_ASSIST_GESTURE`. Para distinguir o botão de outras origens, o sinal observado é `invocation_type=6` nos `args` (no AOSP, `AssistUtils` associa 6 ao toque longo no botão de ligar, mas a chave não é API pública). Tratar como dica, não como contrato.
- **A latência de abertura é boa** (cerca de 160 ms). O tempo total é dominado pela fala e pela espera de silêncio do reconhecedor; ajustar essa espera é a próxima alavanca de velocidade.
- **A medida "fim da fala → resultado" do spike não é confiável:** deu 0 a 1 ms, porque o reconhecedor on-device avisa o fim da fala junto com o resultado. Para medir a espera de silêncio, usar o último resultado parcial ou o último pico de volume.
- **O texto falado inteiro vira a tarefa** ("A gente precisa comprar pão"). Isso é o combinado para o MVP; limpar frases como "a gente precisa" fica para a interpretação de comandos.
- **Ativar o assistente tira o menu de desligar do botão lateral.** O onboarding do MVP precisa explicar isso e mostrar onde o menu fica (painel rápido ou lateral + volume para baixo).
- **Validado num único aparelho.** Pixel, Xiaomi e outras versões da One UI continuam pendentes, assim como a tela apagada.
