import type { SQLiteDatabase } from 'expo-sqlite';
import type { AssistantPart, ChatMessage, ToolPart } from '@/agent/agent';
import { emitChanged } from './events';
import type { Migration } from './plugin';

/** Schema id of the chat tables in `plugin_schema`; the `_` keeps it apart from plugin ids. */
export const CHAT_SCHEMA_ID = '_chat';

/** Topic of `onChanged` for the conversation list (new, renamed, titled, deleted, touched). */
export const CHAT_TOPIC = '_chat';

/**
 * Conversations, kept on the phone only (ADR 0006). A message's content is
 * its parts, in stream order: text and tool calls. A user message is a single
 * text part.
 */
export const CHAT_MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE chat_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        title_status TEXT NOT NULL,
        origin TEXT NOT NULL,
        voice_session_id TEXT UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX chat_messages_conversation ON chat_messages(conversation_id, id);
      CREATE TABLE chat_parts (
        message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        text TEXT,
        tool_call_id TEXT,
        tool_name TEXT,
        input_json TEXT,
        output TEXT,
        state TEXT,
        duration_ms INTEGER,
        PRIMARY KEY (message_id, seq)
      );
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `,
  },
];

export type ConversationOrigin = 'app' | 'voice';

/**
 * Where the title came from. `pending`: the first words, waiting for the light
 * model; `done`: the light model's; `local`: the first words for good (no
 * light model or it failed); `manual`: the user's, never overwritten.
 */
export type TitleStatus = 'pending' | 'done' | 'local' | 'manual';

export type Conversation = {
  id: number;
  title: string;
  titleStatus: TitleStatus;
  origin: ConversationOrigin;
  voiceSessionId: string | null;
  createdAt: number;
  updatedAt: number;
};

/** `setup`: the turn needs a fix in the settings (key or model). */
export type MessageStatus = 'streaming' | 'done' | 'failed' | 'cancelled' | 'setup';

export type StoredMessage = {
  id: number;
  role: 'user' | 'assistant';
  status: MessageStatus;
  createdAt: number;
  parts: AssistantPart[];
};

type ConversationRow = {
  id: number;
  title: string;
  title_status: TitleStatus;
  origin: ConversationOrigin;
  voice_session_id: string | null;
  created_at: number;
  updated_at: number;
};

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  title: r.title,
  titleStatus: r.title_status,
  origin: r.origin,
  voiceSessionId: r.voice_session_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function createConversation(
  db: SQLiteDatabase,
  { title, origin, voiceSessionId = null, now = Date.now() }: { title: string; origin: ConversationOrigin; voiceSessionId?: string | null; now?: number },
): Promise<Conversation> {
  const r = await db.runAsync(
    'INSERT INTO chat_conversations (title, title_status, origin, voice_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    title,
    'pending',
    origin,
    voiceSessionId,
    now,
    now,
  );
  emitChanged(CHAT_TOPIC);
  return { id: r.lastInsertRowId, title, titleStatus: 'pending', origin, voiceSessionId, createdAt: now, updatedAt: now };
}

export async function getConversation(db: SQLiteDatabase, id: number): Promise<Conversation | null> {
  const r = await db.getFirstAsync<ConversationRow>('SELECT * FROM chat_conversations WHERE id = ?', id);
  return r ? toConversation(r) : null;
}

/** The conversation saved from a voice session, if any. */
export async function findVoiceConversation(db: SQLiteDatabase, sessionId: string): Promise<Conversation | null> {
  const r = await db.getFirstAsync<ConversationRow>('SELECT * FROM chat_conversations WHERE voice_session_id = ?', sessionId);
  return r ? toConversation(r) : null;
}

/** Most recently active first. */
export async function listConversations(db: SQLiteDatabase): Promise<Conversation[]> {
  const rows = await db.getAllAsync<ConversationRow>('SELECT * FROM chat_conversations ORDER BY updated_at DESC, id DESC');
  return rows.map(toConversation);
}

/** The user's title wins for good: the light model never overwrites it. Blank keeps the old one. */
export async function renameConversation(db: SQLiteDatabase, id: number, title: string): Promise<void> {
  const clean = title.trim();
  if (!clean) return;
  await db.runAsync("UPDATE chat_conversations SET title = ?, title_status = 'manual' WHERE id = ?", clean, id);
  emitChanged(CHAT_TOPIC);
}

/**
 * Stores the light model's title, or settles on the first words when it gave
 * none. Only while the title is still `pending`, so a rename in the meantime
 * is kept.
 */
export async function settleTitle(db: SQLiteDatabase, id: number, title: string | null): Promise<void> {
  if (title) {
    await db.runAsync("UPDATE chat_conversations SET title = ?, title_status = 'done' WHERE id = ? AND title_status = 'pending'", title, id);
  } else {
    await db.runAsync("UPDATE chat_conversations SET title_status = 'local' WHERE id = ? AND title_status = 'pending'", id);
  }
  emitChanged(CHAT_TOPIC);
}

/** Deletes the conversation with its messages and tool calls. There is no undo. */
export async function deleteConversation(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM chat_conversations WHERE id = ?', id);
  emitChanged(CHAT_TOPIC);
}

export async function deleteAllConversations(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM chat_conversations');
  emitChanged(CHAT_TOPIC);
}

/** Adds a message with its parts so far and moves the conversation to the top of the list. */
export async function addMessage(
  db: SQLiteDatabase,
  conversationId: number,
  { role, status, parts, now = Date.now() }: { role: 'user' | 'assistant'; status: MessageStatus; parts: AssistantPart[]; now?: number },
): Promise<number> {
  const r = await db.runAsync(
    'INSERT INTO chat_messages (conversation_id, role, status, created_at) VALUES (?, ?, ?, ?)',
    conversationId,
    role,
    status,
    now,
  );
  for (let i = 0; i < parts.length; i++) await savePart(db, r.lastInsertRowId, i, parts[i]);
  await db.runAsync('UPDATE chat_conversations SET updated_at = ? WHERE id = ?', now, conversationId);
  emitChanged(CHAT_TOPIC);
  return r.lastInsertRowId;
}

/** Writes part [seq] of a message, replacing what was there (a growing text, a tool that finished). */
export async function savePart(db: SQLiteDatabase, messageId: number, seq: number, part: AssistantPart): Promise<void> {
  const tool = part.type === 'tool' ? part : null;
  await db.runAsync(
    `INSERT OR REPLACE INTO chat_parts (message_id, seq, type, text, tool_call_id, tool_name, input_json, output, state, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    messageId,
    seq,
    part.type,
    part.type === 'text' ? part.text : null,
    tool?.id ?? null,
    tool?.name ?? null,
    tool ? JSON.stringify(tool.input) : null,
    tool?.output ?? null,
    tool?.state ?? null,
    tool?.durationMs ?? null,
  );
}

export async function setMessageStatus(db: SQLiteDatabase, messageId: number, status: MessageStatus): Promise<void> {
  await db.runAsync('UPDATE chat_messages SET status = ? WHERE id = ?', status, messageId);
}

/**
 * Turns left `streaming` by an app that died mid-reply into `cancelled`, and
 * their running tools into cut-off ones. Called once when the app opens.
 */
export async function closeInterruptedMessages(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(
    "UPDATE chat_parts SET state = 'failed' WHERE state = 'running' AND message_id IN (SELECT id FROM chat_messages WHERE status = 'streaming')",
  );
  await db.runAsync("UPDATE chat_messages SET status = 'cancelled' WHERE status = 'streaming'");
}

type PartRow = {
  message_id: number;
  type: 'text' | 'tool';
  text: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  input_json: string | null;
  output: string | null;
  state: ToolPart['state'] | null;
  duration_ms: number | null;
};

/** The messages of a conversation, oldest first, with their parts in order. */
export async function loadMessages(db: SQLiteDatabase, conversationId: number): Promise<StoredMessage[]> {
  const messages = await db.getAllAsync<{ id: number; role: 'user' | 'assistant'; status: MessageStatus; created_at: number }>(
    'SELECT id, role, status, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY id',
    conversationId,
  );
  const parts = await db.getAllAsync<PartRow>(
    `SELECT p.* FROM chat_parts p JOIN chat_messages m ON m.id = p.message_id
     WHERE m.conversation_id = ? ORDER BY p.message_id, p.seq`,
    conversationId,
  );
  const byMessage = new Map<number, AssistantPart[]>();
  for (const p of parts) {
    const list = byMessage.get(p.message_id) ?? [];
    list.push(toPart(p));
    byMessage.set(p.message_id, list);
  }
  return messages.map((m) => ({ id: m.id, role: m.role, status: m.status, createdAt: m.created_at, parts: byMessage.get(m.id) ?? [] }));
}

function toPart(p: PartRow): AssistantPart {
  if (p.type === 'text') return { type: 'text', text: p.text ?? '' };
  let input: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(p.input_json ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
  } catch {
    // A broken row still shows as a card, with no input.
  }
  return {
    type: 'tool',
    id: p.tool_call_id ?? '',
    name: p.tool_name ?? '',
    input,
    state: p.state ?? 'failed',
    ...(p.output !== null ? { output: p.output } : {}),
    ...(p.duration_ms !== null ? { durationMs: p.duration_ms } : {}),
  };
}

/** The visible text of a message: its text parts, joined. */
export function messageText(parts: AssistantPart[]): string {
  return parts
    .filter((p): p is Extract<AssistantPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .trim();
}

/**
 * What goes back to the model. Our own error replies (`failed`, `setup`) and
 * a reply still streaming are left out; a cancelled one goes back with what
 * it had, tools included.
 */
export function historyFor(messages: StoredMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: messageText(m.parts) });
    } else if (m.status === 'done' || m.status === 'cancelled') {
      if (m.parts.length === 0) continue;
      out.push({ role: 'assistant', content: messageText(m.parts), parts: m.parts });
    }
  }
  return out;
}

/** Whether voice sessions are saved as conversations. On unless the user turned it off. */
export const SAVE_VOICE_SETTING = 'chat.save_voice';

export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', key);
  return r?.value ?? null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

export async function savesVoiceConversations(db: SQLiteDatabase): Promise<boolean> {
  return (await getSetting(db, SAVE_VOICE_SETTING)) !== '0';
}
