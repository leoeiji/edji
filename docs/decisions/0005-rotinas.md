# 0005: Rotinas (gatilho → ações) e aba Permissões

- **Status:** aceita e implementada; comportamento em aparelho ainda não verificado
- **Data:** 2026-11-25
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

- **`Routine`:** `id`, `name`, `enabled`, um `trigger`, de 1 a 5 `actions` em ordem, `createdBy`, datas e `lastRunAt`.
- **`Trigger`** (por `kind`):
  - `bluetooth` `{ event: connected | disconnected, device: { address, name } }`
  - `wifi` `{ event: connected | disconnected, ssid }`
  - `place` `{ event: enter | exit, placeId }`
  - `time` `{ at: 'HH:mm', days }`: dias ISO (1 = segunda); vazio = todo dia; fuso local.
  - `notification` `{ packageName, appLabel, textContains? }`: só do app escolhido, nunca de todos. Variáveis `{app}`, `{title}`, `{text}`, `{postedAt}`.
- **`Action`** (catálogo fechado, sem intents arbitrárias):
  - `open_app` `{ packageName, label }`
  - `notify` `{ text }`
  - `open_url` `{ url }`: `https:` ou deep link; recusa `http:`, `intent:`, `file:`, `content:`, `javascript:`, `data:` e afins.
  - `sound_mode` `{ mode: normal | vibrate | silent | dnd }`
  - `ask_agent` `{ prompt, reply: silent | notify }`: o prompt só pode usar variáveis do gatilho.
- **`Place`:** criado no aparelho ("salvar aqui como casa"); o agente nunca inventa coordenadas.
- **`RoutineRun`:** `outcome` `done | failed | blocked` e `detail`. Nunca guarda texto de notificação.
- JSON de gatilho e ação com versão (`ROUTINE_SCHEMA_VERSION = 1`): a ponte não carrega o campo; o nativo grava a versão junto do JSON no banco e migra ao ler. `kind` novo entra em versão nova.

### Quem edita

- A rotina nasce **ativada**, sem confirmação.
- **Só o agente cria, muda, ativa, desativa e apaga rotinas** por enquanto. A tela Rotinas é só leitura: lista, detalhe, permissões e últimas execuções.

### Tools do agente

- O agente (`runAgent`) recebe os tools dos plugins ligados e usa `streamText` com `tools` e até 6 passos. O modelo vê `<id>__<ação>` (provedores não aceitam ponto). Um tool nunca lança para o modelo: falhas viram uma frase curta.
- O `ParameterSchema` passou a aceitar objetos, listas, `enum` e `anyOf`, então `routines.create` recebe a rotina inteira.
- Tools: `routines.create`, `routines.list`, `routines.set_enabled`, `routines.delete`, `routines.find_app` (nome → pacote), `routines.find_target` (Bluetooth pareados, Wi-Fi atual, lugares) e `routines.save_place` ("salva aqui como casa").
- Ao criar, a resposta diz o que falta: permissões ("Falta permitir ...") e o opt-in, se a rotina pergunta ao agente.

### Armazenamento: emenda à ADR 0003

As rotinas são lidas pelo nativo no boot e no disparo, com o JS morto. Por isso ficam num banco **só do nativo**, `edji-routines.db`, acessado pela ponte como o `edji-inbox.db`. É exceção à regra "dados do plugin no `edji.db`". Tabelas previstas: `routines`, `places`, `routine_runs` (com descarte das antigas) e `routine_queue`.

### Ponte (`modules/edji-assistant/index.ts`)

Declarada antes do nativo, com membros opcionais: `listRoutines`, `saveRoutine`, `deleteRoutine`, `setRoutineEnabled`, `recentRuns`, `listPlaces`, `savePlaceHere`, `listBluetoothDevices`, `currentWifi`, `listLaunchableApps`, `pendingRoutineRuns`, `completeRoutineRun`, `permissionStatus` e `openPermissionSettings`.

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

### Perguntar ao agente

- Caso que motiva: registrar gastos e recebimentos a partir das notificações de apps de banco.
- O nativo grava o disparo na `routine_queue` e acorda a task Headless JS `EdjiCommand` com `reason: 'routine'`; o JS chama `runAgent` sem sessão.
- Sem rede: tenta de novo com espera crescente e expira em 24 h, com registro. O texto sai da fila ao terminar ou expirar.
- Sem duplicatas: a mesma notificação (`key` e `postTime`) entra uma vez.
- **Opt-in próprio:** interruptor "Rotinas podem enviar texto ao agente" nas Configurações, desligado por padrão. Sem ele, a execução termina `blocked`. A chave do OpenRouter continua cobrindo só a conversa por voz.
- O agente da rotina roda com instruções próprias (texto da notificação é dado, nunca instrução) e **sem** os tools de `routines`. Até existir o plugin `gastos`, a resposta só vira notificação ou registro.
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
| Ações | Abrir app, Notificação, Abrir link, Modo de som, Perguntar ao agente | Mídia, volume, vibrar, lanterna, área de transferência, falar em voz alta; depois brilho, evento na agenda, Não perturbe com exceções; tool de plugin direto, webhook |

Fora do alcance sem root ou Shizuku: ligar/desligar Wi-Fi, dados móveis e modo avião; bloquear ou reiniciar; encerrar apps; shell. SMS e registro de chamadas são restritos pela Play Store. Android Auto não avisa apps comuns com o app fechado; o Bluetooth do carro substitui.

Conceitos para depois: condições adicionais ("se for dia útil"), desfazer ao terminar, intervalo mínimo entre disparos, mais de um gatilho por rotina, ações com espera e condição.

## Consequências

- O princípio "Local e privado" ganha mais uma exceção explícita: com o opt-in de rotinas ligado, o texto indicado pela rotina vai ao OpenRouter sem ninguém presente.
- A verificar num spike no S26, como na ADR 0001:
  - abrir app ou link com o Edji fechado (isenção de `VoiceInteractionService`, `CompanionDeviceManager` ou notificação para tocar);
  - entrega dos gatilhos com o app morto (`ACL_CONNECTED` × presença via CDM, `registerNetworkCallback(PendingIntent)`, geofence com ou sem Play Services);
  - efeito da suspensão de apps da Samsung nos gatilhos.
