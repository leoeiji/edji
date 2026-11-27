# 0006: Chat como início, conversas guardadas, modelo leve e a roda da voz

- **Status:** aceita; nada verificado em aparelho
- **Data:** 2026-11-27
- **Relacionadas:** emenda a [0004](0004-agente-com-ai-sdk-e-openrouter.md); [0003](0003-arquitetura-de-plugins.md), [0005](0005-rotinas.md)

## Contexto

Na ADR 0004, a tela inicial era vazia, o agente só existia na sessão de voz e a conversa sumia ao fechar a sessão. Com tools (rotinas e finanças), a pessoa precisa ver o que o agente fez e voltar a uma conversa depois. O conceito aprovado foi publicado como artefato ("Edji Chat").

## Alternativas

- **Histórico só na sessão (como era):** simples e privado, mas sem continuidade e sem lugar para conferir as ações.
- **Histórico só do chat de texto, voz efêmera:** a voz é o uso principal; deixá-la de fora quebra a continuidade. Fica como opção para quem desliga.
- **Mandar ao modelo só o texto dos turnos passados:** mais barato, mas o modelo perde o que fez ("apaga o que você registrou").
- **Título pelo modelo da conversa:** caro para uma tarefa pequena. Um campo próprio de modelo leve serve a outras tarefas curtas depois.
- **Vibração contínua do motor enquanto ouve:** o ruído do motor entra na captura e gasta bateria.

## Decisão

- **Início é o chat de texto** (`ChatScreen`), sem anexo e sem microfone nesta etapa. As conversas ficam na aba lateral, por dia (Hoje, Ontem, Esta semana, Antes), acima das telas dos plugins; tocar e segurar renomeia ou apaga.
- **Conversas no `edji.db`**, só do JS: `chat_conversations`, `chat_messages`, `chat_parts` e `app_settings`, com migração versionada no `plugin_schema` sob o id `_chat` (nenhum plugin pode começar com `_`). Uma mensagem é uma lista de partes na ordem do stream: texto e chamadas de tool (nome, entrada, resposta, estado, tempo). Apagar é em cascata e sem desfazer. `foreign_keys` ligado no `getDb`.
- **Tools visíveis:** o `runAgent` emite `onToolEvent` (`running`, `done`, `failed`) com o id da chamada. O chat mostra um cartão "Plugin · Ação" que abre com o nome técnico, a entrada e a resposta. Todo tool declara `label` em português, e o `validatePlugins` exige isso.
- **Tools voltam ao modelo:** o histórico guardado vira mensagens do AI SDK com pares chamada/resultado (`toModelMessages`). Uma chamada cortada volta com o resultado "Interrompida antes de terminar.". As nossas mensagens de erro (`failed`, `setup`) aparecem na tela e nunca voltam ao modelo.
- **Um turno, dois caminhos:** `runPersistedTurn` (`core/chatTurn.ts`) grava o turno enquanto ele chega, para o chat e para a voz. O chat usa `CHAT_INSTRUCTIONS` (sem o limite de três frases e ainda sem markdown, porque o app não renderiza); a voz segue com `INSTRUCTIONS`.
- **Voz guardada por padrão:** cada sessão de voz vira uma conversa de origem `voice`, ligada pelo `session_id` da caixa de entrada; o histórico vem do `edji.db`. Um interruptor em Configurações → Conversas desliga isso, e aí vale o comportamento da 0004 (fechar apaga). Com a conversa guardada, a sessão oferece "Abrir no Edji" (`edji://chat/voice/<sessionId>`).
- **Modelo leve:** terceiro campo (`openrouter_light_model` no `expo-secure-store`). `runLight` (`agent/light.ts`) é a porta para tarefas curtas; hoje só o título. A conversa nasce com as primeiras palavras do pedido (`pending`); depois da primeira resposta, o modelo leve recebe o pedido e a resposta (até 500 caracteres cada) e devolve até 6 palavras (`done`). Sem chave, sem modelo leve ou com falha, fica o provisório (`local`), sem rede. Renomear trava o título (`manual`).
- **Roda na sessão de voz:** `VoiceWheel` (Kotlin, `Canvas`) substitui a bolinha: o anel treme com o RMS do `SpeechRecognizer` ao ouvir, um arco gira ao pensar, o anel respira ao responder. A geometria fica em `WheelShape`, testada na JVM. Com as animações do sistema desligadas, a roda fica parada. Cada tool vira um chip acima da resposta (`pushTool`). A háptica continua só nos dois pulsos do brandbook.

## Consequências

- **Privacidade:** as conversas ficam só no aparelho. Nada novo sai dele além do que a 0004 já mandava; o modelo leve recebe o primeiro pedido e a primeira resposta, sob o mesmo opt-in da chave. Execuções de rotina (`ask_agent`) não viram conversa.
- **Custo:** reenviar as tools passadas aumenta os tokens em conversas longas. Se pesar, cortar o histórico antigo.
- **Ponte nativa:** `PendingCommand` ganha `sessionId`; novos `pushTool` e `markSaved`. O `CommandInbox` continua só do nativo.
- **A validar no S26:** o teclado sobre o chat (edge-to-edge com `KeyboardAvoidingView`), a roda acompanhando a voz sem travar a sessão, os chips com o app fechado, "Abrir no Edji" a partir da tela bloqueada e se um pulso leve no pico da voz ajuda ou atrapalha o STT.
