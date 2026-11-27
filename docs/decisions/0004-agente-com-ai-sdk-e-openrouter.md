# 0004: Agente conversacional com AI SDK e OpenRouter

- **Status:** aceita; comportamento em aparelho ainda não verificado. Emendada pela [0006](0006-chat-com-historico.md): o início vira o chat, as conversas são guardadas (inclusive as de voz, com interruptor) e a bolinha vira a roda.
- **Data:** 2026-11-24
- **Relacionadas:** [0001](0001-ativacao-pelo-botao-lateral-android.md), [0002](0002-stack-react-native-expo.md), [0003](0003-arquitetura-de-plugins.md)

## Contexto

O plugin `todo` era temporário: servia para validar o caminho gesto → voz → JS. O próximo passo é o loop principal do agente: a fala transcrita vai para um modelo de linguagem e a resposta aparece na sessão de voz, como um chat. Nesta etapa o agente não tem tools.

Os princípios do projeto pedem que nada saia do aparelho sem opt-in explícito.

## Alternativas

- **Modelo local:** mais privado, mas ainda não há candidato avaliado (tamanho, bateria, português). Continua em aberto.
- **SDK de um provedor só:** prende o app a um fornecedor.
- **AI SDK da Vercel com OpenRouter:** API única para streaming e, depois, tool calling; o OpenRouter dá acesso a muitos modelos com uma chave só. Escolhida.

## Decisão

- O agente (`app/src/agent/agent.ts`) usa `streamText` do pacote `ai` com o provedor `@openrouter/ai-sdk-provider`. Primeiro e, por ora, único provedor.
- **Configurações:** chave de API e ID do modelo, os dois no `expo-secure-store` (Keystore do Android), nunca no `edji.db`.
- **Opt-in:** preencher a chave é o opt-in de rede. Sem chave ou sem modelo, o agente responde com uma mensagem de configuração e não faz nenhuma chamada. Só o texto transcrito e o histórico da sessão vão para o OpenRouter; o áudio nunca sai do aparelho. Não enviamos cabeçalhos de identificação do app.
- **Streaming no React Native:** o `fetch` do React Native não entrega o corpo em partes, então o provedor usa o `expo/fetch`. Polyfills de `structuredClone`, `TextEncoderStream` e `TextDecoderStream` são carregados primeiro no `index.ts`, para valer também na task Headless JS.
- **Caminho da voz:** igual à ADR 0003 até a caixa de entrada. O JS empurra o texto parcial com `pushReply(id, texto)`; quando a função devolve `false` (sessão fechada), o JS aborta a chamada. O resultado final vai por `completeCommand(id, status, resposta)`, com status `done`, `setup`, `failed` ou `cancelled`.
- **Histórico:** vive só enquanto a sessão está aberta. A caixa de entrada guarda `session_id` (versão 2 do `edji-inbox.db`, coluna adicionada com `ALTER TABLE`), e o nativo monta o histórico a partir dos turnos concluídos da mesma sessão. Fechar a sessão cancela o comando pendente; abrir uma nova cancela sobras. Nada é enviado depois que a sessão fecha, e o app não reprocessa comandos ao abrir.
- **Sessão de voz:** chat com balões acima da bolinha. Estados: Ouvindo... → Pensando... → Respondendo... → resposta. O microfone só reabre quando o usuário toca na bolinha. Se faltar chave ou modelo, a sessão mostra um botão "Abrir configurações" (`edji://settings`).
- **Prazos:** a sessão espera até 20 s pelo primeiro texto e desiste se o texto parar por 15 s. A task Headless JS pode durar até 60 s.

## Consequências

- O princípio "local e privado" passa a ter uma exceção explícita: com a chave preenchida, o texto das conversas vai para o OpenRouter e para o provedor do modelo escolhido.
- A tabela `todo_items` fica órfã no `edji.db` de quem instalou a versão anterior; nada a lê.
- Os estados do brandbook (Pronto → Ouvindo... → Entendi. → Anotado.) não valem mais para a sessão de voz; precisam de revisão no próximo brandbook.
- A verificar em aparelho: tempo até o primeiro texto com o app fechado, streaming via `expo/fetch` dentro do Headless JS, tela bloqueada e erros sem rede.
- Tools (os do contrato da ADR 0003) entram depois pelo `streamText` com `tools`; o agente atual não oferece nenhum.
