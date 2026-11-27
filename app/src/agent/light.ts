import { generateText, type LanguageModel } from 'ai';
import type { ModelSettings } from './settings';

export type LightDeps = {
  settings: Pick<ModelSettings, 'apiKey' | 'lightModel'>;
  /** Builds the model; injected in tests. */
  createModel(apiKey: string, model: string): LanguageModel;
  signal?: AbortSignal;
};

/**
 * One quick task on the light model: a short prompt in, a short text out.
 * Never throws and never touches the network without a key and a light
 * model; any failure is `null`, so callers keep their offline fallback.
 */
export async function runLight(deps: LightDeps, instructions: string, prompt: string): Promise<string | null> {
  const { apiKey, lightModel } = deps.settings;
  if (!apiKey || !lightModel) return null;
  try {
    const { text } = await generateText({
      model: deps.createModel(apiKey, lightModel),
      instructions,
      prompt,
      maxRetries: 1,
      abortSignal: deps.signal,
    });
    return text.trim() || null;
  } catch {
    return null;
  }
}

/** Longest title, in words. Fits one line of the side panel. */
export const TITLE_MAX_WORDS = 6;

const TITLE_INSTRUCTIONS = [
  'Você dá títulos a conversas de um assistente no celular.',
  `Responda só com o título, em português do Brasil, com no máximo ${TITLE_MAX_WORDS} palavras.`,
  'Sem aspas, sem ponto final, sem emojis. Diga o assunto, não a ação do assistente.',
].join(' ');

/** Longest stretch of each turn sent for the title: the gist is at the start. */
const TITLE_INPUT_CHARS = 500;

/** A title from the first exchange, or `null` (no light model, offline, empty answer). */
export async function generateTitle(userText: string, replyText: string, deps: LightDeps): Promise<string | null> {
  const prompt = `Pedido: ${userText.slice(0, TITLE_INPUT_CHARS)}\nResposta: ${replyText.slice(0, TITLE_INPUT_CHARS)}`;
  const raw = await runLight(deps, TITLE_INSTRUCTIONS, prompt);
  return raw ? cleanTitle(raw) : null;
}

/** First line, no quotes or trailing punctuation, at most [TITLE_MAX_WORDS] words. Models don't always obey. */
export function cleanTitle(raw: string): string | null {
  const line = raw.split('\n').find((l) => l.trim()) ?? '';
  const words = line
    .replace(/^(título|title)\s*:\s*/i, '')
    .replace(/["“”'‘’*_#`]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, TITLE_MAX_WORDS);
  const title = words.join(' ').replace(/[.!?:;,…]+$/, '').trim();
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : null;
}

/** The offline title: the first words of the request. Used until (or instead of) the light model's. */
export function fallbackTitle(userText: string): string {
  const words = userText.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'Conversa';
  const head = words.slice(0, TITLE_MAX_WORDS).join(' ').replace(/[.!?:;,]+$/, '');
  const title = words.length > TITLE_MAX_WORDS ? `${head}…` : head;
  return title.charAt(0).toUpperCase() + title.slice(1);
}
