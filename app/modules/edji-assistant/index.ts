import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

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
};

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
