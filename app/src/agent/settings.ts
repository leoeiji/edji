import * as SecureStore from 'expo-secure-store';

/**
 * Model provider settings, in the Android Keystore-backed secure store, never
 * in `edji.db`. `model` runs the conversation; `lightModel` is a smaller,
 * cheaper one for quick tasks around it (today: conversation titles).
 */
export type ModelSettings = { apiKey: string | null; model: string | null; lightModel: string | null };

const API_KEY = 'openrouter_api_key';
const MODEL = 'openrouter_model';
const LIGHT_MODEL = 'openrouter_light_model';

export async function loadModelSettings(): Promise<ModelSettings> {
  const [apiKey, model, lightModel] = await Promise.all([
    SecureStore.getItemAsync(API_KEY),
    SecureStore.getItemAsync(MODEL),
    SecureStore.getItemAsync(LIGHT_MODEL),
  ]);
  return { apiKey: clean(apiKey), model: clean(model), lightModel: clean(lightModel) };
}

/** Saves the API key; an empty value removes it, which turns the network off again. */
export function saveApiKey(value: string): Promise<void> {
  return save(API_KEY, value);
}

export function saveModel(value: string): Promise<void> {
  return save(MODEL, value);
}

/** Saves the light model; empty turns the quick tasks off (titles then come from the first words, offline). */
export function saveLightModel(value: string): Promise<void> {
  return save(LIGHT_MODEL, value);
}

function save(key: string, value: string): Promise<void> {
  const v = clean(value);
  return v ? SecureStore.setItemAsync(key, v) : SecureStore.deleteItemAsync(key);
}

function clean(value: string | null): string | null {
  const v = value?.trim();
  return v ? v : null;
}
