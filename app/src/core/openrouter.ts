import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import { fetch as expoFetch } from 'expo/fetch';

/**
 * OpenRouter chat model. Uses Expo's fetch, which streams response bodies
 * (React Native's fetch doesn't). No app name or URL headers: nothing about
 * the user or the app is sent beyond the conversation itself.
 */
export function openRouterModel(apiKey: string, model: string): LanguageModel {
  const provider = createOpenRouter({
    apiKey,
    compatibility: 'strict',
    fetch: expoFetch as unknown as typeof globalThis.fetch,
  });
  return provider.chat(model);
}
