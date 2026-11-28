import type { Tool } from '@/core/plugin';
import { DRAFT_ERRORS, parseRoutineDraft } from '../schema';

/** A routine-action tool shaped like `finance.add`, and one that isn't a routine action. */
const addExpense: Pick<Tool, 'name' | 'parameters' | 'routineAction'> = {
  name: 'finance.add',
  routineAction: true,
  parameters: {
    type: 'object',
    properties: {
      amount: { type: 'number' },
      direction: { type: 'string', enum: ['out', 'in'] },
      description: { type: 'string' },
      dedupKey: { type: 'string' },
    },
    required: ['amount', 'direction', 'description'],
  },
};
const summary: Pick<Tool, 'name' | 'parameters'> = { name: 'finance.summary', parameters: { type: 'object', properties: {} } };
const ctx = { placeIds: ['home'], tools: [addExpense, summary] };
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
        steps: [],
        actions: [{ kind: 'open_app', packageName: 'com.spotify.music', label: 'Spotify' }],
        examples: [],
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
      {
        name: 'Gastos do Nubank',
        trigger: nubank,
        actions: [{ kind: 'ask_agent', prompt: 'Registre: {input.notification_title} — {input.notification_message}', reply: 'silent' }],
      },
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

  it('drops the old notification filter: filtering by text is a match step now', () => {
    const r = parseRoutineDraft({ name: 'Pix', trigger: { ...nubank, textContains: 'Pix' }, actions: [spotify] }, ctx);
    expect(r.ok && r.draft.trigger).toEqual(nubank);
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

  it('rejects references the trigger does not offer, and old prompt variables', () => {
    const ask = (prompt: string) => reason({ name: 'Carro', trigger: car, actions: [{ kind: 'ask_agent', prompt, reply: 'notify' }] });
    expect(ask('Resuma {input.notification_message}')).toBe(
      'A referência {input.notification_message}, usada em o pedido ao agente, não existe ou vem depois.',
    );
    expect(ask('Resuma {text}')).toBe('A referência {text}, usada em o pedido ao agente, não existe ou vem depois.');
    expect(ask('Conectou em {input.device_name}')).toBeNull();
  });

  it('rejects an unknown sound mode and an app without a package', () => {
    expect(reason({ name: 'Som', trigger: car, actions: [{ kind: 'sound_mode', mode: 'loud' }] })).toBe(DRAFT_ERRORS.badSoundMode);
    expect(reason({ name: 'App', trigger: car, actions: [{ kind: 'open_app', packageName: 'Spotify', label: 'Spotify' }] })).toBe(
      DRAFT_ERRORS.noApp,
    );
  });
});

describe('steps, references and run_tool', () => {
  const ref = (path: string) => ({ ref: path });
  /** Made-up message format, as the agent would write from an example the user gave. */
  const extract = {
    id: 'extract_from_message',
    kind: 'extract',
    input: { text: ref('input.notification_message') },
    pattern: 'Compra de R\\$ ?(?<value>[\\d.,]+) aprovada em (?<merchant>.+?)\\.?$',
  };
  const amount = { id: 'amount', kind: 'number', input: { text: ref('extract_from_message.output.value') }, format: 'pt-BR' };
  const add = {
    kind: 'run_tool',
    tool: 'finance.add',
    input: {
      amount: ref('amount.output.value'),
      description: ref('extract_from_message.output.merchant'),
      direction: 'out',
      dedupKey: ref('input.notification_id'),
    },
  };
  const routine = (extra: Record<string, unknown>) => ({ name: 'Gastos', trigger: nubank, steps: [extract, amount], actions: [add], ...extra });

  it('accepts "quando chegar compra do banco, registra o gasto" with defaults filled in', () => {
    const r = parseRoutineDraft(routine({}), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.steps[0]).toMatchObject({ id: 'extract_from_message', onNoMatch: 'fail' });
    expect(r.draft.actions[0]).toEqual(add);
  });

  it('defaults match to skip, so ads and other notifications stop quietly', () => {
    const match = { id: 'only_purchases', kind: 'match', input: { text: ref('input.notification_message') }, contains: ' compra ' };
    const r = parseRoutineDraft(routine({ steps: [match, extract, amount] }), ctx);
    expect(r.ok && r.draft.steps[0]).toEqual({ ...match, contains: 'compra', onNoMatch: 'skip' });
  });

  it('rejects references that do not exist or come later', () => {
    expect(reason(routine({ steps: [amount, extract] }))).toBe(
      'A referência extract_from_message.output.value, usada em a entrada da etapa amount, não existe ou vem depois.',
    );
    expect(reason(routine({ actions: [{ ...add, input: { ...add.input, amount: ref('amount.output.total') } }] }))).toBe(
      'A referência amount.output.total, usada em amount de finance.add, não existe ou vem depois.',
    );
  });

  it('rejects bad step ids, repeated ids and non snake_case groups', () => {
    expect(reason(routine({ steps: [{ ...extract, id: 'Extract' }] }))).toBe(DRAFT_ERRORS.badStepId);
    expect(reason(routine({ steps: [{ ...extract, id: 'input' }] }))).toBe(DRAFT_ERRORS.badStepId);
    expect(reason(routine({ steps: [extract, extract, amount] }))).toBe('O id de etapa extract_from_message se repete.');
    expect(reason(routine({ steps: [{ ...extract, pattern: '(?<merchantName>.+)' }], actions: [spotify] }))).toBe(
      'Use nomes de grupo em snake_case na etapa extract_from_message, ex.: (?<value>...).',
    );
  });

  it('checks run_tool against the tool schema', () => {
    const withInput = (input: Record<string, unknown>) => reason(routine({ actions: [{ ...add, input }] }));
    expect(withInput({ ...add.input, amount: ref('extract_from_message.output.value') })).toBe(
      'O parâmetro amount de finance.add espera número, mas recebe texto.',
    );
    expect(withInput({ ...add.input, direction: 'saída' })).toBe('O parâmetro direction de finance.add aceita só: out, in.');
    expect(withInput({ ...add.input, category: 'mercado' })).toBe('O tool finance.add não tem o parâmetro category.');
    const { description: _, ...noDescription } = add.input;
    expect(withInput(noDescription)).toBe('Falta o parâmetro description de finance.add.');
  });

  it('only calls routine actions of enabled plugins, never routines tools', () => {
    expect(reason(routine({ actions: [{ ...add, tool: 'finance.summary' }] }))).toBe(DRAFT_ERRORS.notRoutineTool);
    expect(reason(routine({ actions: [{ ...add, tool: 'routines.delete' }] }))).toBe(DRAFT_ERRORS.notRoutineTool);
    expect(reason(routine({ actions: [{ ...add, tool: 'agenda.add' }] }))).toBe('O tool agenda.add não existe ou o plugin dele está desligado.');
  });

  it('keeps a literal with dots as a literal', () => {
    const r = parseRoutineDraft(routine({ actions: [{ ...add, input: { ...add.input, description: 'amount.output.value' } }] }), ctx);
    expect(r.ok && r.draft.actions[0]).toMatchObject({ input: { description: 'amount.output.value' } });
  });

  it('validates examples against the trigger outputs and the step outputs', () => {
    const good = { input: { notification_message: 'Compra de R$ 45,90 aprovada em CAFÉ' }, outputs: { 'amount.output.value': 45.9 } };
    const ad = { input: { notification_message: 'Fatura fechou' }, skip: true };
    const r = parseRoutineDraft(routine({ examples: [good, ad] }), ctx);
    expect(r.ok && r.draft.examples).toEqual([good, ad]);
    expect(reason(routine({ examples: [{ input: { ssid: 'x' } }] }))).toContain('O exemplo 1 usa ssid, que esse gatilho não tem.');
    expect(reason(routine({ examples: [{ input: {}, outputs: { 'amount.output.total': 1 } }] }))).toBe(
      'O exemplo 1 espera amount.output.total, que a rotina não produz.',
    );
  });
});
