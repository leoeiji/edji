# 0003: Arquitetura de plugins

- **Status:** aceita; o caminho da voz até o tool é hipótese a medir em aparelho
- **Data:** 2026-11-23
- **Relacionadas:** [0002](0002-stack-react-native-expo.md), [0004](0004-agente-com-ai-sdk-e-openrouter.md)
- **Atualização (2026-11-24):** o plugin `todo` foi removido e o agente deixou de rotear para `todo.add`; agora conversa com um modelo pelo OpenRouter, ainda sem tools. O caminho da voz ganhou streaming e cancelamento. Ver ADR 0004. O contrato de plugins segue valendo.

## Contexto

O Edji vai crescer por funcionalidades independentes: lista de tarefas agora, agenda e outras depois. Cada uma precisa expor ações para o agente (por voz) e, opcionalmente, uma tela. O usuário deve poder ligar e desligar cada uma.

## Decisão

### O que é um plugin

Um plugin é um módulo TypeScript **de primeira parte, compilado junto com o app**, em `app/src/plugins/<id>/`. Ele declara:

- **Manifesto:** `id` (ex.: `todo`), nome exibido, versão, se vem ligado por padrão.
- **Tools (opcional):** ações para o agente, com nome no namespace do plugin (`todo.add`, `todo.list`, `todo.complete`), descrição, parâmetros em JSON Schema e um handler TypeScript que devolve uma resposta curta para a sessão ("Anotado.").
- **Interface (opcional):** um componente React exibido como item da aba lateral do app.
- **Dados:** tabelas próprias no SQLite, com prefixo do plugin, e migrações versionadas.

Plugins não são baixados nem carregados em tempo de execução. Carregar código de fora traz risco de segurança e conflita com as regras da App Store; fica fora do escopo.

### Ligar e desligar

- Um plugin desligado some da aba lateral e seus tools saem do registro, então o agente não os oferece.
- **Os dados ficam.** Desligar não apaga nada; religar volta ao mesmo estado. Apagar dados é uma ação separada e explícita.
- O estado ligado/desligado fica no banco do app (`edji.db`, tabela `plugin_state`). Se nenhum plugin ligado recebe comandos de voz, o agente responde com uma mensagem clara ("Nenhum plugin ligado recebe comandos de voz.") e a sessão a mostra.

### Agente

Um registro reúne os tools dos plugins ligados. **No MVP o agente é um roteador trivial:** o texto transcrito inteiro vai para o tool padrão, `todo.add`. Escolher o tool pela frase (regras ou modelo local) fica para depois do MVP; o contrato dos tools já serve para isso.

### Caminho da voz até o tool (hipótese)

1. O gesto abre a sessão nativa, que abre o microfone sem JavaScript (~160 ms medidos na ADR 0001).
2. Em paralelo, enquanto o usuário fala, a sessão inicia um runtime JS em segundo plano (Headless JS no Android).
3. Ao fim do STT, a sessão grava o texto numa **caixa de entrada de comandos** antes de qualquer outra coisa, para o comando nunca se perder.
4. O runtime JS lê a entrada, chama o agente, executa o tool e devolve a resposta; a sessão mostra "Anotado." e vibra.
5. Se o JS não responder dentro de um prazo, a entrada fica pendente e é processada quando o app abrir. A sessão diz isso em vez de confirmar o que não aconteceu.

Ainda não se sabe se o runtime JS inicia rápido o bastante no S26 com o app fechado. É o próximo item a medir: "fim do STT → tool executado".

### Dependências nativas

Um plugin pode usar um módulo nativo (ex.: um futuro plugin de agenda acessando o calendário do sistema). O módulo é um Expo Module à parte; o contrato do plugin não muda.

### Dois bancos, sem arquivo compartilhado

O `expo-sqlite` traz a própria cópia do SQLite, e o código nativo usaria a do Android. Duas cópias do SQLite no mesmo processo não podem abrir o mesmo arquivo: as travas POSIX de uma são desfeitas pela outra e o banco pode corromper ([sqlite.org/howtocorrupt](https://www.sqlite.org/howtocorrupt.html#multiple_copies_of_sqlite_linked_into_the_same_application)). Por isso:

- **`edji-inbox.db`** é só do nativo (Android SQLite): a caixa de entrada de comandos. O JS a acessa pelas funções do módulo (`pendingCommands`, `completeCommand`).
- **`edji.db`** é só do JS (`expo-sqlite`): estado dos plugins, versões de esquema e tabelas dos plugins.

## Consequências

- A lista de tarefas é o primeiro plugin (`todo`), não o núcleo do app. O núcleo fica com: sessão de voz, caixa de entrada de comandos, registro de plugins, agente e a casca da interface (aba lateral, configurações).
- Testes do registro: tools de plugin ligado são oferecidos, de plugin desligado não; dados sobrevivem a desligar e religar.
- No iOS, App Intents rodam em Swift; executar tools TypeScript a partir do Action Button é questão em aberto para depois do MVP.
- Se o runtime JS em segundo plano for lento demais, as alternativas são: tools com uma parte nativa para os comandos de voz, ou responder "Anotado." ao gravar na caixa de entrada e executar depois.
