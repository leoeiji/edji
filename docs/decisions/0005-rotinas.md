# 0005: Rotinas (gatilho → ações) e aba Permissões

- **Status:** aceita e implementada; comportamento em aparelho ainda não verificado
- **Data:** 2026-11-25; emendada em 2026-11-26 (schema 2: etapas, referências, `run_tool`, exemplos e fila de falhas)
- **Relacionadas:** [0001](0001-ativacao-pelo-botao-lateral-android.md), [0003](0003-arquitetura-de-plugins.md) (emendada aqui), [0004](0004-agente-com-ai-sdk-e-openrouter.md)

## Contexto

Queremos que o agente crie rotinas por voz, como "quando eu entrar no carro, abre o Spotify", "quando eu chegar em casa, coloca o som no normal" ou "quando chegar notificação do banco, registra o gasto". A rotina precisa disparar com o Edji fechado.

Pesquisa de ferramentas prontas (novembro de 2026):

- **OpenTasker** ([repo](https://github.com/SysAdminDoc/OpenTasker), MIT, v0.2.x, um mantenedor): a [API externa](https://github.com/SysAdminDoc/OpenTasker/blob/master/docs/EXTERNAL_INTENTS.md) só roda tarefas que já existem e exige permissão de assinatura. Outro app não cria perfis; a importação de JSON é manual e revisada.
- **Tasker:** proprietário; a importação também pede confirmação.
- **Automation** ([F-Droid](https://f-droid.org/packages/com.jens.automation2), GPL-3.0) e **Easer** (descontinuado): sem API.
- **Kotlin:** nenhuma biblioteca embutível que una gatilhos e regras. Só peças, como uma lib KMP de geofence e o app [android-rules](https://github.com/rafeehcp/android-rules).

## Alternativas

- **Integrar Tasker ou OpenTasker:** nenhum deixa outro app criar regras sem revisão manual. Descartado.
- **Fork do OpenTasker:** muito código, releases que quebram a atualização. Descartado.
- **Motor próprio:** controle total, local, no padrão da caixa de entrada. Os monitores do OpenTasker (Bluetooth, Wi-Fi, geofence sem Play Services) podem ser copiados com atribuição, porque é MIT; o Automation é GPL e não pode. Escolhido.

## Decisão

### Entidades

Tipos em `app/src/plugins/routines/types.ts`; validação em `schema.ts` (`parseRoutineDraft`, nunca lança, motivo curto em português); frase em `describe.ts` (`describeRoutine`: "Ao conectar em Carro, abrir Spotify."); permissões por rotina em `requirements.ts`. O nativo valida de novo e é a fonte da verdade.

- **`Routine`:** `id`, `name`, `enabled`, um `trigger`, até 5 `steps` (etapas, ver abaixo), de 1 a 5 `actions` em ordem, até 10 `examples`, `createdBy`, datas e `lastRunAt`.
- **`Trigger`** (por `kind`):
  - `bluetooth` `{ event: connected | disconnected, device: { address, name } }`
  - `wifi` `{ event: connected | disconnected, ssid }`
  - `place` `{ event: enter | exit, placeId }`
  - `time` `{ at: 'HH:mm', days }`: dias ISO (1 = segunda); vazio = todo dia; fuso local.
  - `notification` `{ packageName, appLabel }`: só do app escolhido, nunca de todos. O filtro por texto virou a etapa `match` (o `textContains` do schema 1 migra sozinho).
- **`Action`** (catálogo fechado, sem intents arbitrárias):
  - `open_app` `{ packageName, label }`
  - `notify` `{ text }`: texto com referências, ex.: `"Gasto de {valor.output.value}"`.
  - `open_url` `{ url }`: `https:` ou deep link; recusa `http:`, `intent:`, `file:`, `content:`, `javascript:`, `data:` e afins.
  - `sound_mode` `{ mode: normal | vibrate | silent | dnd }`
  - `ask_agent` `{ prompt, reply: silent | notify }`: o prompt pode usar referências.
  - `run_tool` `{ tool, input }`: chama um tool de plugin marcado como ação de rotina (`routineAction`), sem modelo e sem rede. `input` mapeia cada parâmetro a um valor (abaixo).
- **`Place`:** criado no aparelho ("salvar aqui como casa"); o agente nunca inventa coordenadas.
- **`RoutineRun`:** `outcome` `done | failed | blocked` e `detail` curto. O texto do gatilho não vai para o registro de execuções; ele só fica na fila de falhas (abaixo) e nos exemplos.
- JSON de gatilho, etapas, ações e exemplos com versão (`ROUTINE_SCHEMA_VERSION = 2`): a ponte não carrega o campo; o nativo grava a versão junto do JSON no banco e migra ao ler. `kind` novo entra em versão nova. Do 1 para o 2: `textContains` vira uma etapa `match` com id `filter`, e as variáveis `{app}`, `{title}`, `{text}`, `{postedAt}`, `{device}`, `{ssid}`, `{place}` e `{time}` viram referências `{input.*}`.

### Etapas e referências (schema 2)

Entre o gatilho e as ações, a rotina pode ter até 5 **etapas** que transformam o que o gatilho entregou. Nenhum padrão vem embutido no app: quem escreve as etapas é o agente, a partir de exemplos que o usuário dá ao Edji.

- **Saídas do gatilho** (`input.*`, sempre texto):
  - `bluetooth`: `input.device_name`, `input.device_address`;
  - `wifi`: `input.ssid`; `place`: `input.place_name`; `time`: `input.time`;
  - `notification`: `input.app_name`, `input.notification_title`, `input.notification_message`, `input.posted_at` (ISO 8601) e `input.notification_id` (`key|postTime`, único por notificação; serve de chave de duplicata para o tool).
- **Etapa:** `{ id, kind, input: { text }, ... }`. O `id` é `snake_case`, único, e não pode ser `input`. A ordem da lista é a de execução; uma etapa só referencia `input.*` e etapas anteriores, então não há ciclos.
  - `match` `{ contains, onNoMatch = skip }`: segue só se o texto contém `contains` (sem diferenciar maiúsculas). Sem saída.
  - `extract` `{ pattern, onNoMatch = fail }`: regex (RE2, ver abaixo) procurada no texto; cada grupo nomeado `(?<nome>...)` vira `<id>.output.<nome>` (texto; vazio se o grupo não participou).
  - `number` `{ format: pt-BR | en-US }`: converte "1.234,56" (ou "R$ -45,90") em número: `<id>.output.value`. Texto inválido sempre falha.
- **`onNoMatch`:** `skip` encerra a rotina em silêncio, sem registro (ex.: notificação de propaganda do banco); `fail` manda para a fila de falhas. Sem essa separação, a fila enche de ruído.
- **Valores** (entrada de etapas e de `run_tool`): literal (`"out"`, `12`, `true`), referência `{ "ref": "extract_from_message.output.value" }` ou modelo `{ "template": "Compra em {extract_from_message.output.merchant}" }`. Referência é objeto, não string com sintaxe especial, para um literal com ponto nunca virar referência. Referência inteira preserva o tipo (número continua número); modelo é sempre texto.
- **Validação ao salvar** (TS e de novo no Kotlin): ids, referências existentes e anteriores, grupos nomeados, limites de tamanho. Só o TS conhece os tools: confere se o tool existe, está ligado, é `routineAction` e se cada parâmetro bate com o JSON Schema (obrigatórios, tipos, `enum`, nada a mais). O nativo compila a regex e é a autoridade sobre ela; o TS nunca valida padrão com `RegExp`.
- **Regex:** [RE2J](https://github.com/google/re2j) 1.8 no Kotlin. O `java.util.regex` do Android usa ICU, passa o texto inteiro ao código nativo e não aceita tempo limite, então uma regex escrita por modelo sobre texto de terceiros arriscaria ReDoS. O RE2 roda em tempo linear e é o mesmo motor na JVM dos testes e no aparelho. Custo: sem lookaround nem backreference, que extração não precisa. Grupos aceitam `(?<nome>...)` e `(?P<nome>...)`; nomes em `snake_case`.

### Exemplos e teste sob demanda

- **`examples`** (até 10): `{ input, skip?, outputs? }`. `input` são saídas do gatilho (ex.: `notification_message`); `skip: true` diz que aquele texto deve ser ignorado; `outputs` fixa valores esperados (`{ "valor.output.value": 45.9 }`). Ao salvar ou atualizar, o nativo roda todos e recusa a rotina se algum quebrar. São os testes da rotina.
- Os exemplos vêm do usuário, no aparelho: a notificação que acabou de chegar (`routines.sample_notifications`, que lê as notificações **ativas** do app, sem gravar) ou uma falha da fila. Ditar "R$ 1.234,56" por voz não sobrevive ao STT.
- **`routines.test`** roda um rascunho de rotina no motor nativo sobre exemplos, amostras e falhas, sem salvar, e devolve a saída de cada etapa e os argumentos finais de cada ação, ou a etapa que falhou e por quê. O agente itera até passar.

### Quem edita

- A rotina nasce **ativada**, sem confirmação.
- **Só o agente cria, muda, ativa, desativa e apaga rotinas** por enquanto. A tela Rotinas é só leitura: lista, detalhe, permissões e últimas execuções.

### Tools do agente

- O agente (`runAgent`) recebe os tools dos plugins ligados e usa `streamText` com `tools` e até 6 passos. O modelo vê `<id>__<ação>` (provedores não aceitam ponto). Um tool nunca lança para o modelo: falhas viram uma frase curta.
- O `ParameterSchema` passou a aceitar objetos, listas, `enum` e `anyOf`, então `routines.create` recebe a rotina inteira.
- Tools: `routines.create`, `routines.update` (troca nome, gatilho, etapas, ações e exemplos de uma rotina existente), `routines.list`, `routines.set_enabled`, `routines.delete`, `routines.find_app` (nome → pacote), `routines.find_target` (Bluetooth pareados, Wi-Fi atual, lugares), `routines.save_place` ("salva aqui como casa"), `routines.sample_notifications`, `routines.test`, `routines.list_failures`, `routines.retry_failure` e `routines.discard_failure`.
- Tools de plugin viram ação de rotina com `routineAction: true` no `Tool`. Só tools locais (sem rede) podem ser marcados; os de `routines` nunca.
- Ao criar, a resposta diz o que falta: permissões ("Falta permitir ...") e o opt-in, se a rotina pergunta ao agente.

### Armazenamento: emenda à ADR 0003

As rotinas são lidas pelo nativo no boot e no disparo, com o JS morto. Por isso ficam num banco **só do nativo**, `edji-routines.db`, acessado pela ponte como o `edji-inbox.db`. É exceção à regra "dados do plugin no `edji.db`". Tabelas: `routines` (com `steps_json` e `examples_json` desde a versão 2 do banco), `places`, `routine_runs` (com descarte das antigas), `routine_queue` (com `kind`: `ask_agent` ou `run_tool`) e `routine_failures`. Migração do banco 1 → 2 só com `ALTER TABLE ... ADD COLUMN` e `CREATE TABLE`, nunca apagando.

### Ponte (`modules/edji-assistant/index.ts`)

Declarada antes do nativo, com membros opcionais: `listRoutines`, `saveRoutine`, `updateRoutine`, `deleteRoutine`, `setRoutineEnabled`, `recentRuns`, `testRoutine`, `activeNotifications`, `listFailures`, `retryFailure`, `discardFailure`, `listPlaces`, `savePlaceHere`, `listBluetoothDevices`, `currentWifi`, `listLaunchableApps`, `pendingRoutineRuns`, `completeRoutineRun`, `permissionStatus` e `openPermissionSettings`.

Mais `isRoutinesAgentAllowed`/`setRoutinesAgentAllowed` (opt-in, em `SharedPreferences` do nativo, que precisa lê-lo no disparo) e `syncRoutines`.

### Motor nativo

- `RoutineEngine.sync` registra no Android o que as rotinas ativas escutam; roda ao salvar, ativar, apagar, ao abrir o app, ao voltar das permissões e em boot, atualização, fuso e hora.
- **Bluetooth:** `ACL_CONNECTED`/`ACL_DISCONNECTED` num receiver do manifesto (chegam com o app fechado); casa pelo endereço.
- **Wi-Fi:** `registerNetworkCallback` com `PendingIntent` para Wi-Fi e celular; compara o SSID atual (exige localização) com o último visto e dispara saída e entrada.
- **Lugar:** `LocationManager.addProximityAlert`, sem Play Services; refeito após o boot.
- **Horário:** `AlarmManager` exato quando permitido, senão inexato; reagenda a cada disparo.
- **Notificação:** `NotificationListenerService`; ignora as do próprio Edji, resumos de grupo e contínuas; sem duplicatas por `key` e `postTime`.
- Intervalo mínimo de 30 s entre disparos da mesma rotina (Bluetooth e Wi-Fi oscilam), exceto notificações.
- **Abrir app/link:** abre direto quando o Edji é o assistente padrão ou pode aparecer sobre outros apps (hipótese de isenção do Android); senão posta uma notificação "Toque para abrir ...", que some em 2 min. O status "Abrir apps em segundo plano" segue a mesma regra.
- Receivers: `RoutineTriggerReceiver` é exportado, mas só para broadcasts protegidos do sistema; alarmes, proximidade, rede e fila vão ao `RoutineInternalReceiver`, não exportado.

### Execução

- O motor roda as etapas (`RoutinePipeline`, Kotlin puro, sem `Context`, coberto por testes JVM) e só depois as ações, com as referências resolvidas. Etapa com `skip`: nada roda e nada é registrado. Etapa com `fail`: execução `failed` e entrada na fila de falhas.
- **`run_tool`:** o nativo resolve os argumentos e põe na `routine_queue` (`kind = run_tool`), junto com as saídas do gatilho; acorda a task Headless JS. O JS confere de novo se o tool existe, se o plugin está ligado e se ainda é `routineAction` (senão `blocked`) e chama o handler. Não usa o modelo nem a rede, então não precisa do opt-in. No registro de execuções, sucesso vira `<tool>: feito` (a resposta do tool pode citar a notificação); falha guarda o motivo curto do tool.
- O agente da conversa por voz pode dar até 10 passos por turno (`MAX_STEPS`): criar uma rotina a partir de uma notificação usa `find_app`, `sample_notifications`, um ou dois `test`, `create` e a resposta.
- A chave de duplicata da fila inclui o índice da ação, para duas ações da mesma rotina não se anularem.

### Fila de falhas

- Toda execução `failed` (etapa, ação nativa, `run_tool` recusado ou `ask_agent` expirado) vira uma linha em `routine_failures`: rotina, quando, onde (id da etapa ou número da ação), motivo curto e **as saídas do gatilho** (ex.: o texto da notificação). Assim nenhum gasto se perde quando o banco muda o texto.
- Avisa com uma notificação por rotina (atualizada, não repetida): "Rotina X falhou: motivo. Peça ao Edji para corrigir." Tocar abre a tela Rotinas (`edji://routines`).
- O conserto é por voz: o agente lê a falha (`routines.list_failures`), ajusta a rotina, testa com a falha e com os exemplos (`routines.test`), salva (`routines.update`) e reprocessa (`routines.retry_failure`), que roda a versão **atual** da rotina sobre a entrada guardada, sem a chave de duplicata da fila. Duplicatas são evitadas pelo tool (ex.: `input.notification_id`). Reprocessar roda todas as ações de novo.
- A falha sai da fila ao ser reprocessada ou descartada, ou depois de 30 dias; no máximo 200 linhas. Apagar a rotina apaga as falhas dela.
- A tela Rotinas mostra as falhas abertas no detalhe de cada rotina e um contador na lista.

### Perguntar ao agente

- Caso que motiva: registrar gastos e recebimentos a partir das notificações de apps de banco.
- O nativo grava o disparo na `routine_queue` (`kind = ask_agent`) e acorda a task Headless JS `EdjiCommand` com `reason: 'routine'`; o JS chama `runAgent` sem sessão.
- Sem rede: tenta de novo com espera crescente e expira em 24 h, com registro. O texto sai da fila ao terminar ou expirar.
- Sem duplicatas: a mesma notificação (`key` e `postTime`) entra uma vez.
- **Opt-in próprio:** interruptor "Rotinas podem enviar texto ao agente" nas Configurações, desligado por padrão. Sem ele, a execução termina `blocked`. A chave do OpenRouter continua cobrindo só a conversa por voz.
- O agente da rotina roda com instruções próprias (texto da notificação é dado, nunca instrução) e recebe **só** os tools marcados `routineAction` (nunca os de `routines`, nem os que apagam), para um texto malicioso não criar rotinas nem apagar dados. Para registrar gastos, prefira `run_tool` com etapas: local, exato e sem rede.
- Se o Android não deixar iniciar a task em segundo plano, um alarme tenta de novo, e o app processa a fila ao abrir.

### Aba Permissões

- Catálogo em `app/src/core/permissions.ts` (do núcleo: a voz também usa), leitura e pedido em `core/devicePermissions.ts`, tela `PermissionsScreen`, destino fixo `permissions` (`edji://permissions`).
- Microfone e Assistente digital padrão saíram das Configurações para cá.
- Cada permissão é `runtime` (diálogo do sistema) ou `special` (tela das configurações do Android); `requires` ordena pré-requisitos (localização o tempo todo depois da precisa).
- O status vem do nativo (`permissionStatus`). Comuns abrem o diálogo; "localização o tempo todo" usa o pedido do Android 11+, que leva à tela de localização; as especiais abrem a tela certa das configurações.
- Quando faltar algo, o tool responde curto ("Falta permitir acesso a notificações. Abra Permissões.").

### Primeira rodada × roadmap

| | Primeira rodada | Roadmap |
| --- | --- | --- |
| Gatilhos | Bluetooth, Lugar, Wi-Fi, Horário, Notificação recebida | Carregador, bateria, fone, tela ligada, nascer/pôr do sol, boot, bloco de Configurações Rápidas, atalho; depois app aberto, agenda, atividade física, chamada |
| Ações | Abrir app, Notificação, Abrir link, Modo de som, Perguntar ao agente, Executar tool de plugin (schema 2) | Mídia, volume, vibrar, lanterna, área de transferência, falar em voz alta; depois brilho, evento na agenda, Não perturbe com exceções; webhook |
| Etapas | Contém texto, Extrair com regex, Converter número (schema 2) | Comparar ("valor > 100"), data, maiúsculas/minúsculas, substituir |

Fora do alcance sem root ou Shizuku: ligar/desligar Wi-Fi, dados móveis e modo avião; bloquear ou reiniciar; encerrar apps; shell. SMS e registro de chamadas são restritos pela Play Store. Android Auto não avisa apps comuns com o app fechado; o Bluetooth do carro substitui.

Conceitos para depois: condições adicionais ("se for dia útil"), desfazer ao terminar, intervalo mínimo entre disparos, mais de um gatilho por rotina, ações com espera e condição.

## Consequências

- O princípio "Local e privado" ganha mais uma exceção explícita: com o opt-in de rotinas ligado, o texto indicado pela rotina vai ao OpenRouter sem ninguém presente.
- **Notificações ficam guardadas no aparelho** em dois casos: na fila de falhas (até 30 dias ou até resolver) e nos exemplos da rotina (até apagar a rotina). Nunca saem sozinhas; vão ao OpenRouter só quando o usuário pede ao agente, na conversa por voz, para ver, testar ou consertar uma rotina, coberto pelo opt-in da chave.
- Uma regex escrita pelo modelo quebra quando o app muda o texto. Isso é aceito: a fila de falhas guarda a entrada, avisa e permite reprocessar depois do conserto.
- A verificar num spike no S26, como na ADR 0001:
  - abrir app ou link com o Edji fechado (isenção de `VoiceInteractionService`, `CompanionDeviceManager` ou notificação para tocar);
  - entrega dos gatilhos com o app morto (`ACL_CONNECTED` × presença via CDM, `registerNetworkCallback(PendingIntent)`, geofence com ou sem Play Services);
  - efeito da suspensão de apps da Samsung nos gatilhos.
