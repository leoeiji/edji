import type { PermissionId, PermissionStatus } from '@/core/permissions';
import type { PluginContext, Tool } from '@/core/plugin';
import { matchApps, routineTools, TOOL_REPLIES, type RoutinesBackend } from '../tools';
import type { RetryResult, Routine, RoutineDraft, RoutineFailure, TestCaseResult } from '../types';

jest.mock('../../../../modules/edji-assistant', () => ({ EdjiAssistant: null }));

const addExpense: Tool = {
  name: 'finance.add',
  description: '',
  routineAction: true,
  parameters: {
    type: 'object',
    properties: { amount: { type: 'number' }, direction: { type: 'string', enum: ['out', 'in'] }, description: { type: 'string' } },
    required: ['amount', 'direction', 'description'],
  },
  run: async () => ({ ok: true, reply: 'Anotado.' }),
};
const ctx = { enabledTools: async () => [addExpense] } as unknown as PluginContext;
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
    updateRoutine: jest.fn(async (id: string, draft: RoutineDraft) => {
      const i = routines.findIndex((r) => r.id === id);
      if (i < 0) return null;
      routines[i] = { ...routines[i], ...draft };
      return routines[i];
    }),
    testRoutine: jest.fn(async (_draft: RoutineDraft, _samples: Record<string, string>[], _ids: number[]): Promise<TestCaseResult[]> => []),
    activeNotifications: jest.fn(async (_packageName: string) => [] as Record<string, string>[]),
    listFailures: jest.fn(async (_routineId: string | null) => failures),
    retryFailure: jest.fn(async (_id: number): Promise<RetryResult | null> => null),
    discardFailure: jest.fn(async (id: number) => failures.some((f) => f.id === id)),
  };
  return { backend, routines, failures };
}

const failures: RoutineFailure[] = [];

/** "Quando chegar notificação do banco, registra o gasto", with steps the agent wrote from an example. */
const expenseRoutine = {
  name: 'Gastos do banco',
  trigger: { kind: 'notification', packageName: 'com.example.bank', appLabel: 'Banco' },
  steps: [
    {
      id: 'extract_from_message',
      kind: 'extract',
      input: { text: { ref: 'input.notification_message' } },
      pattern: 'Compra de R\\$ ?(?<value>[\\d.,]+) em (?<merchant>.+)',
    },
    { id: 'amount', kind: 'number', input: { text: { ref: 'extract_from_message.output.value' } }, format: 'pt-BR' },
  ],
  actions: [
    {
      kind: 'run_tool',
      tool: 'finance.add',
      input: { amount: { ref: 'amount.output.value' }, description: { ref: 'extract_from_message.output.merchant' }, direction: 'out' },
    },
  ],
};

beforeEach(() => {
  failures.length = 0;
});

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
          actions: [{ kind: 'ask_agent', prompt: 'Registre: {input.notification_message}', reply: 'silent' }],
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

  it('creates a routine with steps and a tool action, with no opt-in needed', async () => {
    const { backend } = fakeBackend(['notification_access']);
    const result = await toolsWith(backend)['routines.create'].run({ routine: expenseRoutine }, ctx);
    expect(result).toEqual({
      ok: true,
      reply: 'Rotina "Gastos do banco" criada e ativa (id r1): Ao chegar notificação do Banco, executar finance.add.',
    });
    expect(backend.saveRoutine.mock.calls[0][0].steps.map((s) => s.id)).toEqual(['extract_from_message', 'amount']);
  });

  it('updates a routine in place and reports unknown ids', async () => {
    const { backend } = fakeBackend(['notification_access']);
    const tools = toolsWith(backend);
    await tools['routines.create'].run({ routine: expenseRoutine }, ctx);
    const fixed = { ...expenseRoutine, steps: [{ ...expenseRoutine.steps[0], pattern: 'Compra (?<value>[\\d.,]+) (?<merchant>.+)' }, expenseRoutine.steps[1]] };
    expect((await tools['routines.update'].run({ id: 'r1', routine: fixed }, ctx)).reply).toMatch(/^Rotina "Gastos do banco" alterada \(id r1\)/);
    expect(backend.updateRoutine).toHaveBeenCalledWith('r1', expect.objectContaining({ name: 'Gastos do banco' }));
    expect(await tools['routines.update'].run({ id: 'r9', routine: fixed }, ctx)).toEqual({ ok: false, reply: TOOL_REPLIES.notFound });
  });

  it('dry-runs a draft on samples and failures and reports each case', async () => {
    const { backend } = fakeBackend();
    backend.testRoutine.mockResolvedValueOnce([
      {
        label: 'amostra 1',
        outcome: 'run',
        values: { 'amount.output.value': 45.9, 'extract_from_message.output.merchant': 'CAFÉ' },
        actions: [{ kind: 'run_tool', tool: 'finance.add', input: { amount: 45.9, description: 'CAFÉ', direction: 'out' } }],
      },
      { label: 'falha 3', outcome: 'fail', step: 'extract_from_message', reason: 'Etapa extract_from_message: a regex não encontrou nada.' },
      { label: 'amostra 2', outcome: 'skip', step: 'only_purchases' },
    ]);
    const result = await toolsWith(backend)['routines.test'].run(
      { routine: expenseRoutine, samples: [{ notification_message: 'Compra de R$ 45,90 em CAFÉ' }], failureIds: [3] },
      ctx,
    );
    expect(backend.testRoutine).toHaveBeenCalledWith(expect.objectContaining({ name: 'Gastos do banco' }), [{ notification_message: 'Compra de R$ 45,90 em CAFÉ' }], [3]);
    expect(result.ok).toBe(false);
    expect(result.reply.split('\n')).toEqual([
      'amostra 1: passou · amount.output.value = 45.9 · extract_from_message.output.merchant = "CAFÉ" · finance.add({"amount":45.9,"description":"CAFÉ","direction":"out"})',
      'falha 3: FALHOU — Etapa extract_from_message: a regex não encontrou nada.',
      'amostra 2: ignorado na etapa only_purchases',
    ]);
  });

  it('does not test an invalid draft on the device', async () => {
    const { backend } = fakeBackend();
    const result = await toolsWith(backend)['routines.test'].run({ routine: { ...expenseRoutine, steps: [] } }, ctx);
    expect(result.ok).toBe(false);
    expect(result.reply).toContain('não existe ou vem depois');
    expect(backend.testRoutine).not.toHaveBeenCalled();
  });

  it('reads the notifications on screen as samples', async () => {
    const { backend } = fakeBackend();
    expect((await toolsWith(backend)['routines.sample_notifications'].run({ packageName: 'com.example.bank' }, ctx)).reply).toBe(
      TOOL_REPLIES.noSamples,
    );
    backend.activeNotifications.mockResolvedValueOnce([{ notification_title: 'Banco', notification_message: 'Compra de R$ 7,50 em PÃO' }]);
    expect((await toolsWith(backend)['routines.sample_notifications'].run({ packageName: 'com.example.bank' }, ctx)).reply).toBe(
      '1. {"notification_title":"Banco","notification_message":"Compra de R$ 7,50 em PÃO"}',
    );
  });

  it('lists failures with their stored input, retries and discards them', async () => {
    const { backend } = fakeBackend(['notification_access']);
    const tools = toolsWith(backend);
    await tools['routines.create'].run({ routine: expenseRoutine }, ctx);
    expect((await tools['routines.list_failures'].run({}, ctx)).reply).toBe(TOOL_REPLIES.noFailures);
    failures.push({
      id: 3,
      routineId: 'r1',
      failedAt: new Date(2020, 0, 2, 8, 12).getTime(),
      stage: 'step',
      where: 'extract_from_message',
      reason: 'Etapa extract_from_message: a regex não encontrou nada.',
      input: { notification_message: 'Pix recebido de FULANO: R$ 10,00' },
    });
    expect((await tools['routines.list_failures'].run({}, ctx)).reply).toBe(
      'falha 3 · Gastos do banco (r1) · 2 jan, 08:12 · Etapa extract_from_message: a regex não encontrou nada. · entrada: {"notification_message":"Pix recebido de FULANO: R$ 10,00"}',
    );
    expect((await tools['routines.list'].run({}, ctx)).reply).toContain('2 etapa(s) · 1 falha(s) aberta(s)');

    backend.retryFailure.mockResolvedValueOnce({ outcome: 'done', detail: 'Na fila: finance.add' });
    expect(await tools['routines.retry_failure'].run({ id: 3 }, ctx)).toEqual({ ok: true, reply: 'Reprocessada: Na fila: finance.add.' });
    backend.retryFailure.mockResolvedValueOnce({ outcome: 'failed', detail: 'Etapa amount: o texto não é um número.' });
    expect((await tools['routines.retry_failure'].run({ id: 3 }, ctx)).reply).toBe(
      'Ainda falha: Etapa amount: o texto não é um número. A falha voltou para a lista.',
    );
    expect(await tools['routines.retry_failure'].run({ id: 99 }, ctx)).toEqual({ ok: false, reply: TOOL_REPLIES.failureNotFound });
    expect(await tools['routines.discard_failure'].run({ id: 3 }, ctx)).toEqual({ ok: true, reply: 'Falha descartada.' });
    expect(await tools['routines.discard_failure'].run({ id: 99 }, ctx)).toEqual({ ok: false, reply: TOOL_REPLIES.failureNotFound });
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
