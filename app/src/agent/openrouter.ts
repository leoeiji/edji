import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import { fetch as expoFetch } from 'expo/fetch';

/**
 * OpenRouter chat model. Uses Expo's fetch, which streams response bodies
 * (React Native's fetch doesn't). No app name or URL headers: nothing about
 * the user or the app is sent beyond the conversation itself. Usage
 * accounting is asked for explicitly, so the last chunk carries the cost and
 * the upstream provider for the usage metrics (ADR 0008); it is part of the
 * same response, not another request.
 */
export function openRouterModel(apiKey: string, model: string): LanguageModel {
  const provider = createOpenRouter({
    apiKey,
    compatibility: 'strict',
    fetch: expoFetch as unknown as typeof globalThis.fetch,
  });
  return provider.chat(model, { usage: { include: true } });
}

let modelList: Promise<unknown> | null = null;

/**
 * OpenRouter's public model list, fetched once per app run. It needs no key
 * and carries nothing of the user's; it only runs when someone attaches an
 * image (ADR 0009). A failure is not cached, so the next attach retries.
 */
export function fetchOpenRouterModels(): Promise<unknown> {
  modelList ??= expoFetch('https://openrouter.ai/api/v1/models')
    .then((res) => {
      if (!res.ok) throw new Error(`models ${res.status}`);
      return res.json();
    })
    .catch((e: unknown) => {
      modelList = null;
      throw e;
    });
  return modelList;
}
