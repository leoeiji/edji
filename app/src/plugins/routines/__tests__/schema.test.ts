import { DRAFT_ERRORS, parseRoutineDraft } from '../schema';

const ctx = { placeIds: ['home'] };
const car = { kind: 'bluetooth', event: 'connected', device: { address: '4c:11:22:33:44:9a', name: 'Carro' } };
const spotify = { kind: 'open_app', packageName: 'com.spotify.music', label: 'Spotify' };
const nubank = { kind: 'notification', packageName: 'com.nu.production', appLabel: 'Nubank' };

const reason = (input: unknown) => {
  const r = parseRoutineDraft(input, ctx);
  return r.ok ? null : r.reason;
};

describe('parseRoutineDraft', () => {
  it('accepts "quando eu entrar no carro, abre o Spotify" and normalizes it', () => {
    const r = parseRoutineDraft({ name: '  Spotify no carro ', trigger: car, actions: [spotify], extra: 1 }, ctx);
    expect(r).toEqual({
      ok: true,
      draft: {
        name: 'Spotify no carro',
        trigger: { kind: 'bluetooth', event: 'connected', device: { address: '4C:11:22:33:44:9A', name: 'Carro' } },
        actions: [{ kind: 'open_app', packageName: 'com.spotify.music', label: 'Spotify' }],
      },
    });
  });

  it('accepts "quando eu chegar em casa, coloca o som no normal e me avisa"', () => {
    const r = parseRoutineDraft(
      {
        name: 'Chegar em casa',
        trigger: { kind: 'place', event: 'enter', placeId: 'home' },
        actions: [
          { kind: 'sound_mode', mode: 'normal' },
          { kind: 'notify', text: 'Bem-vindo' },
        ],
      },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  it('accepts a bank notification routine that asks the agent with the notification text', () => {
    const r = parseRoutineDraft(
      { name: 'Gastos do Nubank', trigger: nubank, actions: [{ kind: 'ask_agent', prompt: 'Registre: {title} — {text}', reply: 'silent' }] },
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  it('sorts and dedupes weekdays, and no days means every day', () => {
    const r = parseRoutineDraft({ name: 'Bom dia', trigger: { kind: 'time', at: '07:00', days: [5, 1, 3, 1] }, actions: [spotify] }, ctx);
    expect(r.ok && r.draft.trigger).toEqual({ kind: 'time', at: '07:00', days: [1, 3, 5] });
    const every = parseRoutineDraft({ name: 'Bom dia', trigger: { kind: 'time', at: '07:00' }, actions: [spotify] }, ctx);
    expect(every.ok && every.draft.trigger).toEqual({ kind: 'time', at: '07:00', days: [] });
  });

  it('keeps an optional notification filter and drops an empty one', () => {
    const withFilter = parseRoutineDraft({ name: 'Pix', trigger: { ...nubank, textContains: ' Pix ' }, actions: [spotify] }, ctx);
    expect(withFilter.ok && withFilter.draft.trigger).toEqual({ ...nubank, textContains: 'Pix' });
    const empty = parseRoutineDraft({ name: 'Pix', trigger: { ...nubank, textContains: '' }, actions: [spotify] }, ctx);
    expect(empty.ok && empty.draft.trigger).toEqual(nubank);
  });

  it('requires a name', () => {
    expect(reason({ name: '  ', trigger: car, actions: [spotify] })).toBe(DRAFT_ERRORS.noName);
    expect(reason({ name: 'x'.repeat(61), trigger: car, actions: [spotify] })).toBe(DRAFT_ERRORS.longName);
  });

  it('rejects unknown kinds of trigger and action', () => {
    expect(reason({ name: 'Auto', trigger: { kind: 'car', event: 'enter' }, actions: [spotify] })).toBe(DRAFT_ERRORS.unknownTrigger);
    expect(reason({ name: 'Wi-Fi', trigger: car, actions: [{ kind: 'wifi_off' }] })).toBe(DRAFT_ERRORS.unknownAction);
    expect(reason('abre o Spotify')).toBe(DRAFT_ERRORS.notObject);
  });

  it('needs between one and five actions', () => {
    expect(reason({ name: 'Nada', trigger: car, actions: [] })).toBe(DRAFT_ERRORS.noActions);
    expect(reason({ name: 'Muito', trigger: car, actions: Array(6).fill(spotify) })).toBe(DRAFT_ERRORS.tooManyActions);
  });

  it('rejects a place that was never saved', () => {
    expect(reason({ name: 'Academia', trigger: { kind: 'place', event: 'enter', placeId: 'gym' }, actions: [spotify] })).toBe(
      DRAFT_ERRORS.unknownPlace,
    );
  });

  it('rejects invalid times, days and Bluetooth addresses', () => {
    expect(reason({ name: 'Tarde', trigger: { kind: 'time', at: '24:00' }, actions: [spotify] })).toBe(DRAFT_ERRORS.badTime);
    expect(reason({ name: 'Tarde', trigger: { kind: 'time', at: '7:00' }, actions: [spotify] })).toBe(DRAFT_ERRORS.badTime);
    expect(reason({ name: 'Tarde', trigger: { kind: 'time', at: '07:00', days: [0] }, actions: [spotify] })).toBe(DRAFT_ERRORS.badDays);
    expect(reason({ name: 'Carro', trigger: { ...car, device: { address: 'Carro', name: 'Carro' } }, actions: [spotify] })).toBe(
      DRAFT_ERRORS.badDevice,
    );
    expect(reason({ name: 'Carro', trigger: { ...car, event: 'near' }, actions: [spotify] })).toBe(DRAFT_ERRORS.badEvent);
  });

  it('opens only https links and app deep links', () => {
    const link = (url: string) => reason({ name: 'Link', trigger: car, actions: [{ kind: 'open_url', url }] });
    expect(link('https://open.spotify.com/playlist/37i9')).toBeNull();
    expect(link('spotify:playlist:37i9')).toBeNull();
    for (const bad of ['http://example.com', 'intent://x#Intent;end', 'file:///sdcard/a', 'javascript:alert(1)', 'https://', 'nada']) {
      expect(link(bad)).toBe(DRAFT_ERRORS.badUrl);
    }
  });

  it('rejects prompt variables the trigger does not offer', () => {
    const r = reason({ name: 'Carro', trigger: car, actions: [{ kind: 'ask_agent', prompt: 'Resuma {text}', reply: 'notify' }] });
    expect(r).toBe('O pedido usa {text}, que esse gatilho não tem.');
  });

  it('rejects an unknown sound mode and an app without a package', () => {
    expect(reason({ name: 'Som', trigger: car, actions: [{ kind: 'sound_mode', mode: 'loud' }] })).toBe(DRAFT_ERRORS.badSoundMode);
    expect(reason({ name: 'App', trigger: car, actions: [{ kind: 'open_app', packageName: 'Spotify', label: 'Spotify' }] })).toBe(
      DRAFT_ERRORS.noApp,
    );
  });
});
