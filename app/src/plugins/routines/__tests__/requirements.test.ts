import { permissionById } from '@/core/permissions';
import { requiredPermissions, usesNetwork } from '../requirements';
import type { Action, Trigger } from '../types';

const car: Trigger = { kind: 'bluetooth', event: 'connected', device: { address: '4C:11:22:33:44:9A', name: 'Carro' } };
const spotify: Action = { kind: 'open_app', packageName: 'com.spotify.music', label: 'Spotify' };

describe('requiredPermissions', () => {
  it('lists the trigger permissions first, then the actions, without repeats', () => {
    expect(requiredPermissions({ trigger: car, actions: [spotify, { kind: 'open_url', url: 'spotify:home' }] })).toEqual([
      'nearby_devices',
      'background_launch',
    ]);
    expect(
      requiredPermissions({ trigger: { kind: 'place', event: 'enter', placeId: 'home' }, actions: [{ kind: 'notify', text: 'Oi' }] }),
    ).toEqual(['fine_location', 'background_location', 'notifications']);
  });

  it('asks Do Not Disturb access only for silent and DND', () => {
    const mode = (m: 'normal' | 'vibrate' | 'silent' | 'dnd') =>
      requiredPermissions({ trigger: { kind: 'time', at: '22:00', days: [] }, actions: [{ kind: 'sound_mode', mode: m }] });
    expect(mode('normal')).toEqual(['exact_alarms']);
    expect(mode('vibrate')).toEqual(['exact_alarms']);
    expect(mode('silent')).toEqual(['exact_alarms', 'dnd_access']);
    expect(mode('dnd')).toEqual(['exact_alarms', 'dnd_access']);
  });

  it('only points to permissions that exist in the catalog', () => {
    const triggers: Trigger[] = [
      car,
      { kind: 'wifi', event: 'connected', ssid: 'Casa' },
      { kind: 'place', event: 'exit', placeId: 'home' },
      { kind: 'time', at: '07:00', days: [] },
      { kind: 'notification', packageName: 'com.nu.production', appLabel: 'Nubank' },
    ];
    const actions: Action[] = [
      spotify,
      { kind: 'notify', text: 'Oi' },
      { kind: 'open_url', url: 'https://spotify.com' },
      { kind: 'sound_mode', mode: 'dnd' },
      { kind: 'ask_agent', prompt: 'Oi', reply: 'notify' },
    ];
    for (const trigger of triggers) {
      for (const id of requiredPermissions({ trigger, actions })) expect(() => permissionById(id)).not.toThrow();
    }
  });
});

describe('usesNetwork', () => {
  it('is true only when a routine asks the agent', () => {
    expect(usesNetwork({ actions: [spotify] })).toBe(false);
    expect(usesNetwork({ actions: [spotify, { kind: 'ask_agent', prompt: 'Registre: {text}', reply: 'silent' }] })).toBe(true);
  });
});
