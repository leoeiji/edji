import * as SecureStore from 'expo-secure-store';

/** Model provider settings. Both live in the Android Keystore-backed secure store, never in `edji.db`. */
export type ModelSettings = { apiKey: string | null; model: string | null };

const API_KEY = 'openrouter_api_key';
const MODEL = 'openrouter_model';

export async function loadModelSettings(): Promise<ModelSettings> {
  const [apiKey, model] = await Promise.all([SecureStore.getItemAsync(API_KEY), SecureStore.getItemAsync(MODEL)]);
  return { apiKey: clean(apiKey), model: clean(model) };
}

/** Saves the API key; an empty value removes it, which turns the network off again. */
export function saveApiKey(value: string): Promise<void> {
  return save(API_KEY, value);
}

export function saveModel(value: string): Promise<void> {
  return save(MODEL, value);
}

function save(key: string, value: string): Promise<void> {
  const v = clean(value);
  return v ? SecureStore.setItemAsync(key, v) : SecureStore.deleteItemAsync(key);
}

function clean(value: string | null): string | null {
  const v = value?.trim();
  return v ? v : null;
}
