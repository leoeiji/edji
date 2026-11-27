import { MAX_CATEGORY_LENGTH, parseCategoryName, parseMonth, parseTransaction, TX_ERRORS } from '../transaction';

const NOW = Date.UTC(2026, 10, 26, 12, 0);

describe('parseTransaction', () => {
  it('accepts a purchase pulled from a notification by a routine', () => {
    const r = parseTransaction(
      { amount: 45.9, direction: 'out', description: '  PADARIA   X ', account: 'Banco', occurredAt: '2026-11-26T10:30:00Z', dedupKey: 'k|1' },
      'routine',
      NOW,
    );
    expect(r).toEqual({
      ok: true,
      tx: {
        amountCents: 4590,
        direction: 'out',
        description: 'PADARIA X',
        account: 'Banco',
        occurredAt: Date.UTC(2026, 10, 26, 10, 30),
        source: 'routine',
        dedupKey: 'k|1',
      },
    });
  });

  it('accepts "gastei 30 reais no almoço" by voice, dated now', () => {
    const r = parseTransaction({ amount: 30, direction: 'out', description: 'almoço' }, 'agent', NOW);
    expect(r.ok && r.tx).toMatchObject({ amountCents: 3000, occurredAt: NOW, account: null, dedupKey: null, source: 'agent' });
  });

  it('rejects what a broken pattern could hand over', () => {
    const base = { amount: 10, direction: 'out', description: 'x' };
    expect(parseTransaction({ ...base, amount: '10,00' }, 'routine', NOW)).toEqual({ ok: false, reason: TX_ERRORS.badAmount });
    expect(parseTransaction({ ...base, amount: 0 }, 'routine', NOW)).toEqual({ ok: false, reason: TX_ERRORS.badAmount });
    expect(parseTransaction({ ...base, amount: -5 }, 'routine', NOW)).toEqual({ ok: false, reason: TX_ERRORS.badAmount });
    expect(parseTransaction({ ...base, amount: Number.NaN }, 'routine', NOW)).toEqual({ ok: false, reason: TX_ERRORS.badAmount });
    expect(parseTransaction({ ...base, direction: 'saída' }, 'routine', NOW)).toEqual({ ok: false, reason: TX_ERRORS.badDirection });
    expect(parseTransaction({ ...base, description: '   ' }, 'routine', NOW)).toEqual({ ok: false, reason: TX_ERRORS.noDescription });
    expect(parseTransaction({ ...base, occurredAt: 'ontem' }, 'routine', NOW)).toEqual({ ok: false, reason: TX_ERRORS.badDate });
  });
});

describe('parseMonth', () => {
  it('reads YYYY-MM only', () => {
    expect(parseMonth('2026-11')).toEqual([2026, 11]);
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('novembro')).toBeNull();
  });
});

describe('parseCategoryName', () => {
  it('cleans and capitalizes a category name', () => {
    expect(parseCategoryName('  café   na rua ')).toBe('Café na rua');
    expect(parseCategoryName('Mercado')).toBe('Mercado');
  });

  it('refuses empty or long names', () => {
    expect(parseCategoryName('   ')).toBeNull();
    expect(parseCategoryName(42)).toBeNull();
    expect(parseCategoryName(' sem  categoria ')).toBeNull();
    expect(parseCategoryName('a'.repeat(MAX_CATEGORY_LENGTH + 1))).toBeNull();
  });
});
