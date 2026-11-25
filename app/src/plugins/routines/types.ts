/**
 * Routines: a trigger and the actions it runs (ADR 0005). The native side
 * stores them (`edji-routines.db`) and is the source of truth; these types
 * are the JSON that crosses the bridge, validated on both sides.
 */

/**
 * Version of the trigger and action JSON. Not sent over the bridge: the native
 * side stores it next to the JSON and migrates on read. Bumped when a kind or
 * field changes meaning.
 */
export const ROUTINE_SCHEMA_VERSION = 1;

/** Max actions per routine; they run in order. */
export const MAX_ACTIONS = 5;

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
   * A notification posted by one app. Never "every app". Its text is read
   * only on the device and reaches the network only through `ask_agent`.
   */
  | { kind: 'notification'; packageName: string; appLabel: string; textContains?: string };

export type TriggerKind = Trigger['kind'];

export type SoundMode = 'normal' | 'vibrate' | 'silent' | 'dnd';

export type Action =
  | { kind: 'open_app'; packageName: string; label: string }
  | { kind: 'notify'; text: string }
  /** `https:` or an app deep link; never `intent:`, `file:` and the like. */
  | { kind: 'open_url'; url: string }
  | { kind: 'sound_mode'; mode: SoundMode }
  /**
   * Sends [prompt] to the agent with nobody present. The only action that
   * uses the network; blocked unless the user turned on the routines opt-in.
   * The prompt may use the trigger's variables, e.g. `{text}`.
   */
  | { kind: 'ask_agent'; prompt: string; reply: 'silent' | 'notify' };

export type ActionKind = Action['kind'];

/** What the agent proposes; the native side adds id, dates and `enabled`. */
export type RoutineDraft = { name: string; trigger: Trigger; actions: Action[] };

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

/** One firing of a routine. `detail` never holds notification text. */
export type RoutineRun = { id: number; routineId: string; firedAt: number; outcome: RunOutcome; detail: string };

/** Variables a trigger offers to `ask_agent` prompts. */
export const TRIGGER_VARIABLES: Record<TriggerKind, string[]> = {
  bluetooth: ['device'],
  wifi: ['ssid'],
  place: ['place'],
  time: ['time'],
  notification: ['app', 'title', 'text', 'postedAt'],
};
