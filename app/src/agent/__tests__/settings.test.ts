import * as SecureStore from 'expo-secure-store';
import { loadModelSettings, saveApiKey, saveModel } from '../settings';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});

describe('model settings', () => {
  it('saves trimmed values and reads them back', async () => {
    await saveApiKey('  sk-or-abc  ');
    await saveModel(' autor/modelo ');
    expect(await loadModelSettings()).toEqual({ apiKey: 'sk-or-abc', model: 'autor/modelo' });
  });

  it('an empty key deletes it, turning the network off again', async () => {
    await saveApiKey('sk-or-abc');
    await saveApiKey('   ');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('openrouter_api_key');
    expect((await loadModelSettings()).apiKey).toBeNull();
  });

  it('treats a blank stored value as missing', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('').mockResolvedValueOnce(' ');
    expect(await loadModelSettings()).toEqual({ apiKey: null, model: null });
  });
});
