import {
  MAX_ACTIONS,
  TRIGGER_VARIABLES,
  type Action,
  type RoutineDraft,
  type SoundMode,
  type Trigger,
  type Weekday,
} from './types';

/** What the validator needs to know about the device. */
export type DraftContext = { placeIds: string[] };

export type DraftResult = { ok: true; draft: RoutineDraft } | { ok: false; reason: string };

export const MAX_NAME_LENGTH = 60;
export const MAX_NOTIFY_LENGTH = 200;
export const MAX_PROMPT_LENGTH = 500;
const MAX_SSID_LENGTH = 32;
const MAX_FILTER_LENGTH = 100;

/** Short Portuguese reasons, read back to the user by the voice session. */
export const DRAFT_ERRORS = {
  notObject: 'Não entendi a rotina.',
  noName: 'A rotina precisa de um nome.',
  longName: 'O nome da rotina é longo demais.',
  unknownTrigger: 'Não conheço esse tipo de gatilho.',
  badEvent: 'Não entendi quando a rotina deve disparar.',
  badDevice: 'Não reconheci o aparelho Bluetooth.',
  noSsid: 'Falta o nome da rede Wi-Fi.',
  unknownPlace: 'Não conheço esse lugar. Salve o lugar antes.',
  badTime: 'Horário inválido. Use horas e minutos, como 07:30.',
  badDays: 'Não entendi os dias da semana.',
  noApp: 'Falta o app.',
  longFilter: 'O filtro da notificação é longo demais.',
  noActions: 'A rotina precisa de pelo menos uma ação.',
  tooManyActions: `Uma rotina pode ter no máximo ${MAX_ACTIONS} ações.`,
  unknownAction: 'Não conheço esse tipo de ação.',
  noText: 'Falta o texto do aviso.',
  longText: 'O texto do aviso é longo demais.',
  badUrl: 'Esse link não pode ser aberto por uma rotina.',
  badSoundMode: 'Não conheço esse modo de som.',
  noPrompt: 'Falta o pedido para o agente.',
  longPrompt: 'O pedido para o agente é longo demais.',
  badReply: 'Não entendi o que fazer com a resposta do agente.',
} as const;

/** Schemes a routine may never open: they reach files, other apps' internals or run code. */
const BLOCKED_SCHEMES = new Set(['http', 'intent', 'file', 'content', 'javascript', 'data', 'about', 'android-app', 'blob']);
const SOUND_MODES: SoundMode[] = ['normal', 'vibrate', 'silent', 'dnd'];

class DraftError extends Error {}

/**
 * Checks and normalizes a routine proposed by the agent: trims text, keeps
 * only known fields, sorts the weekdays. Never throws; the reason is a short
 * Portuguese sentence the session can show.
 */
export function parseRoutineDraft(input: unknown, ctx: DraftContext): DraftResult {
  try {
    if (!isRecord(input)) throw new DraftError(DRAFT_ERRORS.notObject);
    const name = text(input.name, MAX_NAME_LENGTH, DRAFT_ERRORS.noName, DRAFT_ERRORS.longName);
    const trigger = parseTrigger(input.trigger, ctx);
    if (!Array.isArray(input.actions) || input.actions.length === 0) throw new DraftError(DRAFT_ERRORS.noActions);
    if (input.actions.length > MAX_ACTIONS) throw new DraftError(DRAFT_ERRORS.tooManyActions);
    const actions = input.actions.map((a) => parseAction(a, trigger));
    return { ok: true, draft: { name, trigger, actions } };
  } catch (e) {
    if (e instanceof DraftError) return { ok: false, reason: e.message };
    throw e;
  }
}

function parseTrigger(input: unknown, ctx: DraftContext): Trigger {
  if (!isRecord(input)) throw new DraftError(DRAFT_ERRORS.unknownTrigger);
  switch (input.kind) {
    case 'bluetooth': {
      const event = oneOf(input.event, ['connected', 'disconnected'] as const, DRAFT_ERRORS.badEvent);
      if (!isRecord(input.device)) throw new DraftError(DRAFT_ERRORS.badDevice);
      const address = typeof input.device.address === 'string' ? input.device.address.trim().toUpperCase() : '';
      if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(address)) throw new DraftError(DRAFT_ERRORS.badDevice);
      const name = text(input.device.name, MAX_NAME_LENGTH, DRAFT_ERRORS.badDevice, DRAFT_ERRORS.badDevice);
      return { kind: 'bluetooth', event, device: { address, name } };
    }
    case 'wifi': {
      const event = oneOf(input.event, ['connected', 'disconnected'] as const, DRAFT_ERRORS.badEvent);
      return { kind: 'wifi', event, ssid: text(input.ssid, MAX_SSID_LENGTH, DRAFT_ERRORS.noSsid, DRAFT_ERRORS.noSsid) };
    }
    case 'place': {
      const event = oneOf(input.event, ['enter', 'exit'] as const, DRAFT_ERRORS.badEvent);
      const placeId = typeof input.placeId === 'string' ? input.placeId : '';
      if (!ctx.placeIds.includes(placeId)) throw new DraftError(DRAFT_ERRORS.unknownPlace);
      return { kind: 'place', event, placeId };
    }
    case 'time': {
      const at = typeof input.at === 'string' ? input.at.trim() : '';
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new DraftError(DRAFT_ERRORS.badTime);
      return { kind: 'time', at, days: parseDays(input.days) };
    }
    case 'notification': {
      const packageName = packageNameOf(input.packageName);
      const appLabel = text(input.appLabel, MAX_NAME_LENGTH, DRAFT_ERRORS.noApp, DRAFT_ERRORS.noApp);
      const trigger: Extract<Trigger, { kind: 'notification' }> = { kind: 'notification', packageName, appLabel };
      if (input.textContains !== undefined && input.textContains !== null && input.textContains !== '') {
        trigger.textContains = text(input.textContains, MAX_FILTER_LENGTH, DRAFT_ERRORS.longFilter, DRAFT_ERRORS.longFilter);
      }
      return trigger;
    }
    default:
      throw new DraftError(DRAFT_ERRORS.unknownTrigger);
  }
}

function parseAction(input: unknown, trigger: Trigger): Action {
  if (!isRecord(input)) throw new DraftError(DRAFT_ERRORS.unknownAction);
  switch (input.kind) {
    case 'open_app':
      return {
        kind: 'open_app',
        packageName: packageNameOf(input.packageName),
        label: text(input.label, MAX_NAME_LENGTH, DRAFT_ERRORS.noApp, DRAFT_ERRORS.noApp),
      };
    case 'notify':
      return { kind: 'notify', text: text(input.text, MAX_NOTIFY_LENGTH, DRAFT_ERRORS.noText, DRAFT_ERRORS.longText) };
    case 'open_url':
      return { kind: 'open_url', url: urlOf(input.url) };
    case 'sound_mode':
      return { kind: 'sound_mode', mode: oneOf(input.mode, SOUND_MODES, DRAFT_ERRORS.badSoundMode) };
    case 'ask_agent': {
      const prompt = text(input.prompt, MAX_PROMPT_LENGTH, DRAFT_ERRORS.noPrompt, DRAFT_ERRORS.longPrompt);
      const allowed = TRIGGER_VARIABLES[trigger.kind];
      for (const [, variable] of prompt.matchAll(/\{(\w+)\}/g)) {
        if (!allowed.includes(variable)) throw new DraftError(`O pedido usa {${variable}}, que esse gatilho não tem.`);
      }
      return { kind: 'ask_agent', prompt, reply: oneOf(input.reply, ['silent', 'notify'] as const, DRAFT_ERRORS.badReply) };
    }
    default:
      throw new DraftError(DRAFT_ERRORS.unknownAction);
  }
}

function parseDays(input: unknown): Weekday[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new DraftError(DRAFT_ERRORS.badDays);
  const days = new Set<Weekday>();
  for (const d of input) {
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 7) throw new DraftError(DRAFT_ERRORS.badDays);
    days.add(d as Weekday);
  }
  return [...days].sort((a, b) => a - b);
}

function urlOf(input: unknown): string {
  const url = typeof input === 'string' ? input.trim() : '';
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):(.+)$/i);
  if (!scheme || /\s/.test(url)) throw new DraftError(DRAFT_ERRORS.badUrl);
  const name = scheme[1].toLowerCase();
  if (BLOCKED_SCHEMES.has(name)) throw new DraftError(DRAFT_ERRORS.badUrl);
  if (name === 'https' && !/^https:\/\/[^/?#]+/i.test(url)) throw new DraftError(DRAFT_ERRORS.badUrl);
  return url;
}

function packageNameOf(input: unknown): string {
  const name = typeof input === 'string' ? input.trim() : '';
  if (!/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(name)) throw new DraftError(DRAFT_ERRORS.noApp);
  return name;
}

function text(input: unknown, max: number, missing: string, tooLong: string): string {
  const s = typeof input === 'string' ? input.trim() : '';
  if (!s) throw new DraftError(missing);
  if (s.length > max) throw new DraftError(tooLong);
  return s;
}

function oneOf<T extends string>(input: unknown, options: readonly T[], reason: string): T {
  if (typeof input === 'string' && (options as readonly string[]).includes(input)) return input as T;
  throw new DraftError(reason);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
