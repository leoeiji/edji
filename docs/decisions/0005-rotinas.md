# 0005: Rotinas (gatilho → ações) e aba Permissões

- **Status:** aceita para contratos e entidades; motor nativo, monitores e tools ainda não implementados
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

### Tools do agente (a implementar)

`routines.create`, `routines.list`, `routines.delete`, `routines.set_enabled`, `routines.find_app` (nome → pacote) e `routines.find_target` (aparelhos Bluetooth pareados, Wi-Fi atual, lugares salvos). O `ParameterSchema` de hoje só tem campos planos (string, número, booleano); para criar rotinas com várias ações, ele precisa aceitar objetos e listas, ou o `create` recebe o rascunho em JSON. Fica decidido junto com o tool calling.

### Armazenamento: emenda à ADR 0003

As rotinas são lidas pelo nativo no boot e no disparo, com o JS morto. Por isso ficam num banco **só do nativo**, `edji-routines.db`, acessado pela ponte como o `edji-inbox.db`. É exceção à regra "dados do plugin no `edji.db`". Tabelas previstas: `routines`, `places`, `routine_runs` (com descarte das antigas) e `routine_queue`.

### Ponte (`modules/edji-assistant/index.ts`)

Declarada antes do nativo, com membros opcionais: `listRoutines`, `saveRoutine`, `deleteRoutine`, `setRoutineEnabled`, `recentRuns`, `listPlaces`, `savePlaceHere`, `listBluetoothDevices`, `currentWifi`, `listLaunchableApps`, `pendingRoutineRuns`, `completeRoutineRun`, `permissionStatus` e `openPermissionSettings`.

Internamente, o nativo terá `TriggerMonitor` (um por `kind`, `sync(routines)`), `ActionExecutor` (um por `kind`) e um motor que reconcilia os monitores ao salvar e no `BOOT_COMPLETED`, executa as ações e grava a execução.

### Perguntar ao agente

- Caso que motiva: registrar gastos e recebimentos a partir das notificações de apps de banco.
- O nativo grava o disparo na `routine_queue` e acorda a task Headless JS `EdjiCommand` com `reason: 'routine'`; o JS chama `runAgent` sem sessão.
- Sem rede: tenta de novo com espera crescente e expira em 24 h, com registro. O texto sai da fila ao terminar ou expirar.
- Sem duplicatas: a mesma notificação (`key` e `postTime`) entra uma vez.
- **Opt-in próprio:** interruptor "Rotinas podem enviar texto ao agente" nas Configurações, desligado por padrão. Sem ele, a execução termina `blocked`. A chave do OpenRouter continua cobrindo só a conversa por voz.
- Até existir tool calling e o plugin `gastos`, a resposta só vira notificação ou registro.

### Aba Permissões

- Catálogo em `app/src/core/permissions.ts` (do núcleo: a voz também usa), leitura e pedido em `core/devicePermissions.ts`, tela `PermissionsScreen`, destino fixo `permissions` (`edji://permissions`).
- Microfone e Assistente digital padrão saíram das Configurações para cá.
- Cada permissão é `runtime` (diálogo do sistema) ou `special` (tela das configurações do Android); `requires` ordena pré-requisitos (localização o tempo todo depois da precisa).
- Hoje só Microfone e Assistente têm status real; as demais aparecem "Em breve" até o nativo implementar `permissionStatus`.
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
- O plugin `routines` só entra em `plugins/index.ts` quando houver motor nativo.
- A verificar num spike no S26, como na ADR 0001:
  - abrir app ou link com o Edji fechado (isenção de `VoiceInteractionService`, `CompanionDeviceManager` ou notificação para tocar);
  - entrega dos gatilhos com o app morto (`ACL_CONNECTED` × presença via CDM, `registerNetworkCallback(PendingIntent)`, geofence com ou sem Play Services);
  - efeito da suspensão de apps da Samsung nos gatilhos.
