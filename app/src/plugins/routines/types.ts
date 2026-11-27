/**
 * Routines: a trigger, optional steps that transform what it hands over, and
 * the actions it runs (ADR 0005). The native side stores them
 * (`edji-routines.db`) and is the source of truth; these types are the JSON
 * that crosses the bridge, validated on both sides.
 */

/**
 * Version of the routine JSON. Not sent over the bridge: the native side
 * stores it next to the JSON and migrates on read. Bumped when a kind or
 * field changes meaning. 2: steps, references, `run_tool` and examples.
 */
export const ROUTINE_SCHEMA_VERSION = 2;

/** Max actions per routine; they run in order. */
export const MAX_ACTIONS = 5;

/** Max steps per routine; they run in order, before the actions. */
export const MAX_STEPS = 5;

/** Max examples kept with a routine. */
export const MAX_EXAMPLES = 10;

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type BluetoothDevice = { address: string; name: string };

export type Trigger =
  | { kind: 'bluetooth'; event: 'connected' | 'disconnected'; device: BluetoothDevice }
  | { kind: 'wifi'; event: 'connected' | 'disconnected'; ssid: string }
  | { kind: 'place'; event: 'enter' | 'exit'; placeId: string }
  /** `at` is local time, `HH:mm`. No days means every day. */
  | { kind: 'time'; at: string; days: Weekday[] }
  /**
   * A notification posted by one app. Never "every app". Filtering by text is
   * a `match` step. Its text stays on the device unless an action sends it.
   */
  | { kind: 'notification'; packageName: string; appLabel: string };

export type TriggerKind = Trigger['kind'];

/** What each trigger hands to steps and actions, as `input.<name>`. Always text. */
export const TRIGGER_OUTPUTS: Record<TriggerKind, string[]> = {
  bluetooth: ['device_name', 'device_address'],
  wifi: ['ssid'],
  place: ['place_name'],
  time: ['time'],
  notification: ['app_name', 'notification_title', 'notification_message', 'notification_id', 'posted_at'],
};

/** `input.<output>` or `<stepId>.output.<name>`. */
export type Ref = { ref: string };

/** Text with `{input.x}` or `{step.output.y}` placeholders. Always text once filled. */
export type Template = { template: string };

/**
 * A value handed to a step or a tool. A reference keeps its type (a number
 * stays a number); a reference is an object so a literal with dots is never
 * read as one.
 */
export type Value = string | number | boolean | Ref | Template;

/** What a step does when its text doesn't match: stop quietly, or go to the failure queue. */
export type OnNoMatch = 'skip' | 'fail';

export type Step =
  /** Goes on only if the text contains `contains`, ignoring case. Default `skip`. No outputs. */
  | { id: string; kind: 'match'; input: { text: Ref | Template }; contains: string; onNoMatch: OnNoMatch }
  /** RE2 regex searched in the text; each named group `(?<name>...)` becomes `<id>.output.<name>`. Default `fail`. */
  | { id: string; kind: 'extract'; input: { text: Ref | Template }; pattern: string; onNoMatch: OnNoMatch }
  /** "1.234,56" → 1234.56 as `<id>.output.value`. Invalid text always fails. */
  | { id: string; kind: 'number'; input: { text: Ref | Template }; format: 'pt-BR' | 'en-US' };

export type StepKind = Step['kind'];

export type SoundMode = 'normal' | 'vibrate' | 'silent' | 'dnd';

export type Action =
  | { kind: 'open_app'; packageName: string; label: string }
  /** `text` may use `{ref}` placeholders. */
  | { kind: 'notify'; text: string }
  /** `https:` or an app deep link; never `intent:`, `file:` and the like. */
  | { kind: 'open_url'; url: string }
  | { kind: 'sound_mode'; mode: SoundMode }
  /**
   * Sends [prompt] (with `{ref}` placeholders filled) to the agent with nobody
   * present. Uses the network; blocked unless the user turned on the routines opt-in.
   */
  | { kind: 'ask_agent'; prompt: string; reply: 'silent' | 'notify' }
  /** Calls a plugin tool marked `routineAction`, with no model and no network. */
  | { kind: 'run_tool'; tool: string; input: Record<string, Value> };

export type ActionKind = Action['kind'];

/**
 * A test kept with the routine: trigger outputs (e.g. `notification_message`)
 * and what should happen. Runs on every save; a broken one blocks the save.
 */
export type Example = { input: Record<string, string>; skip?: boolean; outputs?: Record<string, string | number> };

/** What the agent proposes; the native side adds id, dates and `enabled`. */
export type RoutineDraft = { name: string; trigger: Trigger; steps: Step[]; actions: Action[]; examples: Example[] };

/** A stored routine. New routines start enabled. Only the agent changes them for now. */
export type Routine = RoutineDraft & {
  id: string;
  enabled: boolean;
  createdBy: 'agent' | 'user';
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
};

/** A saved place. Created on the device ("salvar aqui como casa"); the agent never invents coordinates. */
export type Place = { id: string; name: string; latitude: number; longitude: number; radiusM: number };

/** `blocked`: a permission or the opt-in was missing, so nothing ran. */
export type RunOutcome = 'done' | 'failed' | 'blocked';

/** One firing of a routine. `detail` is short and never holds the trigger text. */
export type RoutineRun = { id: number; routineId: string; firedAt: number; outcome: RunOutcome; detail: string };

/**
 * A failed firing kept on the device with its trigger input, so the routine
 * can be fixed and the input run again. Leaves after a retry, a discard or 30 days.
 */
export type RoutineFailure = {
  id: number;
  routineId: string;
  failedAt: number;
  stage: 'step' | 'action';
  /** Step id or "ação N". */
  where: string;
  reason: string;
  input: Record<string, string>;
};

/** One case of a dry run (`routines.test`). */
export type TestCaseResult =
  | { label: string; outcome: 'skip'; step: string }
  | { label: string; outcome: 'fail'; step: string; reason: string }
  | {
      label: string;
      outcome: 'run';
      /** Step outputs by reference. */
      values: Record<string, string | number>;
      actions: { kind: ActionKind; text?: string; prompt?: string; tool?: string; input?: Record<string, unknown> }[];
    };

/** How a retried failure ended; `skipped` means a step now ignores that input on purpose. */
export type RetryResult = { outcome: RunOutcome | 'skipped'; detail: string };
