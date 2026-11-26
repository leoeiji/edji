import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';
import type { PermissionId, PermissionStatus } from '../../src/core/permissions';
import type { BluetoothDevice, Place, Routine, RoutineDraft, RoutineRun, RunOutcome } from '../../src/plugins/routines/types';

/** A finished turn of the current voice session. */
export type Turn = { role: 'user' | 'assistant'; content: string };

/**
 * A voice command stored by the native session, waiting for the agent.
 * `history` holds the earlier turns of the same session, oldest first.
 */
export type PendingCommand = { id: number; text: string; createdAt: number; history: Turn[] };

/** How the agent finished a command, as the session shows it. */
export type CommandStatus = 'done' | 'setup' | 'failed' | 'cancelled';

type EdjiAssistantNative = {
  pendingCommands(): Promise<PendingCommand[]>;
  /** Shows the reply so far in the session. Returns false once nobody is waiting (session closed). */
  pushReply(id: number, textSoFar: string): boolean;
  /** Whether the session still waits for this command. Doesn't extend its deadline. */
  isWaiting(id: number): boolean;
  /** Tells the session the model is still working (e.g. reasoning). Returns false once nobody is waiting. */
  heartbeat(id: number): boolean;
  /** Reports the final result. Returns false if the command was no longer pending. */
  completeCommand(id: number, status: CommandStatus, reply: string): Promise<boolean>;
  log(message: string): void;
  logLines(): string[];
  isAssistant(): boolean;
  openAssistantSettings(): void;
  addListener(event: 'onLog', listener: (e: { line: string }) => void): EventSubscription;
} & RoutinesNative;

/**
 * Routines and permissions bridge (ADR 0005). Routines live in
 * `edji-routines.db`, which only the native side opens; it validates every
 * routine again and registers the triggers. Errors reject with a short
 * Portuguese message.
 */
type RoutinesNative = {
  listRoutines(): Promise<Routine[]>;
  /** Validates again, stores (enabled) and registers the trigger. Rejects with a short Portuguese reason. */
  saveRoutine(draft: RoutineDraft): Promise<Routine>;
  deleteRoutine(id: string): Promise<boolean>;
  setRoutineEnabled(id: string, enabled: boolean): Promise<boolean>;
  recentRuns(limit: number): Promise<RoutineRun[]>;
  listPlaces(): Promise<Place[]>;
  /** Saves the current location as a place. */
  savePlaceHere(name: string): Promise<Place>;
  /** Paired devices only. */
  listBluetoothDevices(): Promise<BluetoothDevice[]>;
  currentWifi(): Promise<{ ssid: string } | null>;
  listLaunchableApps(): Promise<{ packageName: string; label: string }[]>;
  /** `ask_agent` firings waiting for the JS runtime. Text leaves the queue once completed or expired. */
  pendingRoutineRuns(): Promise<PendingRoutineRun[]>;
  /**
   * Reports an `ask_agent` firing. `retry` keeps it queued (no network) until
   * it expires; [notifyText] is shown as a notification when the routine asked for it.
   */
  completeRoutineRun(id: number, outcome: RunOutcome | 'retry', detail: string, notifyText: string | null): Promise<boolean>;
  /** Whether routines may send text to the agent with nobody present. Off by default. */
  isRoutinesAgentAllowed(): boolean;
  setRoutinesAgentAllowed(allowed: boolean): void;
  permissionStatus(ids: PermissionId[]): Record<PermissionId, PermissionStatus>;
  /** Opens the Android screen where the user grants a special permission. */
  openPermissionSettings(id: PermissionId): void;
  /** Registers the routine triggers again (after a permission changed). */
  syncRoutines(): void;
};

/** An `ask_agent` firing: the prompt with the trigger variables already filled in. */
export type PendingRoutineRun = { id: number; routineId: string; prompt: string; reply: 'silent' | 'notify'; firedAt: number };

/**
 * Native voice module (Android only). `null` where it isn't available
 * (iOS for now, web, tests): callers must degrade gracefully.
 */
export const EdjiAssistant = requireOptionalNativeModule<EdjiAssistantNative>('EdjiAssistant');

/** Logs to the native diagnostic log when available, else to the console. */
export function assistantLog(message: string): void {
  if (EdjiAssistant) EdjiAssistant.log(message);
  else console.log(`[Edji] ${message}`);
}
