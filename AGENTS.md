# Edji — contexto para agentes

## Manutenção deste arquivo

Este é um documento vivo. Leia-o antes de trabalhar neste repositório e atualize-o na mesma mudança sempre que surgir ou mudar uma estrutura, decisão relevante, convenção ou lembrete importante. Mantenha o conteúdo conciso, atual e verificável; remova orientações superadas e diferencie decisões aceitas de hipóteses e questões em aberto. Não registre segredos ou dados pessoais.

## Objetivo

Construir um assistente pessoal para celular que rode localmente o máximo possível. A funcionalidade central é ativar o modo de voz pelo botão lateral (ligar/desligar), falar um comando e receber a resposta sem abrir o app.

### MVP

App **Android** com um chat por voz ([ADR 0004](docs/decisions/0004-agente-com-ai-sdk-e-openrouter.md)):

1. O usuário segura o botão de ligar/desligar.
2. O Edji abre o reconhecimento de voz (STT) no aparelho.
3. O texto transcrito vai para o agente, que chama o modelo configurado no OpenRouter, e a resposta aparece na sessão, num balão acima da bolinha.
4. Tocar na bolinha abre o microfone para o próximo turno. Fechar a sessão apaga a conversa.

O agente chama os tools dos plugins ligados (hoje só `routines`). A tela inicial do app fica vazia; as Configurações têm a chave de API, o modelo e o opt-in das rotinas. Fora do MVP: histórico persistente, modelo local, iOS.

Critério de aceite proposto: num Android real configurado com o Edji como assistente padrão e com chave e modelo preenchidos, segurar o botão, fazer uma pergunta e ver a resposta aparecer em partes; tocar na bolinha e fazer uma pergunta que dependa da anterior. Sem chave, a sessão pede a configuração sem chamar a rede.

## Estado do projeto

- Etapa 1 do roteiro concluída: o spike Android (removido da árvore; recuperável no commit `7d16948`) funcionou no Galaxy S26 Ultra (One UI 9), com botão lateral, STT on-device, modo avião e tela bloqueada. Resultado e números em [`docs/decisions/0001-ativacao-pelo-botao-lateral-android.md`](docs/decisions/0001-ativacao-pelo-botao-lateral-android.md). Próximo passo: spike do caminho da voz (etapa 3).
- Stack, arquitetura de plugins e agente decididos (ADRs 0002, 0003 e 0004). O app Expo em `app/` tem a casca, o núcleo de plugins (sem nenhum plugin; o `todo` foi removido), o agente com AI SDK + OpenRouter e o módulo nativo de voz com chat, caixa de entrada e Headless JS. Testes unitários passam e o Kotlin compila, mas nada disso foi verificado em aparelho (etapa 3). Não descreva funcionalidades como implementadas sem evidência.
- Rotinas (gatilho → ações criadas pelo agente por voz) implementadas de ponta a ponta ([ADR 0005](docs/decisions/0005-rotinas.md)): tool calling no agente, plugin `routines` com tools e tela só leitura, motor em Kotlin (`RoutineEngine`, `edji-routines.db`) com gatilhos de Bluetooth, Wi-Fi, lugar, horário e notificação, e aba Permissões. Compila e os testes passam, mas **nada foi verificado em aparelho**: abrir apps com o Edji fechado e a entrega dos gatilhos são hipóteses.

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
3. **Caminho da voz em aparelho.** Medir no S26, com o app fechado, "fim do STT → primeiro texto" e "→ resposta completa" (Headless JS, caixa de entrada, streaming via `expo/fetch`), com tela bloqueada e sem rede. Registrar ADR.
4. **MVP.** Chat por voz com o agente sem tools (ADR 0004).
5. **Depois do MVP.** Tools no agente e plugins (ex.: tarefas, agenda), modelo local e iOS (Action Button/App Intents).

## Stack

**Decidido** ([ADR 0002](docs/decisions/0002-stack-react-native-expo.md)): app em **Expo (React Native, TypeScript)** com *development builds*; a sessão de voz é um módulo nativo local (`modules/edji-assistant`: Kotlin no Android, Swift no iOS depois), portado do spike; persistência em SQLite: `edji.db` só do JS (`expo-sqlite`), `edji-inbox.db` e `edji-routines.db` só do nativo; nunca o mesmo arquivo pelos dois (ADR 0003 e 0005).

```
app (Expo, TypeScript): casca da interface, aba lateral, configurações, agente, registro de plugins
  src/plugins/<id>/ (TypeScript): tools, interface da aba lateral, tabelas e migrações
  modules/edji-assistant/
    android/ (Kotlin): serviço de assistente, sessão de voz, STT on-device
    ios/     (Swift): App Intent + Action Button, depois do MVP
  edji.db (JS): plugins ligados, esquemas, dados dos plugins · edji-inbox.db (nativo): caixa de entrada de comandos
  edji-routines.db (nativo): rotinas, lugares, execuções e fila do ask_agent (ADR 0005)
  expo-secure-store: chave do OpenRouter e ID do modelo
```

## Plugins

Contrato completo na [ADR 0003](docs/decisions/0003-arquitetura-de-plugins.md).

- Plugin = módulo TypeScript de primeira parte em `app/src/plugins/<id>/`, compilado junto com o app; nada é carregado em tempo de execução.
- Declara manifesto (`id`, nome, versão, ligado por padrão) e, opcionalmente, **tools** para o agente (`<id>.<ação>`, JSON Schema, handler TS com resposta curta) e uma **interface** na aba lateral.
- Dados em tabelas com prefixo do plugin e migrações versionadas.
- Desligar esconde a interface e tira os tools do registro, mas **preserva os dados**. O estado fica em `plugin_state` no `edji.db`.
- Exceção (ADR 0005): as rotinas ficam no `edji-routines.db`, do nativo, porque precisam ser lidas com o JS morto.
- Plugin registrado: `routines` (o `todo` temporário foi removido). O agente recebe os tools dos plugins ligados, com o nome `<id>__<ação>` para o modelo; execuções de rotina (`ask_agent`) não recebem os tools de `routines`, para texto de notificação não criar rotinas.
- **Caminho da voz (hipótese, medir):** a sessão nativa abre o microfone sem JS, inicia um runtime JS em segundo plano enquanto o usuário fala, grava o texto numa caixa de entrada de comandos (com `session_id`) e o JS roda o agente, empurrando a resposta parcial com `pushReply`. Fechar a sessão cancela o comando; nada é reprocessado depois.

## Questões em aberto

- **Rotinas no aparelho (ADR 0005):** abrir app ou link com o Edji fechado (isenção de assistente, `CompanionDeviceManager` ou notificação para tocar); entrega dos gatilhos com o app morto; suspensão de apps da Samsung. Validar num spike no S26.

- **STT no aparelho:** reconhecimento on-device do Android (`SpeechRecognizer`), whisper.cpp ou Vosk. Critérios: português, latência, tamanho do modelo e funcionamento offline. Para o MVP, o reconhecimento do sistema pode bastar se funcionar offline.
- **Tools no agente (pós-MVP):** tool calling pelo AI SDK com os tools dos plugins ligados; avaliar também um modelo local.
- **Tools a partir do iOS:** App Intents rodam em Swift; como executar tools TypeScript pelo Action Button.
- **Confirmação:** háptica, visual ou TTS do sistema.
- **Outros provedores e modelo local:** hoje só OpenRouter (ADR 0004).

## Princípios

- **Local e privado.** Áudio, transcrições e dados ficam no aparelho por padrão. Nenhuma chamada de rede sem opt-in explícito e documentado. Preencher a chave do OpenRouter é o opt-in do agente: sem chave, nada sai do aparelho; com chave, só o texto da conversa vai para o OpenRouter, nunca o áudio (ADR 0004). Rotinas com "Perguntar ao agente" têm opt-in próprio, desligado por padrão, porque mandam texto (ex.: notificação do banco) sem ninguém presente (ADR 0005).
- **Resposta rápida.** Medir o tempo entre o gesto e o microfone aberto, e entre o fim da fala e a confirmação.
- **Falhas claras.** Comando não entendido, microfone negado ou papel de assistente ausente devem gerar mensagens compreensíveis e um caminho para resolver.
- **Testes.** Toda melhoria vem com um teste de regressão que cubra o comportamento alterado. A interpretação de comandos deve ter testes com frases de exemplo em português. Comportamento de hardware é verificado manualmente em aparelho real e registrado.
- **Preservar dados.** Persistência versionada e migrações sem perda silenciosa.

## Identidade e comunicação

Consulte `docs/references/edji-brandbook-01.html` (Brandbook 01, conceito v1.0) para símbolo, paleta, tipografia, tom, estados da sessão de voz e feedback. É uma proposta de identidade; os mockups e a simulação de voz são demonstrativos, não o app implementado.

- **Símbolo:** cinco barras simétricas mint sobre verde-pinho, com cantos arredondados. Sem microfone, checklist, sombra ou texto dentro do ícone. No Android adaptativo, as barras são o foreground e o verde-pinho o background; os SVGs de referência são gerados pelo próprio brandbook (seção Kit de marca).
- **Paleta:** verde-pinho `#073E2B` (confiança, controles), mint `#78FF9B` (ação concluída, destaques), preto editorial `#152019`, papel `#F7F9F5`, névoa `#E8EFE8`, cinza orgânico `#6F7B72`. Mint só sobre superfícies escuras, formas e estados ativos; em fundo claro, use verde-pinho ou preto para texto. Confira o contraste real.
- **Tipografia:** fonte do sistema no app (Roboto no Android), pesos 700–900 em títulos. O traço manuscrito é só decoração de marca, nunca texto essencial nem interface.
- **Sessão de voz:** chat com balões acima da bolinha. Estados: Ouvindo... → Pensando... → Respondendo... → resposta (ADR 0004; o brandbook ainda mostra Pronto → Ouvindo... → Entendi. → Anotado.). O microfone só reabre ao tocar na bolinha; sem escuta contínua. Fechar a sessão apaga a conversa.
- **Feedback:** háptica é o sinal principal (proposta: 20 ms ao iniciar a captura; 20 + 45 + 25 ms quando a resposta termina). Som de confirmação opcional, menos de 300 ms, desligado por padrão.
- **Tom:** português curto e direto ("Anotado.", "Não entendi. Pode repetir?"). Evite mensagens burocráticas ("Sua solicitação foi processada com sucesso!") e propaganda de IA.

## Convenções

### Geral

- Código, identificadores e nomes de arquivos e pastas em inglês. Interface e documentação em português.
- Documente módulos e APIs públicas em inglês, no padrão da linguagem (TSDoc `/** ... */` no TypeScript, KDoc no Kotlin). O comentário explica o porquê ou o contrato, não repete o código.
- Decisões arquiteturais vão em `docs/decisions/NNNN-titulo-curto.md` (contexto, alternativas, decisão, consequências).
- Mensagens de commit em inglês, no imperativo, com título curto (ex.: "Add voice chat agent with AI SDK and OpenRouter") e corpo com o porquê quando a mudança não for óbvia.

### Nomes de arquivos e pastas (`app/src/`)

| O quê | Padrão | Exemplo |
| --- | --- | --- |
| Pastas | minúsculas, plural para coleções | `screens/`, `components/`, `hooks/` |
| Telas | PascalCase com sufixo `Screen`, em `screens/` | `SettingsScreen.tsx` |
| Componentes | PascalCase, um componente público por arquivo; agrupados por tela em subpasta | `components/settings/ModelSettings.tsx` |
| Hooks | camelCase com prefixo `use`, em `hooks/` | `usePlugins.ts` |
| Módulos sem JSX | camelCase, `.ts` | `registry.ts`, `openrouter.ts` |
| Entrada de pasta | `index.ts` só quando a pasta é um módulo único | `theme/index.ts`, `plugins/index.ts` |
| Testes | `__tests__/<módulo>.test.ts(x)` ao lado do código | `agent/__tests__/agent.test.ts` |
| Plugins | `plugins/<id>/`, com `id` em minúsculas | `plugins/todo/` |

- `.tsx` só para arquivos com JSX; o resto é `.ts`.
- Código de interface fica em `screens/` e `components/`; lógica sem interface (agente, banco, runtime) fica em `agent/` e `core/` e não importa React Native de UI.

### TypeScript e React

- **Formatação** (ainda sem Prettier ou ESLint; siga o estilo existente): 2 espaços, aspas simples, ponto e vírgula, vírgula final em listas de várias linhas, linhas de até ~130 colunas.
- **Imports:** externos primeiro, depois internos pelo alias `@/`; `./` só dentro da mesma pasta. O módulo nativo é importado de `modules/edji-assistant` por caminho relativo. Use `import type` para tipos.
- **Exports:** nomeados. `export default` só onde o framework exige (`App.tsx`).
- **Tipos:** `strict` ligado; prefira `type` a `interface`; nada de `any` (use `unknown` e restrinja). Tipos de props ficam no mesmo arquivo do componente (`type Props = ...`).
- **Nomes:** componentes e tipos em PascalCase; funções, variáveis e hooks em camelCase; constantes de módulo em UPPER_SNAKE_CASE (`INSTRUCTIONS`, `PLUGINS`, `WAITING_POLL_MS`). Unidades no nome quando houver (`_MS`).
- **Componentes:** funções, não classes. Estado local com hooks; lógica reaproveitável ou com efeitos vai para um hook em `hooks/`.
- **Estilos:** `StyleSheet.create` no fim do arquivo (`const styles`). Cores sempre do `useTheme()`, nunca `#hex` ou `rgba()` soltos em componentes; cor nova entra no tipo `Theme` (claro e escuro) em `theme/`.
- **Assíncrono:** `async`/`await`. Funções que falam com rede ou modelo não lançam para a interface: devolvem um resultado com status (ex.: `AgentResult`).
- **Textos de interface:** português curto e direto, no tom da marca (ver Identidade e comunicação).

### Kotlin (`modules/edji-assistant/android`)

- Pacote `dev.edji.assistant`; um arquivo por classe principal, em PascalCase (`CommandInbox.kt`).
- Constantes em `companion object` com UPPER_SNAKE_CASE e unidade no nome (`TIMEOUT_MS`).
- Nada de I/O na thread principal da sessão de voz; banco nativo só pelo `CommandInbox`.

### Testes

- Jest com `jest-expo`. Nome do teste descreve o comportamento em inglês (`it('streams the reply so far, in order, ...')`); frases de exemplo em português.
- Módulos nativos e o `expo-secure-store` são mockados; mocks em `jest.mock` usam variáveis com prefixo `mock`.
- Antes de concluir: `npm test` e `npm run typecheck` em `app/`.

## Estrutura atual

- `AGENTS.md`: contexto e instruções vivas do repositório.
- `CONTRIBUTING.md`: orientações de contribuição e template de descrição de PR.
- `README.md`: apresentação do projeto.
- `app/`: app Expo (TypeScript). Configuração em `app.config.ts`; a versão vem só do `package.json` (`versionName`; `versionCode` = MAJOR×10000 + MINOR×100 + PATCH). Para lançar: `npm version X.Y.Z` em `app/`, commit e tag `vX.Y.Z`. `npm test` (Jest) e `npm run typecheck`. Pastas `android/` e `ios/` são geradas por `npx expo prebuild` e ignoradas; nunca edite à mão.
  - `index.ts` (entrada do Expo): carrega `src/polyfills.ts` primeiro, registra a task Headless JS `EdjiCommand` e o `src/App.tsx`.
  - `src/`, com imports pelo alias `@/` (`tsconfig.json` `paths` e `moduleNameMapper` do Jest):
    - `App.tsx`: casca com cabeçalho, tela atual e aba lateral (Início vazio, views dos plugins ligados, Configurações, Registro).
    - `screens/`: `HomeScreen`, `SettingsScreen` (modelo e plugins), `PermissionsScreen` (todas as permissões do aparelho, inclusive microfone e assistente padrão) e `LogScreen`.
    - `components/`: `Header`, `SidePanel` e `settings/` (`ModelSettings`: chave e modelo; estilos).
    - `hooks/`: `usePlugins` (inicia o runtime e carrega os estados), `usePermissions` (status, atualiza ao voltar ao app) e `useDeepLink` (`edji://<tela>`; a sessão de voz abre `edji://settings`; rotinas sem permissão levam a `edji://permissions`).
    - `navigation/destinations.ts`: destinos da aba lateral.
    - `theme/`: paleta da marca e `useTheme`.
    - `agent/`: agente (`agent.ts`: `streamText`, instruções, mensagens de erro), provedor (`openrouter.ts`, com `expo/fetch`), chave e modelo (`settings.ts`, `expo-secure-store`).
    - `core/`: contrato de plugin (`plugin.ts`), registro (`registry.ts`), banco e migrações (`db.ts`), eventos, execução da caixa de entrada (`runtime.ts`, `headless.ts`), catálogo de permissões (`permissions.ts`) e leitura/pedido no Android (`devicePermissions.ts`).
    - `plugins/`: plugins; registre novos em `plugins/index.ts`. `routines/`: tipos, validação (`schema.ts`), frase em português (`describe.ts`), permissões por rotina (`requirements.ts`), tools (`tools.ts`), tela só leitura (`RoutinesView`, `useRoutines`, `format.ts`).
    - Testes em `__tests__/` ao lado do código.
  - `modules/edji-assistant/`: módulo nativo local (Kotlin): serviço de assistente, sessão de voz em chat (`EdjiSession`), STT, caixa de entrada (`CommandInbox`, versão 2 com `session_id`), `EdjiCommandTaskService` (Headless JS) ponte JS (`index.ts`: `pendingCommands`, `pushReply`, `completeCommand`, rotinas e permissões) e rotinas: `RoutineStore` (`edji-routines.db`), `RoutineJson` (segunda validação), `RoutineEngine` (registra gatilhos e despacha eventos), `ActionRunner`, `RoutineTriggerReceiver` (Bluetooth, boot; exportado só para broadcasts protegidos), `RoutineInternalReceiver` (alarmes, proximidade, rede, fila), `EdjiNotificationListener`, `DevicePermissions` e `DeviceInfo`.
  - Jest: `transformIgnorePatterns` no `package.json` inclui `ai`, `@ai-sdk`, `@openrouter` e `@workflow`, que são ESM. Para compilar o Kotlin: `npx expo prebuild --platform android` e `./gradlew :edji-assistant:compileDebugKotlin` em `app/android`, com `JAVA_HOME` apontando para o JDK do Android Studio.
- Spike de ativação (removido): ficou no commit `7d16948`. Lição que vale manter: o Android só lista um assistente que declara `recognitionService`, então há um stub (`EdjiRecognitionService`); por isso o reconhecimento nunca usa o reconhecedor padrão e escolhe explicitamente o on-device ou outro serviço.
- `docs/decisions/`: ADRs. `0001`: ativação pelo botão lateral no Android. `0002`: stack React Native + Expo. `0003`: arquitetura de plugins. `0004`: agente com AI SDK e OpenRouter. `0005`: rotinas e aba Permissões (emenda a 0003 no armazenamento).
- `.github/workflows/ci.yaml`: job `test-js` (typecheck e Jest em `app/`) a cada push em qualquer branch. É reutilizável (`workflow_call`): o `release.yaml` o chama antes do build, então verificações novas entram só aqui. Jobs separados por plataforma: `test-js` hoje; testes Kotlin entram como `test-android`.
- **`main` protegida** (ruleset "Protect main" no GitHub): nada de push direto, force push ou exclusão; tudo entra por PR, sem aprovação obrigatória, e o PR só pode ser mergeado com o check `JS typecheck and tests` (o `name` do job `test-js`) passando. Renomear esse job exige atualizar o ruleset, senão o PR fica esperando um check que nunca chega. Ao adicionar jobs no CI (ex.: `test-android`), inclua-os no ruleset.
- `.github/workflows/release.yaml`: ao enviar uma tag `vX.Y.Z`, o job `version` confere se ela bate com a versão do `app/package.json` e o job `ci` roda o `ci.yaml`, em paralelo; o job `build-android` gera o projeto Android com `expo prebuild` e compila `edji-X.Y.Z.apk` (um `build-ios` entraria ao lado); o job `release` publica o APK no GitHub Releases com notas automáticas (`gh release create --generate-notes`). O APK ainda é assinado com a chave de debug do template do Expo.
- `.gitignore`: ignora dependências e artefatos de Node/Expo, Gradle/Android/Kotlin, chaves de assinatura, `.env`, IDEs e `.worktree/`. `app/.gitignore` cobre as pastas geradas `android/` e `ios/`.
- `docs/references/edji-brandbook-01.html`: brandbook interativo (abrir no navegador); preserve-o como referência e registre novas edições como arquivos novos.
- `LICENSE`: licença Apache 2.0; preserve seu conteúdo.
