import { describeRoutine } from '../describe';
import type { Action, Trigger } from '../types';

const ctx = { placeName: (id: string) => ({ home: 'Casa' })[id] };
const spotify: Action = { kind: 'open_app', packageName: 'com.spotify.music', label: 'Spotify' };
const say = (trigger: Trigger, actions: Action[] = [spotify]) => describeRoutine({ trigger, actions }, ctx);

describe('describeRoutine', () => {
  it('describes the car routine', () => {
    expect(say({ kind: 'bluetooth', event: 'connected', device: { address: '4C:11:22:33:44:9A', name: 'Carro' } })).toBe(
      'Ao conectar em Carro, abrir Spotify.',
    );
  });

  it('joins several actions in Portuguese', () => {
    expect(
      say({ kind: 'place', event: 'enter', placeId: 'home' }, [
        { kind: 'sound_mode', mode: 'normal' },
        { kind: 'notify', text: 'Bem-vindo' },
      ]),
    ).toBe('Ao chegar em Casa, mudar o som para normal e avisar “Bem-vindo”.');
    expect(say({ kind: 'wifi', event: 'disconnected', ssid: 'CasaNet' }, [spotify, spotify, { kind: 'sound_mode', mode: 'dnd' }])).toBe(
      'Ao sair do Wi-Fi CasaNet, abrir Spotify, abrir Spotify e ligar o Não perturbe.',
    );
  });

  it('names a deleted place instead of failing', () => {
    expect(say({ kind: 'place', event: 'exit', placeId: 'gone' })).toBe('Ao sair de um lugar apagado, abrir Spotify.');
  });

  it('describes schedules', () => {
    expect(say({ kind: 'time', at: '07:00', days: [] })).toBe('Todo dia às 07:00, abrir Spotify.');
    expect(say({ kind: 'time', at: '07:00', days: [1, 2, 3, 4, 5] })).toBe('Em dias úteis às 07:00, abrir Spotify.');
    expect(say({ kind: 'time', at: '10:30', days: [6, 7] })).toBe('Nos fins de semana às 10:30, abrir Spotify.');
    expect(say({ kind: 'time', at: '18:00', days: [1, 3, 5] })).toBe('Em seg, qua e sex às 18:00, abrir Spotify.');
  });

  it('describes notification routines and links', () => {
    expect(
      say({ kind: 'notification', packageName: 'com.nu.production', appLabel: 'Nubank' }, [
        { kind: 'ask_agent', prompt: 'Registre: {text}', reply: 'silent' },
      ]),
    ).toBe('Ao chegar notificação do Nubank, perguntar ao agente.');
    expect(
      say({ kind: 'notification', packageName: 'com.nu.production', appLabel: 'Nubank', textContains: 'Pix' }, [
        { kind: 'open_url', url: 'https://www.nubank.com.br/app' },
      ]),
    ).toBe('Ao chegar notificação do Nubank com “Pix”, abrir o link nubank.com.br.');
  });
});
