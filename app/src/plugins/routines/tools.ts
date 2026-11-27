import { EdjiAssistant } from '../../../modules/edji-assistant';
import { describeMissing, missingPermissions, type PermissionId } from '@/core/permissions';
import type { ObjectSchema, Tool, ToolResult, ValueSchema } from '@/core/plugin';
import type { PluginContext } from '@/core/plugin';
import { describeRoutine } from './describe';
import { formatWhen } from './format';
import { requiredPermissions, usesNetwork } from './requirements';
import { parseRoutineDraft, type DraftResult } from './schema';
import { MAX_ACTIONS, MAX_EXAMPLES, MAX_STEPS, type Place, type RetryResult, type Routine, type TestCaseResult } from './types';

export const TOOL_REPLIES = {
  unavailable: 'Rotinas só funcionam no app Android do Edji.',
  notFound: 'Não achei essa rotina. Liste as rotinas para ver os ids.',
  none: 'Nenhuma rotina criada.',
  noApps: 'Não achei nenhum app com esse nome.',
  noPlaces: 'Nenhum lugar salvo. Peça para salvar o lugar atual, ex.: "salva aqui como casa".',
  noDevices: 'Nenhum aparelho Bluetooth pareado.',
  noWifi: 'O celular não está num Wi-Fi agora, ou falta permissão de localização.',
  optInOff: 'Para perguntar ao agente, ligue "Rotinas podem enviar texto ao agente" nas Configurações.',
  noFailures: 'Nenhuma falha aberta.',
  failureNotFound: 'Não achei essa falha. Liste as falhas para ver os ids.',
  noSamples: 'Nenhuma notificação desse app na tela agora. Peça para deixar a notificação na tela e tente de novo.',
  nothingToTest: 'Nada para testar. Passe amostras, ids de falhas ou exemplos na rotina.',
} as const;

const s = (description: string, extra: Partial<{ enum: string[] }> = {}): ValueSchema => ({
  type: 'string',
  ...(description ? { description } : {}),
  ...extra,
});
const obj = (properties: Record<string, ValueSchema>, required: string[], description?: string): ObjectSchema => ({
  type: 'object',
  description,
  properties,
  required,
});

const TRIGGER_SCHEMA: ValueSchema = {
  description: 'Quando a rotina dispara. Use ids e endereços vindos de routines.find_target; nunca invente.',
  anyOf: [
    obj(
      {
        kind: s('bluetooth', { enum: ['bluetooth'] }),
        event: s('connected ou disconnected', { enum: ['connected', 'disconnected'] }),
        device: obj({ address: s('Endereço MAC do aparelho pareado'), name: s('Nome do aparelho') }, ['address', 'name']),
      },
      ['kind', 'event', 'device'],
    ),
    obj({ kind: s('wifi', { enum: ['wifi'] }), event: s('', { enum: ['connected', 'disconnected'] }), ssid: s('Nome da rede') }, [
      'kind',
      'event',
      'ssid',
    ]),
    obj(
      { kind: s('place', { enum: ['place'] }), event: s('enter ou exit', { enum: ['enter', 'exit'] }), placeId: s('Id de um lugar salvo') },
      ['kind', 'event', 'placeId'],
    ),
    obj(
      {
        kind: s('time', { enum: ['time'] }),
        at: s('Hora local HH:mm, ex.: 07:30'),
        days: { type: 'array', description: 'Dias ISO (1 = segunda ... 7 = domingo); vazio = todo dia', items: { type: 'integer' } },
      },
      ['kind', 'at'],
    ),
    obj(
      {
        kind: s('notification', { enum: ['notification'] }),
        packageName: s('Pacote do app, de routines.find_app'),
        appLabel: s('Nome do app'),
      },
      ['kind', 'packageName', 'appLabel'],
    ),
  ],
};

const REF_SCHEMA = obj({ ref: s('input.<saída do gatilho> ou <id da etapa>.output.<nome>') }, ['ref']);
const TEMPLATE_SCHEMA = obj({ template: s('Texto com {input.x} ou {etapa.output.y}') }, ['template']);
const TEXT_IN_SCHEMA: ValueSchema = { anyOf: [REF_SCHEMA, TEMPLATE_SCHEMA], description: 'Texto de entrada da etapa' };
const ON_NO_MATCH = s('skip: para em silêncio (ex.: propaganda); fail: vai para a fila de falhas', { enum: ['skip', 'fail'] });

const STEP_SCHEMA: ValueSchema = {
  anyOf: [
    obj(
      {
        id: s('snake_case, único'),
        kind: s('', { enum: ['match'] }),
        input: obj({ text: TEXT_IN_SCHEMA }, ['text']),
        contains: s('Segue só se o texto tiver isto (sem diferenciar maiúsculas)'),
        onNoMatch: { ...ON_NO_MATCH, description: 'Padrão skip' },
      },
      ['id', 'kind', 'input', 'contains'],
    ),
    obj(
      {
        id: s('snake_case, único'),
        kind: s('', { enum: ['extract'] }),
        input: obj({ text: TEXT_IN_SCHEMA }, ['text']),
        pattern: s('Regex RE2 (sem lookaround nem backreference). Grupos nomeados em snake_case viram <id>.output.<nome>'),
        onNoMatch: { ...ON_NO_MATCH, description: 'Padrão fail' },
      },
      ['id', 'kind', 'input', 'pattern'],
    ),
    obj(
      {
        id: s('snake_case, único'),
        kind: s('', { enum: ['number'] }),
        input: obj({ text: TEXT_IN_SCHEMA }, ['text']),
        format: s('pt-BR: 1.234,56; en-US: 1,234.56', { enum: ['pt-BR', 'en-US'] }),
      },
      ['id', 'kind', 'input', 'format'],
    ),
  ],
};

const EXAMPLE_SCHEMA = obj(
  {
    input: obj({}, [], 'Saídas do gatilho, ex.: {"notification_title": "...", "notification_message": "..."}, copiadas de um texto real'),
    skip: { type: 'boolean', description: 'true se esse texto deve ser ignorado (ex.: propaganda)' },
    outputs: obj({}, [], 'Valores esperados por referência, ex.: {"amount.output.value": 45.9}'),
  },
  ['input'],
);

const ACTION_SCHEMA: ValueSchema = {
  anyOf: [
    obj({ kind: s('', { enum: ['open_app'] }), packageName: s('Pacote, de routines.find_app'), label: s('Nome do app') }, [
      'kind',
      'packageName',
      'label',
    ]),
    obj({ kind: s('', { enum: ['notify'] }), text: s('Texto do aviso') }, ['kind', 'text']),
    obj({ kind: s('', { enum: ['open_url'] }), url: s('https:// ou deep link de app') }, ['kind', 'url']),
    obj({ kind: s('', { enum: ['sound_mode'] }), mode: s('', { enum: ['normal', 'vibrate', 'silent', 'dnd'] }) }, ['kind', 'mode']),
    obj(
      {
        kind: s('', { enum: ['ask_agent'] }),
        prompt: s('Pedido ao agente; pode usar referências, como {input.notification_message}. Usa a rede'),
        reply: s('silent: só registra; notify: mostra a resposta numa notificação', { enum: ['silent', 'notify'] }),
      },
      ['kind', 'prompt', 'reply'],
    ),
    obj(
      {
        kind: s('', { enum: ['run_tool'] }),
        tool: s('Nome do tool de plugin, ex.: finance.add. Só tools que aceitam rodar em rotina'),
        input: obj({}, [], 'Cada parâmetro do tool: literal, {"ref": ...} ou {"template": ...}'),
      },
      ['kind', 'tool', 'input'],
    ),
  ],
};

const ROUTINE_SCHEMA = obj(
  {
    name: s('Nome curto em português, ex.: "Spotify no carro"'),
    trigger: TRIGGER_SCHEMA,
    steps: { type: 'array', items: STEP_SCHEMA, maxItems: MAX_STEPS, description: 'Opcional; rodam em ordem antes das ações' },
    actions: { type: 'array', items: ACTION_SCHEMA, minItems: 1, maxItems: MAX_ACTIONS },
    examples: { type: 'array', items: EXAMPLE_SCHEMA, maxItems: MAX_EXAMPLES, description: 'Testes da rotina; todos precisam passar' },
  },
  ['name', 'trigger', 'actions'],
);

/** How routines with steps work, told once to the model in `routines.create`. */
const STEPS_GUIDE =
  'Etapas transformam o que o gatilho entrega antes das ações. Saídas do gatilho: input.<nome> ' +
  '(notificação: app_name, notification_title, notification_message, notification_id, posted_at). ' +
  'Cada etapa tem id e saídas <id>.output.<nome>; use {"ref": ...} para passar um valor e {"template": "..."} para montar texto. ' +
  'Nunca invente o formato de uma notificação: peça um exemplo real (routines.sample_notifications) e teste com routines.test antes de salvar. ' +
  'Guarde os exemplos em examples. Para registrar dados de notificação, prefira run_tool a ask_agent, e passe input.notification_id como chave de duplicata quando o tool aceitar.';

/** Everything the tools need from the device; the native module in the app, a fake in tests. */
export type RoutinesBackend = Pick<
  NonNullable<typeof EdjiAssistant>,
  | 'listRoutines'
  | 'saveRoutine'
  | 'deleteRoutine'
  | 'setRoutineEnabled'
  | 'listPlaces'
  | 'savePlaceHere'
  | 'listBluetoothDevices'
  | 'currentWifi'
  | 'listLaunchableApps'
  | 'permissionStatus'
  | 'isRoutinesAgentAllowed'
  | 'updateRoutine'
  | 'testRoutine'
  | 'activeNotifications'
  | 'listFailures'
  | 'retryFailure'
  | 'discardFailure'
>;

/** The routines tools (ADR 0005). Only the agent creates and changes routines. */
export function routineTools(backend: () => RoutinesBackend | null = () => EdjiAssistant): Tool<any>[] {
  const withBackend =
    <P>(run: (b: RoutinesBackend, params: P, ctx: PluginContext) => Promise<ToolResult>) =>
    async (params: P, ctx: PluginContext): Promise<ToolResult> => {
      const b = backend();
      if (!b) return { ok: false, reply: TOOL_REPLIES.unavailable };
      try {
        return await run(b, params, ctx);
      } catch (e) {
        // Native errors carry a short Portuguese reason (e.g. a permission is missing).
        return { ok: false, reply: e instanceof Error && e.message ? e.message : 'Algo falhou com a rotina.' };
      }
    };

  return [
    {
      name: 'routines.create',
      description:
        `Cria uma rotina que já nasce ativa: um gatilho, até ${MAX_STEPS} etapas e de 1 a ${MAX_ACTIONS} ações em ordem. ` +
        'Antes, descubra pacotes com routines.find_app e aparelhos, redes ou lugares com routines.find_target. ' +
        STEPS_GUIDE,
      parameters: obj({ routine: ROUTINE_SCHEMA }, ['routine']),
      run: withBackend<{ routine?: unknown }>(async (b, params, ctx) => {
        const { parsed, places } = await parse(b, ctx, params.routine);
        if (!parsed.ok) return { ok: false, reply: parsed.reason };
        const saved = await b.saveRoutine(parsed.draft);
        return { ok: true, reply: savedNotes(b, saved, places, `Rotina "${saved.name}" criada e ativa (id ${saved.id})`) };
      }),
    },
    {
      name: 'routines.update',
      description:
        'Troca uma rotina inteira (nome, gatilho, etapas, ações e exemplos) pelo id, mantendo se está ativa. ' +
        'Mande a rotina completa, não só o que mudou. Use para consertar uma rotina que falhou; depois reprocesse com routines.retry_failure.',
      parameters: obj({ id: s('Id da rotina'), routine: ROUTINE_SCHEMA }, ['id', 'routine']),
      run: withBackend<{ id: string; routine?: unknown }>(async (b, params, ctx) => {
        const { parsed, places } = await parse(b, ctx, params.routine);
        if (!parsed.ok) return { ok: false, reply: parsed.reason };
        const saved = await b.updateRoutine(String(params.id), parsed.draft);
        if (!saved) return { ok: false, reply: TOOL_REPLIES.notFound };
        return { ok: true, reply: savedNotes(b, saved, places, `Rotina "${saved.name}" alterada (id ${saved.id})`) };
      }),
    },
    {
      name: 'routines.test',
      description:
        'Testa uma rotina sem salvar nem executar nada, no mesmo motor das execuções reais: roda os exemplos dela, ' +
        'as amostras (saídas do gatilho) e as entradas guardadas de falhas. Mostra a saída de cada etapa e o que cada ação receberia.',
      parameters: obj(
        {
          routine: ROUTINE_SCHEMA,
          samples: { type: 'array', items: obj({}, [], 'Saídas do gatilho, ex.: {"notification_message": "..."}'), maxItems: 10 },
          failureIds: { type: 'array', items: { type: 'integer' }, description: 'Ids de routines.list_failures', maxItems: 10 },
        },
        ['routine'],
      ),
      run: withBackend<{ routine?: unknown; samples?: unknown; failureIds?: unknown }>(async (b, params, ctx) => {
        const { parsed } = await parse(b, ctx, params.routine);
        if (!parsed.ok) return { ok: false, reply: parsed.reason };
        const samples = Array.isArray(params.samples) ? params.samples.filter(isRecord).map(stringValues) : [];
        const failureIds = Array.isArray(params.failureIds) ? params.failureIds.map(Number).filter(Number.isInteger) : [];
        const results = await b.testRoutine(parsed.draft, samples, failureIds);
        if (results.length === 0) return { ok: false, reply: TOOL_REPLIES.nothingToTest };
        return { ok: results.every((r) => r.outcome !== 'fail'), reply: results.map(describeTestCase).join('\n') };
      }),
    },
    {
      name: 'routines.sample_notifications',
      description:
        'Lê as notificações de um app que estão na tela agora, como o gatilho as veria, para usar como exemplo real ao escrever etapas. Não guarda nada.',
      parameters: obj({ packageName: s('Pacote do app, de routines.find_app') }, ['packageName']),
      run: withBackend<{ packageName: string }>(async (b, { packageName }) => {
        const samples = await b.activeNotifications(String(packageName ?? ''));
        if (samples.length === 0) return { ok: true, reply: TOOL_REPLIES.noSamples };
        return { ok: true, reply: samples.map((n, i) => `${i + 1}. ${JSON.stringify(n)}`).join('\n') };
      }),
    },
    {
      name: 'routines.list',
      description: 'Lista as rotinas com id, nome, se está ativa, o que fazem e quantas falhas abertas têm.',
      parameters: obj({}, []),
      run: withBackend(async (b) => {
        const [routines, places, failures] = await Promise.all([b.listRoutines(), b.listPlaces(), b.listFailures(null)]);
        if (routines.length === 0) return { ok: true, reply: TOOL_REPLIES.none };
        const lines = routines.map((r) => {
          const open = failures.filter((f) => f.routineId === r.id).length;
          const extra = [r.steps.length ? `${r.steps.length} etapa(s)` : '', open ? `${open} falha(s) aberta(s)` : ''].filter(Boolean);
          return [r.id, r.name, r.enabled ? 'ativa' : 'desativada', describe(r, places), ...extra].join(' · ');
        });
        return { ok: true, reply: lines.join('\n') };
      }),
    },
    {
      name: 'routines.list_failures',
      description:
        'Lista as execuções que falharam e ainda não foram resolvidas, com onde e por que falharam e a entrada guardada (ex.: o texto da notificação).',
      parameters: obj({ routineId: s('Opcional: só as falhas desta rotina') }, []),
      run: withBackend<{ routineId?: string }>(async (b, { routineId }) => {
        const [failures, routines] = await Promise.all([b.listFailures(routineId ? String(routineId) : null), b.listRoutines()]);
        if (failures.length === 0) return { ok: true, reply: TOOL_REPLIES.noFailures };
        const lines = failures.slice(0, 10).map((f) => {
          const name = routines.find((r) => r.id === f.routineId)?.name ?? f.routineId;
          return `falha ${f.id} · ${name} (${f.routineId}) · ${formatWhen(f.failedAt)} · ${f.reason} · entrada: ${JSON.stringify(f.input)}`;
        });
        if (failures.length > 10) lines.push(`E mais ${failures.length - 10}.`);
        return { ok: true, reply: lines.join('\n') };
      }),
    },
    {
      name: 'routines.retry_failure',
      description: 'Roda de novo a entrada guardada de uma falha com a rotina como está agora. Use depois de consertar a rotina.',
      parameters: obj({ id: { type: 'integer', description: 'Id da falha' } }, ['id']),
      run: withBackend<{ id: number }>(async (b, { id }) => {
        const result = await b.retryFailure(Number(id));
        if (!result) return { ok: false, reply: TOOL_REPLIES.failureNotFound };
        return describeRetry(result);
      }),
    },
    {
      name: 'routines.discard_failure',
      description: 'Tira uma falha da lista sem reprocessar. Só quando o usuário pedir.',
      parameters: obj({ id: { type: 'integer', description: 'Id da falha' } }, ['id']),
      run: withBackend<{ id: number }>(async (b, { id }) => {
        if (!(await b.discardFailure(Number(id)))) return { ok: false, reply: TOOL_REPLIES.failureNotFound };
        return { ok: true, reply: 'Falha descartada.' };
      }),
    },
    {
      name: 'routines.set_enabled',
      description: 'Ativa ou desativa uma rotina pelo id.',
      parameters: obj({ id: s('Id da rotina'), enabled: { type: 'boolean' } }, ['id', 'enabled']),
      run: withBackend<{ id: string; enabled: boolean }>(async (b, { id, enabled }) => {
        if (!(await b.setRoutineEnabled(String(id), Boolean(enabled)))) return { ok: false, reply: TOOL_REPLIES.notFound };
        return { ok: true, reply: enabled ? 'Rotina ativada.' : 'Rotina desativada.' };
      }),
    },
    {
      name: 'routines.delete',
      description: 'Apaga uma rotina pelo id. Só quando o usuário pedir para apagar.',
      parameters: obj({ id: s('Id da rotina') }, ['id']),
      run: withBackend<{ id: string }>(async (b, { id }) => {
        if (!(await b.deleteRoutine(String(id)))) return { ok: false, reply: TOOL_REPLIES.notFound };
        return { ok: true, reply: 'Rotina apagada.' };
      }),
    },
    {
      name: 'routines.find_app',
      description: 'Procura apps instalados pelo nome e devolve o pacote de cada um.',
      parameters: obj({ query: s('Nome ou parte do nome, ex.: "spotify"') }, ['query']),
      run: withBackend<{ query: string }>(async (b, { query }) => {
        const apps = matchApps(await b.listLaunchableApps(), String(query ?? ''));
        if (apps.length === 0) return { ok: false, reply: TOOL_REPLIES.noApps };
        return { ok: true, reply: apps.map((a) => `${a.label} — ${a.packageName}`).join('\n') };
      }),
    },
    {
      name: 'routines.find_target',
      description: 'Lista o que pode disparar uma rotina: aparelhos Bluetooth pareados, a rede Wi-Fi atual ou os lugares salvos.',
      parameters: obj({ kind: s('', { enum: ['bluetooth', 'wifi', 'place'] }) }, ['kind']),
      run: withBackend<{ kind: string }>(async (b, { kind }) => {
        if (kind === 'bluetooth') {
          const missing = missingFor(b, ['nearby_devices']);
          if (missing.length) return { ok: false, reply: describeMissing(missing) };
          const devices = await b.listBluetoothDevices();
          if (devices.length === 0) return { ok: true, reply: TOOL_REPLIES.noDevices };
          return { ok: true, reply: devices.map((d) => `${d.name} — ${d.address}`).join('\n') };
        }
        if (kind === 'wifi') {
          const wifi = await b.currentWifi();
          return wifi ? { ok: true, reply: `Wi-Fi atual: ${wifi.ssid}` } : { ok: false, reply: TOOL_REPLIES.noWifi };
        }
        const places = await b.listPlaces();
        if (places.length === 0) return { ok: true, reply: TOOL_REPLIES.noPlaces };
        return { ok: true, reply: places.map((p) => `${p.name} — ${p.id}`).join('\n') };
      }),
    },
    {
      name: 'routines.save_place',
      description: 'Salva o lugar onde o celular está agora com um nome, ex.: "casa". Use quando o usuário disser "salva aqui como ...".',
      parameters: obj({ name: s('Nome do lugar') }, ['name']),
      run: withBackend<{ name: string }>(async (b, { name }) => {
        const missing = missingFor(b, ['fine_location']);
        if (missing.length) return { ok: false, reply: describeMissing(missing) };
        const place = await b.savePlaceHere(String(name ?? '').trim() || 'Lugar');
        return { ok: true, reply: `Lugar "${place.name}" salvo (id ${place.id}).` };
      }),
    },
  ];
}

/** Validates a draft with the saved places and the tools of the enabled plugins. */
async function parse(b: RoutinesBackend, ctx: PluginContext, routine: unknown): Promise<{ parsed: DraftResult; places: Place[] }> {
  const [places, tools] = await Promise.all([b.listPlaces(), ctx.enabledTools()]);
  return { parsed: parseRoutineDraft(routine, { placeIds: places.map((p) => p.id), tools }), places };
}

/** The reply after saving: what the routine does, plus missing permissions and opt-in. */
function savedNotes(b: RoutinesBackend, saved: Routine, places: Place[], headline: string): string {
  const notes = [`${headline}: ${describe(saved, places)}`];
  const missing = missingFor(b, requiredPermissions(saved));
  if (missing.length) notes.push(describeMissing(missing));
  if (usesNetwork(saved) && !b.isRoutinesAgentAllowed()) notes.push(TOOL_REPLIES.optInOff);
  return notes.join(' ');
}

/** One line per dry-run case, for the model to read. */
export function describeTestCase(r: TestCaseResult): string {
  if (r.outcome === 'skip') return `${r.label}: ignorado na etapa ${r.step}`;
  if (r.outcome === 'fail') return `${r.label}: FALHOU — ${r.reason}`;
  const values = Object.entries(r.values).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
  const actions = r.actions.map((a) => {
    if (a.kind === 'run_tool') return `${a.tool}(${JSON.stringify(a.input)})`;
    if (a.kind === 'notify') return `avisar ${JSON.stringify(a.text)}`;
    if (a.kind === 'ask_agent') return `perguntar ${JSON.stringify(a.prompt)}`;
    return a.kind;
  });
  return `${r.label}: passou · ${[...values, ...actions].join(' · ')}`;
}

export function describeRetry(r: RetryResult): ToolResult {
  switch (r.outcome) {
    case 'done':
      return { ok: true, reply: `Reprocessada: ${r.detail}.` };
    case 'skipped':
      return { ok: true, reply: 'A rotina agora ignora essa entrada de propósito. A falha saiu da lista.' };
    case 'blocked':
      return { ok: false, reply: `Bloqueada: ${r.detail}.` };
    case 'failed':
      return { ok: false, reply: `Ainda falha: ${r.detail} A falha voltou para a lista.` };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringValues(o: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v : String(v ?? '')]));
}

function describe(r: Pick<Routine, 'trigger' | 'actions'>, places: Place[]): string {
  return describeRoutine(r, { placeName: (id) => places.find((p) => p.id === id)?.name });
}

function missingFor(b: RoutinesBackend, ids: PermissionId[]): PermissionId[] {
  return missingPermissions(ids, b.permissionStatus(ids));
}

/** Apps whose label contains [query], ignoring case and accents; exact matches first, at most 8. */
export function matchApps<T extends { label: string }>(apps: T[], query: string): T[] {
  const q = fold(query);
  if (!q) return [];
  return apps
    .filter((a) => fold(a.label).includes(q))
    .sort((a, b) => Number(fold(b.label) === q) - Number(fold(a.label) === q) || a.label.localeCompare(b.label))
    .slice(0, 8);
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
