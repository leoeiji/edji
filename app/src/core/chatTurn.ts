import type { LanguageModel } from 'ai';
import type { SQLiteDatabase } from 'expo-sqlite';
import { runAgent, type AgentResult, type AgentTool, type AssistantPart, type ToolEvent } from '@/agent/agent';
import { generateTitle } from '@/agent/light';
import type { ModelSettings } from '@/agent/settings';
import { addMessage, historyFor, loadMessages, savePart, setMessageStatus, settleTitle, type Conversation, type MessageStatus } from './chatStore';
import { recordStep, usageRecorder } from './usage';

/** How often a growing text is written to the database while it streams. */
export const TEXT_SAVE_MS = 250;

export type TurnInput = {
  db: SQLiteDatabase;
  conversationId: number;
  userText: string;
  settings: ModelSettings;
  createModel(apiKey: string, model: string): LanguageModel;
  instructions?: string;
  tools?: AgentTool[];
  signal?: AbortSignal;
  /** The reply's parts so far, after every change: for the chat screen. */
  onParts?(parts: AssistantPart[]): void;
  /** The stored id of the user message, before the reply starts: the screen hides stored rows from it on while it shows the live turn. */
  onStored?(userMessageId: number): void;
  /** Same as [runAgent]'s, for the voice session. */
  onText?(textSoFar: string): void;
  onActivity?(): void;
  onToolEvent?(event: ToolEvent): void;
  /** Where the turn's model steps are counted (ADR 0008): the text chat, or a voice session with its id. */
  source?: 'chat' | 'voice';
  voiceSessionId?: string | null;
  now?(): number;
};

export type TurnResult = AgentResult & { messageId: number };

/**
 * One persisted turn, for the chat screen and the voice session alike: stores
 * the user message, runs the agent on the stored history (tools included),
 * and saves the reply as it streams, text and tool calls in order. Our own
 * error replies are stored with their status, so they show but never go
 * back to the model. Never throws for model or network trouble.
 */
export async function runPersistedTurn(input: TurnInput): Promise<TurnResult> {
  const { db, conversationId, userText } = input;
  const now = input.now ?? Date.now;
  const history = historyFor(await loadMessages(db, conversationId));
  const userMessageId = await addMessage(db, conversationId, { role: 'user', status: 'done', parts: [{ type: 'text', text: userText }], now: now() });
  input.onStored?.(userMessageId);
  const messageId = await addMessage(db, conversationId, { role: 'assistant', status: 'streaming', parts: [], now: now() });

  // Writes run one after another: a slow text save must not land after the tool that followed it.
  let queue: Promise<void> = Promise.resolve();
  const write = (fn: () => Promise<void>) => {
    queue = queue.then(fn).catch(() => {});
  };

  const parts: AssistantPart[] = [];
  let consumed = 0; // characters of the streamed text already in closed text parts
  let openText: number | null = null; // index of the text part still growing
  let textTimer: ReturnType<typeof setTimeout> | null = null;
  const saveText = () => {
    textTimer = null;
    if (openText === null) return;
    const seq = openText;
    const part = parts[seq];
    write(() => savePart(db, messageId, seq, part));
  };
  const changed = () => input.onParts?.(parts.slice());

  const result = await runAgent({
    messages: [...history, { role: 'user', content: userText }],
    settings: input.settings,
    createModel: input.createModel,
    instructions: input.instructions,
    tools: input.tools,
    signal: input.signal,
    onActivity: input.onActivity,
    onStep: (m) => {
      const at = now();
      const origin = { source: input.source ?? 'chat', conversationId, messageId, voiceSessionId: input.voiceSessionId ?? null };
      write(() => recordStep(db, origin, m, at));
    },
    onText: (full) => {
      const text = full.slice(consumed);
      if (openText === null) {
        if (!text.trim()) return;
        openText = parts.length;
        parts.push({ type: 'text', text });
      } else {
        parts[openText] = { type: 'text', text };
      }
      textTimer ??= setTimeout(saveText, TEXT_SAVE_MS);
      changed();
      input.onText?.(full);
    },
    onToolEvent: (e) => {
      const at = parts.findIndex((p) => p.type === 'tool' && p.id === e.id);
      if (at === -1) {
        // A tool call closes the text before it; later text starts a new part.
        if (openText !== null) {
          if (textTimer) clearTimeout(textTimer);
          saveText();
          openText = null;
        }
        const text = parts.filter((p) => p.type === 'text').map((p) => (p.type === 'text' ? p.text : '')).join('');
        consumed = Math.max(consumed, text.length);
      }
      const seq = at === -1 ? parts.length : at;
      const part: AssistantPart = { type: 'tool', ...e };
      parts[seq] = part;
      write(() => savePart(db, messageId, seq, part));
      changed();
      input.onToolEvent?.(e);
    },
  });

  if (textTimer) clearTimeout(textTimer);
  saveText();
  // Trimmed reply replaces the last text part; errors are shown as the reply.
  if (result.status === 'done' && openText !== null) {
    parts[openText] = { type: 'text', text: (parts[openText] as { text: string }).text.trimEnd() };
    const seq = openText;
    const part = parts[seq];
    write(() => savePart(db, messageId, seq, part));
  } else if (result.status === 'failed' || result.status === 'setup') {
    const seq = parts.length;
    const part: AssistantPart = { type: 'text', text: result.reply };
    parts.push(part);
    write(() => savePart(db, messageId, seq, part));
  }
  const status: MessageStatus = result.status;
  write(() => setMessageStatus(db, messageId, status));
  await queue;
  changed();
  return { ...result, messageId };
}

/**
 * Gives a conversation its title after the first answered turn: the light
 * model's, or the first words for good. Only while the title is `pending`.
 */
export async function titleConversation(
  db: SQLiteDatabase,
  conversation: Pick<Conversation, 'id' | 'titleStatus'>,
  userText: string,
  result: AgentResult,
  deps: { settings: ModelSettings; createModel(apiKey: string, model: string): LanguageModel },
): Promise<void> {
  if (conversation.titleStatus !== 'pending' || result.status !== 'done') return;
  const usage = usageRecorder(db, { source: 'title', conversationId: conversation.id });
  const title = await generateTitle(userText, result.reply, { ...deps, onStep: usage.onStep });
  await usage.flush();
  await settleTitle(db, conversation.id, title);
}
