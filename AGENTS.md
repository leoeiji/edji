# Edji — contexto para agentes

## Manutenção deste arquivo

Este é um documento vivo. Leia-o antes de trabalhar neste repositório e atualize-o na mesma mudança sempre que surgir ou mudar uma estrutura, decisão relevante, convenção ou lembrete importante. Mantenha o conteúdo conciso, atual e verificável; remova orientações superadas e diferencie decisões aceitas de hipóteses e questões em aberto. Não registre segredos ou dados pessoais.

## Objetivo

Construir um assistente pessoal para celular que rode localmente o máximo possível. A funcionalidade central é ativar o modo de voz pelo botão lateral (ligar/desligar), falar um comando e receber a resposta sem abrir o app.

### MVP

App **Android** com uma lista de tarefas:

1. O usuário segura o botão de ligar/desligar.
2. O Edji abre o reconhecimento de voz (STT) no aparelho.
3. O texto transcrito vira um item novo na lista, salvo localmente, com uma confirmação curta (visual ou háptica).
4. A tela do app exibe a lista.

No MVP, o texto falado inteiro vira a tarefa; não há interpretação de intenção. Fora do MVP: listar, concluir ou editar por voz; outros comandos (lembretes, agenda, notas, perguntas abertas); iOS.

Critério de aceite proposto: num Android real configurado com o Edji como assistente padrão, segurar o botão, dizer "comprar pão" e ver "comprar pão" na lista ao abrir o app, sem rede.

## Estado do projeto

- Etapa 1 do roteiro concluída: o spike Android em `spikes/android-assistant/` funcionou no Galaxy S26 Ultra (One UI 9), com botão lateral, STT on-device, modo avião e tela bloqueada. Resultado e números em [`docs/decisions/0001-ativacao-pelo-botao-lateral-android.md`](docs/decisions/0001-ativacao-pelo-botao-lateral-android.md). Próximo passo: spike do caminho da voz (etapa 3).
- Stack e arquitetura de plugins decididas (ADRs 0002 e 0003). O app Expo em `app/` tem a casca, o núcleo de plugins, o plugin `todo` e o módulo nativo de voz com a caixa de entrada e Headless JS; testes unitários passam, mas o caminho da voz até o tool ainda não foi medido em aparelho (etapa 3). Não descreva funcionalidades como implementadas sem evidência.

## Hipótese crítica: ativação pelo botão lateral

Toda a proposta depende disso. **Validado no Android em um aparelho** (Galaxy S26 Ultra; ver ADR 0001). Outros fabricantes e o iOS seguem em aberto.

- **Android (alvo inicial).** A documentação oficial descreve uma sessão de voz iniciada ao segurar o botão de ligar, que ativa o `VoiceInteractionService` atual, escolhido pelo usuário; o app precisa ocupar o papel `android.app.role.ASSISTANT` (implementando `VoiceInteractionService` ou tratando `ACTION_ASSIST`). A sessão recebe `SHOW_SOURCE_PUSH_TO_TALK` quando vem de um botão físico. Referências: [VoiceInteractionService](https://developer.android.com/reference/android/service/voice/VoiceInteractionService), [VoiceInteractionSession](https://developer.android.com/reference/android/service/voice/VoiceInteractionSession), [RoleManager](https://developer.android.com/reference/android/app/role/RoleManager).
  - Confirmado no S26: o gesto abre a sessão em cerca de 160 ms até o microfone, funciona com a tela bloqueada e sem rede. Na Samsung, o botão chega como `SHOW_SOURCE_ASSIST_GESTURE` (não `PUSH_TO_TALK`), com `invocation_type=6` nos `args`; não dependa de `PUSH_TO_TALK`.
  - A validar: Pixel e Xiaomi; tela apagada; versão mínima do Android; se dá para pedir o papel via `RoleManager` ou só pelas configurações.
  - **Samsung (aparelho de teste: Galaxy S26 Ultra).** Desde a One UI 7, Configurações → Recursos avançados → Botão lateral → Pressionar e manter → **Assistente digital** abre o assistente padrão, e há relatos de apps de terceiros (ChatGPT, Alexa) aparecendo como opção no ícone de engrenagem ([SamMobile](https://www.sammobile.com/news/galaxy-z-flip-fold-6-one-ui-7-beta-3-gemini-side-button/), [suporte Samsung](https://www.samsung.com/ie/support/mobile-devices/how-to-customise-the-side-button-with-new-features-on-your-galaxy-phone-and-tablet/)). Com isso, o menu de desligar sai do botão lateral e fica no painel rápido ou em lateral + volume para baixo. Alternativa a avaliar, se o Edji não aparecer na lista: **pressionar duas vezes → Abrir app**, apontando para uma atividade de voz do Edji.
- **iOS.** O botão lateral é da Siri. O equivalente mais próximo é o Action Button (modelos recentes), que pode disparar um App Shortcut definido com App Intents. Referências: [App Intents: tornar ações descobríveis](https://developer.apple.com/documentation/appintents/making-actions-and-content-discoverable-and-widely-available), [WWDC25: Get to know App Intents](https://developer.apple.com/videos/play/wwdc2025/244/).
  - A validar: se o intent consegue abrir captura de voz direto, funcionar com a tela bloqueada e se isso basta como experiência. Siri + App Intents é outra alternativa.

## Roteiro proposto

Sem calendário. Cada etapa só conta como concluída com evidência em aparelho real.

1. **Spike de ativação (Android).** App mínimo que vira assistente padrão e, ao segurar o botão, abre o microfone e mostra o texto transcrito. Registrar aparelhos testados e resultado em `docs/decisions/`.
2. ~~**Decisão da stack.**~~ Concluída: ADRs 0002 (stack) e 0003 (plugins).
3. **Spike do caminho da voz.** Medir no S26, com o app fechado, "fim do STT → tool executado" usando Headless JS e a caixa de entrada de comandos. Registrar ADR.
4. **MVP.** Casca Expo com aba lateral, registro de plugins e plugin `todo`; o texto transcrito vira item da lista pelo `todo.add`.
5. **Depois do MVP.** Escolha do tool pela frase (listar, concluir), novos plugins (ex.: agenda) e iOS (Action Button/App Intents).

## Stack

**Decidido** ([ADR 0002](docs/decisions/0002-stack-react-native-expo.md)): app em **Expo (React Native, TypeScript)** com *development builds*; a sessão de voz é um módulo nativo local (`modules/edji-assistant`: Kotlin no Android, Swift no iOS depois), portado do spike; persistência em SQLite: `edji.db` só do JS (`expo-sqlite`) e `edji-inbox.db` só do nativo; nunca o mesmo arquivo pelos dois (ADR 0003).

```
app (Expo, TypeScript): casca da interface, aba lateral, configurações, agente, registro de plugins
  src/plugins/<id>/ (TypeScript): tools, interface da aba lateral, tabelas e migrações
  modules/edji-assistant/
    android/ (Kotlin): serviço de assistente, sessão de voz, STT on-device
    ios/     (Swift): App Intent + Action Button, depois do MVP
  edji.db (JS): plugins ligados, esquemas, dados dos plugins · edji-inbox.db (nativo): caixa de entrada de comandos
```

## Plugins

Contrato completo na [ADR 0003](docs/decisions/0003-arquitetura-de-plugins.md).

- Plugin = módulo TypeScript de primeira parte em `app/src/plugins/<id>/`, compilado junto com o app; nada é carregado em tempo de execução.
- Declara manifesto (`id`, nome, versão, ligado por padrão) e, opcionalmente, **tools** para o agente (`<id>.<ação>`, JSON Schema, handler TS com resposta curta) e uma **interface** na aba lateral.
- Dados em tabelas com prefixo do plugin e migrações versionadas.
- Desligar esconde a interface e tira os tools do registro, mas **preserva os dados**. O estado fica em `plugin_state` no `edji.db`.
- O plugin `todo` é o primeiro: interface da lista e tools `todo.add`, `todo.list`, `todo.complete`. No MVP o agente só roteia a frase inteira para `todo.add`.
- **Caminho da voz (hipótese, medir):** a sessão nativa abre o microfone sem JS, inicia um runtime JS em segundo plano enquanto o usuário fala, grava o texto numa caixa de entrada de comandos e o JS executa o tool. Se o JS não responder a tempo, o comando fica pendente e a sessão diz isso.

## Questões em aberto

- **STT no aparelho:** reconhecimento on-device do Android (`SpeechRecognizer`), whisper.cpp ou Vosk. Critérios: português, latência, tamanho do modelo e funcionamento offline. Para o MVP, o reconhecimento do sistema pode bastar se funcionar offline.
- **Escolha do tool (pós-MVP):** regras simples ou modelo de linguagem local com tool calling. Avaliar bateria, memória e tamanho do app.
- **Tools a partir do iOS:** App Intents rodam em Swift; como executar tools TypeScript pelo Action Button.
- **Confirmação:** háptica, visual ou TTS do sistema.
- **Nuvem opcional:** se existir, como opt-in explícito e desligado por padrão.

## Princípios

- **Local e privado.** Áudio, transcrições e tarefas ficam no aparelho por padrão. Nenhuma chamada de rede sem opt-in explícito e documentado.
- **Resposta rápida.** Medir o tempo entre o gesto e o microfone aberto, e entre o fim da fala e a confirmação.
- **Falhas claras.** Comando não entendido, microfone negado ou papel de assistente ausente devem gerar mensagens compreensíveis e um caminho para resolver.
- **Testes.** Toda melhoria vem com um teste de regressão que cubra o comportamento alterado. A interpretação de comandos deve ter testes com frases de exemplo em português. Comportamento de hardware é verificado manualmente em aparelho real e registrado.
- **Preservar dados.** Persistência versionada e migrações sem perda silenciosa.

## Identidade e comunicação

Consulte `docs/references/edji-brandbook-01.html` (Brandbook 01, conceito v1.0) para símbolo, paleta, tipografia, tom, estados da sessão de voz e feedback. É uma proposta de identidade; os mockups e a simulação de voz são demonstrativos, não o app implementado.

- **Símbolo:** cinco barras simétricas mint sobre verde-pinho, com cantos arredondados. Sem microfone, checklist, sombra ou texto dentro do ícone. No Android adaptativo, as barras são o foreground e o verde-pinho o background; os SVGs de referência são gerados pelo próprio brandbook (seção Kit de marca).
- **Paleta:** verde-pinho `#073E2B` (confiança, controles), mint `#78FF9B` (ação concluída, destaques), preto editorial `#152019`, papel `#F7F9F5`, névoa `#E8EFE8`, cinza orgânico `#6F7B72`. Mint só sobre superfícies escuras, formas e estados ativos; em fundo claro, use verde-pinho ou preto para texto. Confira o contraste real.
- **Tipografia:** fonte do sistema no app (Roboto no Android), pesos 700–900 em títulos. O traço manuscrito é só decoração de marca, nunca texto essencial nem interface.
- **Sessão de voz:** quatro estados, Pronto → Ouvindo... → Entendi. → Anotado., com retorno à tela anterior. Sem escuta contínua.
- **Feedback:** háptica é o sinal principal (proposta: 20 ms ao iniciar a captura; 20 + 45 + 25 ms ao salvar). Som de confirmação opcional, menos de 300 ms, desligado por padrão.
- **Tom:** português curto e direto ("Anotado.", "Não entendi. Pode repetir?"). Evite mensagens burocráticas ("Sua solicitação foi processada com sucesso!") e propaganda de IA.

## Convenções

- Código, identificadores e nomes de arquivos e pastas em inglês. Interface e documentação em português.
- Documente módulos e APIs públicas em inglês, no padrão da linguagem escolhida.
- Decisões arquiteturais vão em `docs/decisions/NNNN-titulo-curto.md` (contexto, alternativas, decisão, consequências).

## Estrutura atual

- `AGENTS.md`: contexto e instruções vivas do repositório.
- `CONTRIBUTING.md`: orientações de contribuição e template de descrição de PR.
- `README.md`: apresentação do projeto.
- `app/`: app Expo (TypeScript). `npm test` (Jest) e `npm run typecheck`. Pastas `android/` e `ios/` são geradas por `npx expo prebuild` e ignoradas; nunca edite à mão.
  - `App.tsx`: casca com aba lateral (views dos plugins ligados, Configurações, Registro). `index.ts` registra a task Headless JS `EdjiCommand`.
  - `src/core/`: contrato de plugin (`plugin.ts`), registro (`registry.ts`), agente (`agent.ts`, MVP roteia tudo para `todo.add`), banco e migrações (`db.ts`), execução da caixa de entrada (`runtime.ts`, `headless.ts`).
  - `src/plugins/<id>/`: plugins; registre novos em `src/plugins/index.ts`. `todo`: tela, tools `todo.add`/`todo.list`/`todo.complete`, tabela `todo_items`.
  - `src/ui/`: tema da marca, Configurações e Registro.
  - `modules/edji-assistant/`: módulo nativo local (Kotlin): serviço de assistente, sessão de voz, STT, caixa de entrada (`CommandInbox`), `EdjiCommandTaskService` (Headless JS) e ponte JS (`index.ts`).
- `spikes/android-assistant/`: spike descartável em Kotlin (AGP 9.4 com Kotlin embutido, Gradle 9.6 via wrapper, SDK 36, minSdk 31; Compose na tela do app, Views na sessão de voz). Valida o gesto, o STT on-device e as latências; o README traz os passos no aparelho e o checklist para o ADR. Lições do spike: o Android só lista um assistente que declara `recognitionService`, então há um stub (`EdjiRecognitionService`); por isso o reconhecimento nunca usa o reconhecedor padrão e escolhe explicitamente o on-device ou outro serviço. Não é base do MVP.
- `docs/decisions/`: ADRs. `0001`: ativação pelo botão lateral no Android. `0002`: stack React Native + Expo. `0003`: arquitetura de plugins.
- `.gitignore`: ignora artefatos de Gradle/Android, IDEs e `.worktree/`.
- `docs/references/edji-brandbook-01.html`: brandbook interativo (abrir no navegador); preserve-o como referência e registre novas edições como arquivos novos.
- `LICENSE`: licença Apache 2.0; preserve seu conteúdo.
