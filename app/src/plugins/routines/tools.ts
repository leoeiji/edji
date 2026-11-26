import { EdjiAssistant } from '../../../modules/edji-assistant';
import { describeMissing, missingPermissions, type PermissionId } from '@/core/permissions';
import type { ObjectSchema, Tool, ToolResult, ValueSchema } from '@/core/plugin';
import { describeRoutine } from './describe';
import { requiredPermissions, usesNetwork } from './requirements';
import { parseRoutineDraft } from './schema';
import { MAX_ACTIONS, type Place, type Routine } from './types';

export const TOOL_REPLIES = {
  unavailable: 'Rotinas só funcionam no app Android do Edji.',
  notFound: 'Não achei essa rotina. Liste as rotinas para ver os ids.',
  none: 'Nenhuma rotina criada.',
  noApps: 'Não achei nenhum app com esse nome.',
  noPlaces: 'Nenhum lugar salvo. Peça para salvar o lugar atual, ex.: "salva aqui como casa".',
  noDevices: 'Nenhum aparelho Bluetooth pareado.',
  noWifi: 'O celular não está num Wi-Fi agora, ou falta permissão de localização.',
  optInOff: 'Para perguntar ao agente, ligue "Rotinas podem enviar texto ao agente" nas Configurações.',
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
        textContains: s('Opcional: só notificações com este texto'),
      },
      ['kind', 'packageName', 'appLabel'],
    ),
  ],
};

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
        prompt: s('Pedido ao agente; pode usar variáveis do gatilho, como {title} e {text} de notificações'),
        reply: s('silent: só registra; notify: mostra a resposta numa notificação', { enum: ['silent', 'notify'] }),
      },
      ['kind', 'prompt', 'reply'],
    ),
  ],
};

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
>;

/** The routines tools (ADR 0005). Only the agent creates and changes routines. */
export function routineTools(backend: () => RoutinesBackend | null = () => EdjiAssistant): Tool<any>[] {
  const withBackend =
    <P>(run: (b: RoutinesBackend, params: P) => Promise<ToolResult>) =>
    async (params: P): Promise<ToolResult> => {
      const b = backend();
      if (!b) return { ok: false, reply: TOOL_REPLIES.unavailable };
      try {
        return await run(b, params);
      } catch (e) {
        // Native errors carry a short Portuguese reason (e.g. a permission is missing).
        return { ok: false, reply: e instanceof Error && e.message ? e.message : 'Algo falhou com a rotina.' };
      }
    };

  return [
    {
      name: 'routines.create',
      description:
        'Cria uma rotina que já nasce ativa: um gatilho e de 1 a ' +
        `${MAX_ACTIONS} ações em ordem. Antes, descubra pacotes com routines.find_app e aparelhos, redes ou lugares com routines.find_target.`,
      parameters: obj(
        {
          routine: obj(
            {
              name: s('Nome curto em português, ex.: "Spotify no carro"'),
              trigger: TRIGGER_SCHEMA,
              actions: { type: 'array', items: ACTION_SCHEMA, minItems: 1, maxItems: MAX_ACTIONS },
            },
            ['name', 'trigger', 'actions'],
          ),
        },
        ['routine'],
      ),
      run: withBackend<{ routine?: unknown }>(async (b, params) => {
        const places = await b.listPlaces();
        const parsed = parseRoutineDraft(params.routine, { placeIds: places.map((p) => p.id) });
        if (!parsed.ok) return { ok: false, reply: parsed.reason };
        const saved = await b.saveRoutine(parsed.draft);
        const notes = [`Rotina "${saved.name}" criada e ativa (id ${saved.id}): ${describe(saved, places)}`];
        const missing = missingFor(b, requiredPermissions(saved));
        if (missing.length) notes.push(describeMissing(missing));
        if (usesNetwork(saved) && !b.isRoutinesAgentAllowed()) notes.push(TOOL_REPLIES.optInOff);
        return { ok: true, reply: notes.join(' ') };
      }),
    },
    {
      name: 'routines.list',
      description: 'Lista as rotinas com id, nome, se está ativa e o que fazem.',
      parameters: obj({}, []),
      run: withBackend(async (b) => {
        const [routines, places] = await Promise.all([b.listRoutines(), b.listPlaces()]);
        if (routines.length === 0) return { ok: true, reply: TOOL_REPLIES.none };
        const lines = routines.map((r) => `${r.id} · ${r.name} · ${r.enabled ? 'ativa' : 'desativada'} · ${describe(r, places)}`);
        return { ok: true, reply: lines.join('\n') };
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
