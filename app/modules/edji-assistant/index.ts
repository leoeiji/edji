import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/** A voice command stored by the native session, waiting for the agent. */
export type PendingCommand = { id: number; text: string; createdAt: number };

type EdjiAssistantNative = {
  pendingCommands(): Promise<PendingCommand[]>;
  completeCommand(id: number, ok: boolean, reply: string): Promise<boolean>;
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
