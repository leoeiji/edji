import type { PermissionId, PermissionStatus } from '@/core/permissions';
import type { Tool } from '@/core/plugin';
import { matchApps, routineTools, TOOL_REPLIES, type RoutinesBackend } from '../tools';
import type { Routine, RoutineDraft } from '../types';

jest.mock('../../../../modules/edji-assistant', () => ({ EdjiAssistant: null }));

const ctx = {} as never;
const car = { kind: 'bluetooth', event: 'connected', device: { address: '4C:11:22:33:44:9A', name: 'Carro' } };
const spotify = { kind: 'open_app', packageName: 'com.spotify.music', label: 'Spotify' };

function fakeBackend(granted: PermissionId[] = [], agentAllowed = false) {
  const routines: Routine[] = [];
  const backend: jest.Mocked<RoutinesBackend> = {
    listRoutines: jest.fn(async () => routines),
    saveRoutine: jest.fn(async (draft: RoutineDraft) => {
      const r: Routine = { ...draft, id: `r${routines.length + 1}`, enabled: true, createdBy: 'agent', createdAt: 0, updatedAt: 0, lastRunAt: null };
      routines.push(r);
      return r;
    }),
    deleteRoutine: jest.fn(async (id: string) => routines.some((r) => r.id === id)),
    setRoutineEnabled: jest.fn(async (id: string, _enabled: boolean) => routines.some((r) => r.id === id)),
    listPlaces: jest.fn(async () => [{ id: 'p1', name: 'Casa', latitude: 0, longitude: 0, radiusM: 150 }]),
    savePlaceHere: jest.fn(async (name: string) => ({ id: 'p2', name, latitude: 1, longitude: 2, radiusM: 150 })),
    listBluetoothDevices: jest.fn(async () => [{ name: 'Carro', address: '4C:11:22:33:44:9A' }]),
    currentWifi: jest.fn(async () => ({ ssid: 'CasaNet' })),
    listLaunchableApps: jest.fn(async () => [
      { packageName: 'com.spotify.music', label: 'Spotify' },
      { packageName: 'com.nu.production', label: 'Nubank' },
    ]),
    permissionStatus: jest.fn((ids: PermissionId[]) =>
      Object.fromEntries(ids.map((id) => [id, granted.includes(id) ? 'granted' : 'denied'])) as Record<PermissionId, PermissionStatus>,
    ),
    isRoutinesAgentAllowed: jest.fn(() => agentAllowed),
  };
  return { backend, routines };
}

const toolsWith = (backend: RoutinesBackend | null) => Object.fromEntries(routineTools(() => backend).map((t) => [t.name, t])) as Record<string, Tool>;

describe('routines tools', () => {
  it('creates "quando eu entrar no carro, abre o Spotify" and reads it back', async () => {
    const { backend } = fakeBackend(['nearby_devices', 'background_launch']);
    const tools = toolsWith(backend);
    const result = await tools['routines.create'].run({ routine: { name: 'Spotify no carro', trigger: car, actions: [spotify] } }, ctx);
    expect(result).toEqual({ ok: true, reply: 'Rotina "Spotify no carro" criada e ativa (id r1): Ao conectar em Carro, abrir Spotify.' });
    expect((await tools['routines.list'].run({}, ctx)).reply).toBe('r1 · Spotify no carro · ativa · Ao conectar em Carro, abrir Spotify.');
  });

  it('says which permissions are missing after creating', async () => {
    const { backend } = fakeBackend();
    const result = await toolsWith(backend)['routines.create'].run(
      { routine: { name: 'Chegar em casa', trigger: { kind: 'place', event: 'enter', placeId: 'p1' }, actions: [{ kind: 'notify', text: 'Oi' }] } },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.reply).toContain('Ao chegar em Casa, avisar “Oi”.');
    expect(result.reply).toContain('Falta permitir localização precisa, localização o tempo todo e notificações. Abra Permissões.');
  });

  it('warns about the opt-in when the routine asks the agent', async () => {
    const { backend } = fakeBackend(['notification_access']);
    const result = await toolsWith(backend)['routines.create'].run(
      {
        routine: {
          name: 'Gastos do banco',
          trigger: { kind: 'notification', packageName: 'com.nu.production', appLabel: 'Nubank' },
          actions: [{ kind: 'ask_agent', prompt: 'Registre: {text}', reply: 'silent' }],
        },
      },
      ctx,
    );
    expect(result.reply).toContain(TOOL_REPLIES.optInOff);
  });

  it('refuses an invalid routine without saving it', async () => {
    const { backend } = fakeBackend();
    const result = await toolsWith(backend)['routines.create'].run({ routine: { name: 'Carro', trigger: car, actions: [] } }, ctx);
    expect(result).toEqual({ ok: false, reply: 'A rotina precisa de pelo menos uma ação.' });
    expect(backend.saveRoutine).not.toHaveBeenCalled();
  });

  it('relays the native reason when saving fails', async () => {
    const { backend } = fakeBackend();
    backend.saveRoutine.mockRejectedValueOnce(new Error('Não conheço esse lugar. Salve o lugar antes.'));
    const result = await toolsWith(backend)['routines.create'].run({ routine: { name: 'Carro', trigger: car, actions: [spotify] } }, ctx);
    expect(result).toEqual({ ok: false, reply: 'Não conheço esse lugar. Salve o lugar antes.' });
  });

  it('enables, disables and deletes by id, and reports unknown ids', async () => {
    const { backend } = fakeBackend();
    const tools = toolsWith(backend);
    await tools['routines.create'].run({ routine: { name: 'Carro', trigger: car, actions: [spotify] } }, ctx);
    expect(await tools['routines.set_enabled'].run({ id: 'r1', enabled: false }, ctx)).toEqual({ ok: true, reply: 'Rotina desativada.' });
    expect(backend.setRoutineEnabled).toHaveBeenCalledWith('r1', false);
    expect(await tools['routines.delete'].run({ id: 'r9' }, ctx)).toEqual({ ok: false, reply: TOOL_REPLIES.notFound });
    expect(await tools['routines.delete'].run({ id: 'r1' }, ctx)).toEqual({ ok: true, reply: 'Rotina apagada.' });
  });

  it('finds apps, paired devices, the current Wi-Fi and saved places', async () => {
    const { backend } = fakeBackend(['nearby_devices']);
    const tools = toolsWith(backend);
    expect((await tools['routines.find_app'].run({ query: 'spotif' }, ctx)).reply).toBe('Spotify — com.spotify.music');
    expect((await tools['routines.find_target'].run({ kind: 'bluetooth' }, ctx)).reply).toBe('Carro — 4C:11:22:33:44:9A');
    expect((await tools['routines.find_target'].run({ kind: 'wifi' }, ctx)).reply).toBe('Wi-Fi atual: CasaNet');
    expect((await tools['routines.find_target'].run({ kind: 'place' }, ctx)).reply).toBe('Casa — p1');
  });

  it('asks for the nearby devices permission before listing Bluetooth devices', async () => {
    const { backend } = fakeBackend();
    const result = await toolsWith(backend)['routines.find_target'].run({ kind: 'bluetooth' }, ctx);
    expect(result).toEqual({ ok: false, reply: 'Falta permitir aparelhos por perto. Abra Permissões.' });
    expect(backend.listBluetoothDevices).not.toHaveBeenCalled();
  });

  it('saves "salva aqui como casa" as a place', async () => {
    const { backend } = fakeBackend(['fine_location']);
    expect(await toolsWith(backend)['routines.save_place'].run({ name: 'Academia' }, ctx)).toEqual({
      ok: true,
      reply: 'Lugar "Academia" salvo (id p2).',
    });
  });

  it('explains that routines need the Android app', async () => {
    expect(await toolsWith(null)['routines.list'].run({}, ctx)).toEqual({ ok: false, reply: TOOL_REPLIES.unavailable });
  });
});

describe('matchApps', () => {
  const apps = [{ label: 'Música' }, { label: 'YouTube Music' }, { label: 'Spotify' }];

  it('ignores case and accents and puts exact matches first', () => {
    expect(matchApps(apps, 'music').map((a) => a.label)).toEqual(['Música', 'YouTube Music']);
    expect(matchApps(apps, 'musica').map((a) => a.label)).toEqual(['Música']);
    expect(matchApps(apps, 'SPOTIFY').map((a) => a.label)).toEqual(['Spotify']);
    expect(matchApps(apps, '  ')).toEqual([]);
  });
});
