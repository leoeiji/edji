import type { Tool, ValueSchema } from '@/core/plugin';
import {
  MAX_ACTIONS,
  MAX_EXAMPLES,
  MAX_STEPS,
  TRIGGER_OUTPUTS,
  type Action,
  type Example,
  type OnNoMatch,
  type Ref,
  type RoutineDraft,
  type SoundMode,
  type Step,
  type Template,
  type Trigger,
  type TriggerKind,
  type Value,
  type Weekday,
} from './types';

/** What the validator needs to know about the device and the app. */
export type DraftContext = {
  placeIds: string[];
  /** Tools of the enabled plugins; `run_tool` may only call the ones marked `routineAction`. */
  tools: Pick<Tool, 'name' | 'parameters' | 'routineAction'>[];
};

export type DraftResult = { ok: true; draft: RoutineDraft } | { ok: false; reason: string };

export const MAX_NAME_LENGTH = 60;
export const MAX_NOTIFY_LENGTH = 200;
export const MAX_PROMPT_LENGTH = 500;
export const MAX_PATTERN_LENGTH = 300;
export const MAX_CONTAINS_LENGTH = 100;
export const MAX_TEMPLATE_LENGTH = 500;
export const MAX_INPUT_LENGTH = 4000;
const MAX_SSID_LENGTH = 32;
const MAX_TOOL_INPUTS = 10;

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
  tooManySteps: `Uma rotina pode ter no máximo ${MAX_STEPS} etapas.`,
  badStepId: 'Cada etapa precisa de um id em snake_case, ex.: extract_value.',
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
  notRoutineTool: 'Esse tool não pode ser usado por uma rotina.',
  tooManyExamples: `Uma rotina pode ter no máximo ${MAX_EXAMPLES} exemplos.`,
} as const;

/** Schemes a routine may never open: they reach files, other apps' internals or run code. */
const BLOCKED_SCHEMES = new Set(['http', 'intent', 'file', 'content', 'javascript', 'data', 'about', 'android-app', 'blob']);
const SOUND_MODES: SoundMode[] = ['normal', 'vibrate', 'silent', 'dnd'];
const NAME = '[a-z][a-z0-9_]{0,39}';
const ID = new RegExp(`^${NAME}$`);
const REF = new RegExp(`^(input\\.${NAME}|${NAME}\\.output\\.${NAME})$`);
/** Anything that looks like a variable; it must be a valid reference, so an old `{text}` never passes as plain text. */
const PLACEHOLDER = /\{([A-Za-z_][\w.]*)\}/g;
/** Named groups `(?<name>` or `(?P<name>`; lookbehinds `(?<=`/`(?<!` are left to the native RE2 check. */
const GROUP = /\(\?P?<([^>=!][^>]*)>/g;
const PARAM = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

type ValueType = 'text' | 'number';
/** References available at some point of the routine, with their type. */
type Refs = Map<string, ValueType>;

class DraftError extends Error {}

/**
 * Checks and normalizes a routine proposed by the agent: trims text, keeps
 * only known fields, sorts the weekdays, checks steps, references and tool
 * inputs. Never throws; the reason is a short Portuguese sentence the session
 * can show. The native side checks again, compiles the regexes (the TS side
 * never runs them) and runs the examples.
 */
export function parseRoutineDraft(input: unknown, ctx: DraftContext): DraftResult {
  try {
    if (!isRecord(input)) throw new DraftError(DRAFT_ERRORS.notObject);
    const name = text(input.name, MAX_NAME_LENGTH, DRAFT_ERRORS.noName, DRAFT_ERRORS.longName);
    const trigger = parseTrigger(input.trigger, ctx);
    const refs: Refs = new Map(TRIGGER_OUTPUTS[trigger.kind].map((o) => [`input.${o}`, 'text']));
    const steps = parseSteps(input.steps, refs);
    if (!Array.isArray(input.actions) || input.actions.length === 0) throw new DraftError(DRAFT_ERRORS.noActions);
    if (input.actions.length > MAX_ACTIONS) throw new DraftError(DRAFT_ERRORS.tooManyActions);
    const actions = input.actions.map((a) => parseAction(a, refs, ctx));
    const examples = parseExamples(input.examples, trigger.kind, refs);
    return { ok: true, draft: { name, trigger, steps, actions, examples } };
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
    case 'notification':
      return {
        kind: 'notification',
        packageName: packageNameOf(input.packageName),
        appLabel: text(input.appLabel, MAX_NAME_LENGTH, DRAFT_ERRORS.noApp, DRAFT_ERRORS.noApp),
      };
    default:
      throw new DraftError(DRAFT_ERRORS.unknownTrigger);
  }
}

/** Validates the steps in order, adding each one's outputs to [refs]. */
function parseSteps(input: unknown, refs: Refs): Step[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new DraftError('Não entendi as etapas.');
  if (input.length > MAX_STEPS) throw new DraftError(DRAFT_ERRORS.tooManySteps);
  const ids = new Set<string>();
  return input.map((raw, i): Step => {
    if (!isRecord(raw)) throw new DraftError(`Não entendi a etapa ${i + 1}.`);
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!ID.test(id) || id === 'input') throw new DraftError(DRAFT_ERRORS.badStepId);
    if (ids.has(id)) throw new DraftError(`O id de etapa ${id} se repete.`);
    ids.add(id);
    if (!isRecord(raw.input)) throw new DraftError(`Falta o texto de entrada da etapa ${id}.`);
    const textIn = parseValue(raw.input.text, refs, false, `a entrada da etapa ${id}`) as Ref | Template;
    switch (raw.kind) {
      case 'match': {
        const contains = typeof raw.contains === 'string' ? raw.contains.trim() : '';
        if (!contains || contains.length > MAX_CONTAINS_LENGTH) throw new DraftError(`A etapa ${id} precisa de um texto curto para procurar.`);
        return { id, kind: 'match', input: { text: textIn }, contains, onNoMatch: onNoMatchOf(raw.onNoMatch, 'skip', id) };
      }
      case 'extract': {
        const pattern = typeof raw.pattern === 'string' ? raw.pattern : '';
        if (!pattern || pattern.length > MAX_PATTERN_LENGTH) throw new DraftError(`A regex da etapa ${id} está vazia ou longa demais.`);
        for (const [, group] of pattern.matchAll(GROUP)) {
          if (!ID.test(group)) throw new DraftError(`Use nomes de grupo em snake_case na etapa ${id}, ex.: (?<value>...).`);
          refs.set(`${id}.output.${group}`, 'text');
        }
        return { id, kind: 'extract', input: { text: textIn }, pattern, onNoMatch: onNoMatchOf(raw.onNoMatch, 'fail', id) };
      }
      case 'number': {
        const format = raw.format === undefined ? 'pt-BR' : raw.format;
        if (format !== 'pt-BR' && format !== 'en-US') throw new DraftError(`A etapa ${id} precisa do formato pt-BR ou en-US.`);
        refs.set(`${id}.output.value`, 'number');
        return { id, kind: 'number', input: { text: textIn }, format };
      }
      default:
        throw new DraftError(`Não conheço o tipo da etapa ${id}.`);
    }
  });
}

function onNoMatchOf(input: unknown, fallback: OnNoMatch, id: string): OnNoMatch {
  if (input === undefined || input === null || input === '') return fallback;
  if (input === 'skip' || input === 'fail') return input;
  throw new DraftError(`Na etapa ${id}, onNoMatch é skip ou fail.`);
}

/** A reference, a template or (when [literals]) a plain string, number or boolean. */
function parseValue(input: unknown, refs: Refs, literals: boolean, what: string): Value {
  if (isRecord(input) && 'ref' in input) {
    const ref = typeof input.ref === 'string' ? input.ref.trim() : '';
    if (!REF.test(ref) || !refs.has(ref)) throw new DraftError(`A referência ${ref}, usada em ${what}, não existe ou vem depois.`);
    return { ref };
  }
  if (isRecord(input) && 'template' in input) return { template: template(input.template, refs, what) };
  if (literals && typeof input === 'string') {
    if (input.length > MAX_TEMPLATE_LENGTH) throw new DraftError(`O texto de ${what} é longo demais.`);
    return input;
  }
  if (literals && ((typeof input === 'number' && Number.isFinite(input)) || typeof input === 'boolean')) return input;
  throw new DraftError(`Não entendi ${what}. Use {"ref": ...} ou {"template": ...}.`);
}

/** Checks that every `{ref}` placeholder of a template exists at that point. */
function template(input: unknown, refs: Refs, what: string, max = MAX_TEMPLATE_LENGTH): string {
  const s = typeof input === 'string' ? input : '';
  if (!s.trim()) throw new DraftError(`Falta o texto de ${what}.`);
  if (s.length > max) throw new DraftError(`O texto de ${what} é longo demais.`);
  for (const [, ref] of s.matchAll(PLACEHOLDER)) {
    if (!REF.test(ref) || !refs.has(ref)) throw new DraftError(`A referência {${ref}}, usada em ${what}, não existe ou vem depois.`);
  }
  return s;
}

function parseAction(input: unknown, refs: Refs, ctx: DraftContext): Action {
  if (!isRecord(input)) throw new DraftError(DRAFT_ERRORS.unknownAction);
  switch (input.kind) {
    case 'open_app':
      return {
        kind: 'open_app',
        packageName: packageNameOf(input.packageName),
        label: text(input.label, MAX_NAME_LENGTH, DRAFT_ERRORS.noApp, DRAFT_ERRORS.noApp),
      };
    case 'notify': {
      const t = text(input.text, MAX_NOTIFY_LENGTH, DRAFT_ERRORS.noText, DRAFT_ERRORS.longText);
      return { kind: 'notify', text: template(t, refs, 'o aviso') };
    }
    case 'open_url':
      return { kind: 'open_url', url: urlOf(input.url) };
    case 'sound_mode':
      return { kind: 'sound_mode', mode: oneOf(input.mode, SOUND_MODES, DRAFT_ERRORS.badSoundMode) };
    case 'ask_agent': {
      const prompt = text(input.prompt, MAX_PROMPT_LENGTH, DRAFT_ERRORS.noPrompt, DRAFT_ERRORS.longPrompt);
      return {
        kind: 'ask_agent',
        prompt: template(prompt, refs, 'o pedido ao agente'),
        reply: oneOf(input.reply, ['silent', 'notify'] as const, DRAFT_ERRORS.badReply),
      };
    }
    case 'run_tool':
      return parseRunTool(input, refs, ctx);
    default:
      throw new DraftError(DRAFT_ERRORS.unknownAction);
  }
}

/** A `run_tool` action: the tool must be a routine action of an enabled plugin, and its input must fit the tool's schema. */
function parseRunTool(input: Record<string, unknown>, refs: Refs, ctx: DraftContext): Action {
  const name = typeof input.tool === 'string' ? input.tool.trim() : '';
  if (name.startsWith('routines.')) throw new DraftError(DRAFT_ERRORS.notRoutineTool);
  const tool = ctx.tools.find((t) => t.name === name);
  if (!tool) throw new DraftError(`O tool ${name} não existe ou o plugin dele está desligado.`);
  if (!tool.routineAction) throw new DraftError(DRAFT_ERRORS.notRoutineTool);
  const raw = input.input === undefined ? {} : input.input;
  if (!isRecord(raw)) throw new DraftError(`Não entendi os parâmetros de ${name}.`);
  if (Object.keys(raw).length > MAX_TOOL_INPUTS) throw new DraftError(`O tool ${name} recebe valores demais.`);
  const { properties, required = [] } = tool.parameters;
  const values: Record<string, Value> = {};
  for (const [key, v] of Object.entries(raw)) {
    if (!PARAM.test(key) || !(key in properties)) throw new DraftError(`O tool ${name} não tem o parâmetro ${key}.`);
    const value = parseValue(v, refs, true, `${key} de ${name}`);
    checkType(value, properties[key], refs, `${key} de ${name}`);
    values[key] = value;
  }
  for (const key of required) {
    if (!(key in values)) throw new DraftError(`Falta o parâmetro ${key} de ${name}.`);
  }
  return { kind: 'run_tool', tool: name, input: values };
}

/** Whether a value fits a flat parameter schema. Enums of references are checked by the tool at run time. */
function checkType(value: Value, schema: ValueSchema, refs: Refs, what: string): void {
  if (!('type' in schema)) return;
  const got: string =
    typeof value === 'object' ? ('ref' in value ? refs.get(value.ref)! : 'text') : typeof value === 'string' ? 'text' : typeof value;
  const LABELS: Record<string, string> = { text: 'texto', number: 'número', boolean: 'sim/não' };
  const wanted = schema.type === 'string' ? 'text' : schema.type === 'integer' ? 'number' : schema.type;
  if (got !== wanted) throw new DraftError(`O parâmetro ${what} espera ${LABELS[wanted] ?? wanted}, mas recebe ${LABELS[got] ?? got}.`);
  if (schema.type === 'integer' && typeof value === 'number' && !Number.isInteger(value)) {
    throw new DraftError(`O parâmetro ${what} espera um número inteiro.`);
  }
  if (schema.type === 'string' && schema.enum && typeof value === 'string' && !schema.enum.includes(value)) {
    throw new DraftError(`O parâmetro ${what} aceita só: ${schema.enum.join(', ')}.`);
  }
}

function parseExamples(input: unknown, kind: TriggerKind, refs: Refs): Example[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new DraftError('Não entendi os exemplos.');
  if (input.length > MAX_EXAMPLES) throw new DraftError(DRAFT_ERRORS.tooManyExamples);
  const fields = TRIGGER_OUTPUTS[kind];
  return input.map((raw, i): Example => {
    const n = i + 1;
    if (!isRecord(raw) || !isRecord(raw.input)) throw new DraftError(`Falta a entrada do exemplo ${n}.`);
    const exampleInput: Record<string, string> = {};
    for (const [key, v] of Object.entries(raw.input)) {
      if (!fields.includes(key)) throw new DraftError(`O exemplo ${n} usa ${key}, que esse gatilho não tem. Use: ${fields.join(', ')}.`);
      if (typeof v !== 'string' || v.length > MAX_INPUT_LENGTH) throw new DraftError(`O exemplo ${n} tem um texto inválido em ${key}.`);
      exampleInput[key] = v;
    }
    const example: Example = { input: exampleInput };
    if (raw.skip === true) example.skip = true;
    if (isRecord(raw.outputs) && Object.keys(raw.outputs).length > 0) {
      const outputs: Record<string, string | number> = {};
      for (const [key, v] of Object.entries(raw.outputs)) {
        if (!refs.has(key)) throw new DraftError(`O exemplo ${n} espera ${key}, que a rotina não produz.`);
        if (typeof v !== 'string' && (typeof v !== 'number' || !Number.isFinite(v))) {
          throw new DraftError(`O exemplo ${n} espera um valor inválido em ${key}.`);
        }
        outputs[key] = v;
      }
      example.outputs = outputs;
    }
    return example;
  });
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
