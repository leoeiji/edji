import { APICallError, streamText, type LanguageModel } from 'ai';
import type { ModelSettings } from './settings';

/** One turn of the voice conversation. History lives only while the session is open. */
export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/**
 * How a turn ended. `setup` means the user has to fix something in the
 * settings (key or model); the session offers a button for it.
 */
export type AgentStatus = 'done' | 'setup' | 'failed' | 'cancelled';

export type AgentResult = { status: AgentStatus; reply: string };

export type AgentInput = {
  /** Earlier turns of this session, oldest first, then the new user message last. */
  messages: ChatMessage[];
  settings: ModelSettings;
  /** Called with the whole reply so far each time new text arrives. */
  onText?(textSoFar: string): void;
  /** Called when the model shows life without visible text (e.g. reasoning). */
  onActivity?(): void;
  signal?: AbortSignal;
  /** Builds the model; injected in tests. */
  createModel(apiKey: string, model: string): LanguageModel;
};

/** System instructions, in the brandbook tone: short, direct Portuguese for a small screen. */
export const INSTRUCTIONS = [
  'Você é o Edji, um assistente de voz no celular.',
  'A pessoa fala, e sua resposta aparece escrita numa tela pequena.',
  'Responda em português do Brasil, curto e direto: de uma a três frases.',
  'Não use markdown, listas, títulos nem emojis.',
  'A fala vem de reconhecimento de voz e pode ter erros; interprete pelo contexto.',
  'Se não souber, diga que não sabe.',
].join(' ');

export const MESSAGES = {
  noKey: 'Falta a chave do OpenRouter. Coloque a chave e o modelo nas configurações.',
  noModel: 'Falta escolher o modelo. Coloque o ID do modelo nas configurações.',
  badKey: 'A chave do OpenRouter não funcionou. Confira nas configurações.',
  noCredits: 'Acabaram os créditos no OpenRouter.',
  unknownModel: 'O OpenRouter não conhece esse modelo. Confira o ID nas configurações.',
  offline: 'Sem internet. Tente de novo quando tiver conexão.',
  rateLimited: 'O OpenRouter pediu uma pausa. Tente de novo em instantes.',
  empty: 'Não veio resposta. Pode repetir?',
  failed: 'Algo falhou ao falar com o modelo. Tente de novo.',
} as const;

/**
 * The agent loop. For now it has no tools: it sends the conversation to the
 * configured model and streams the text back. Never throws; every failure
 * becomes a short reply the voice session can show.
 */
export async function runAgent({ messages, settings, onText, onActivity, signal, createModel }: AgentInput): Promise<AgentResult> {
  // Checked before anything leaves the device: no key, no network call.
  if (!settings.apiKey) return { status: 'setup', reply: MESSAGES.noKey };
  if (!settings.model) return { status: 'setup', reply: MESSAGES.noModel };

  let text = '';
  let streamError: unknown = null;
  try {
    const result = streamText({
      model: createModel(settings.apiKey, settings.model),
      instructions: INSTRUCTIONS,
      messages,
      abortSignal: signal,
      maxRetries: 1,
      onError: () => {}, // errors are read from fullStream below; the default logs to console.error
    });
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        text += part.text;
        onText?.(text);
      } else if (part.type === 'reasoning-delta') {
        onActivity?.();
      } else if (part.type === 'error') {
        streamError = part.error;
        break;
      }
    }
  } catch (e) {
    streamError = e;
  }

  if (signal?.aborted) return { status: 'cancelled', reply: text.trim() };
  if (streamError) return describeError(streamError);
  const reply = text.trim();
  return reply ? { status: 'done', reply } : { status: 'failed', reply: MESSAGES.empty };
}

/** Maps a provider or network error to a short message. Never includes the key. */
export function describeError(error: unknown): AgentResult {
  const status = statusCodeOf(error);
  if (status === 401 || status === 403) return { status: 'setup', reply: MESSAGES.badKey };
  if (status === 402) return { status: 'failed', reply: MESSAGES.noCredits };
  if (status === 404) return { status: 'setup', reply: MESSAGES.unknownModel };
  if (status === 429) return { status: 'failed', reply: MESSAGES.rateLimited };
  if (status === undefined && isNetworkError(error)) return { status: 'failed', reply: MESSAGES.offline };
  return { status: 'failed', reply: MESSAGES.failed };
}

/** HTTP status of the first API error found, looking through retry and cause wrappers. */
function statusCodeOf(error: unknown, depth = 0): number | undefined {
  if (!error || typeof error !== 'object' || depth > 4) return undefined;
  if (APICallError.isInstance(error)) return error.statusCode;
  const e = error as { lastError?: unknown; cause?: unknown; errors?: unknown[] };
  for (const inner of [e.lastError, e.cause, ...(e.errors ?? [])]) {
    const s = statusCodeOf(inner, depth + 1);
    if (s !== undefined) return s;
  }
  return undefined;
}

function isNetworkError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 4) return false;
  const message = error instanceof Error ? error.message : '';
  if (/network|failed to fetch|unable to resolve host|timeout|offline/i.test(message)) return true;
  const e = error as { lastError?: unknown; cause?: unknown };
  return isNetworkError(e.lastError, depth + 1) || isNetworkError(e.cause, depth + 1);
}
