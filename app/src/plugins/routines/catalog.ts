import type { PermissionId } from '@/core/permissions';
import { actionPermissions, triggerPermissions } from './requirements';
import type { Action, ActionKind, Trigger, TriggerKind } from './types';

/** One trigger or action the agent can use in a routine, described for the catalog screen. */
export type CatalogEntry<K extends string> = {
  kind: K;
  title: string;
  /** What it does, in one short Portuguese sentence. */
  summary: string;
  /** Every permission it can need, trigger or action options included, without repeats. */
  permissions: PermissionId[];
  /** Extra caveat, e.g. an opt-in. */
  note?: string;
};

export type TriggerEntry = CatalogEntry<TriggerKind>;

export type ActionEntry = CatalogEntry<ActionKind>;

const SAMPLE_DEVICE = { address: '00:00:00:00:00:00', name: 'x' };

/** One sample per option that changes the permissions, so the catalog never drifts from `requirements.ts`. */
const TRIGGER_SAMPLES: Record<TriggerKind, Trigger> = {
  bluetooth: { kind: 'bluetooth', event: 'connected', device: SAMPLE_DEVICE },
  wifi: { kind: 'wifi', event: 'connected', ssid: 'x' },
  place: { kind: 'place', event: 'enter', placeId: 'x' },
  time: { kind: 'time', at: '08:00', days: [] },
  notification: { kind: 'notification', packageName: 'x', appLabel: 'x' },
};

const ACTION_SAMPLES: Record<ActionKind, Action[]> = {
  open_app: [{ kind: 'open_app', packageName: 'x', label: 'x' }],
  notify: [{ kind: 'notify', text: 'x' }],
  open_url: [{ kind: 'open_url', url: 'https://x.y' }],
  sound_mode: (['normal', 'vibrate', 'silent', 'dnd'] as const).map((mode) => ({ kind: 'sound_mode', mode })),
  ask_agent: [
    { kind: 'ask_agent', prompt: 'x', reply: 'silent' },
    { kind: 'ask_agent', prompt: 'x', reply: 'notify' },
  ],
};

const unique = (ids: PermissionId[]) => [...new Set(ids)];

function trigger(entry: Omit<TriggerEntry, 'permissions'>): TriggerEntry {
  return { ...entry, permissions: unique(triggerPermissions(TRIGGER_SAMPLES[entry.kind])) };
}

function action(entry: Omit<ActionEntry, 'permissions'>): ActionEntry {
  return { ...entry, permissions: unique(ACTION_SAMPLES[entry.kind].flatMap(actionPermissions)) };
}

/** Triggers in the order the catalog shows them. */
export const TRIGGER_CATALOG: TriggerEntry[] = [
  trigger({
    kind: 'bluetooth',
    title: 'Bluetooth',
    summary: 'Ao conectar ou desconectar de um aparelho, como o carro ou o fone.',
  }),
  trigger({
    kind: 'wifi',
    title: 'Wi-Fi',
    summary: 'Ao conectar ou sair de uma rede Wi-Fi pelo nome.',
  }),
  trigger({
    kind: 'place',
    title: 'Lugar',
    summary: 'Ao chegar ou sair de um lugar salvo no aparelho.',
    note: 'O lugar é salvo no aparelho; o agente não inventa coordenadas.',
  }),
  trigger({
    kind: 'time',
    title: 'Horário',
    summary: 'Em um horário, todo dia ou só em alguns dias da semana.',
  }),
  trigger({
    kind: 'notification',
    title: 'Notificação',
    summary: 'Quando um app específico posta uma notificação, com filtro opcional de texto.',
    note: 'O texto da notificação fica no aparelho; só sai pela ação “Perguntar ao agente”.',
  }),
];

/** Actions in the order the catalog shows them. */
export const ACTION_CATALOG: ActionEntry[] = [
  action({ kind: 'open_app', title: 'Abrir app', summary: 'Abre um app instalado.' }),
  action({ kind: 'open_url', title: 'Abrir link', summary: 'Abre um link https ou o link de um app.' }),
  action({ kind: 'notify', title: 'Notificação', summary: 'Mostra um aviso com o texto que você escolher.' }),
  action({
    kind: 'sound_mode',
    title: 'Modo de som',
    summary: 'Muda para normal, vibrar, silencioso ou Não perturbe.',
    note: 'Normal e vibrar não pedem permissão; silencioso e Não perturbe pedem acesso ao Não perturbe.',
  }),
  action({
    kind: 'ask_agent',
    title: 'Perguntar ao agente',
    summary: 'Manda um texto ao agente sem ninguém presente e, se quiser, avisa a resposta.',
    note: 'Única ação que usa a rede. Só roda com a opção de rotinas com agente ligada em Configurações.',
  }),
];
