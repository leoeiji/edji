import type { PluginContext, Tool } from '@/core/plugin';
import { describeCategoryTotals, financeTools } from '../tools';

const NOW = new Date(2026, 10, 26, 12, 0).getTime();

function fakeCtx(changes = 1) {
  const db = {
    runAsync: jest.fn(async (..._args: unknown[]) => ({ changes, lastInsertRowId: 1 })),
    getAllAsync: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
    getFirstAsync: jest.fn(async (..._args: unknown[]) => null as unknown),
  };
  const ctx = { db, notifyChanged: jest.fn(), enabledTools: async () => [] } as unknown as PluginContext & { db: typeof db };
  return ctx;
}

const tools = Object.fromEntries(financeTools(() => NOW).map((t) => [t.name, t])) as Record<string, Tool>;

describe('finance tools', () => {
  it('records a purchase from a routine once, even when retried', async () => {
    const ctx = fakeCtx();
    const params = { amount: 45.9, direction: 'out', description: 'PADARIA X', dedupKey: 'k|1' };
    expect(await tools['finance.add'].run(params, ctx)).toEqual({ ok: true, reply: 'Anotado: gasto de R$ 45,90 em PADARIA X.' });
    expect(ctx.db.runAsync.mock.calls[0]).toEqual([expect.stringContaining('ON CONFLICT(dedup_key) DO NOTHING'), 4590, 'out', 'PADARIA X', null, NOW, 'routine', 'k|1', null, NOW]);
    expect(ctx.notifyChanged).toHaveBeenCalled();

    const again = fakeCtx(0);
    expect(await tools['finance.add'].run(params, again)).toEqual({ ok: true, reply: 'Já estava anotado.' });
    expect(again.notifyChanged).not.toHaveBeenCalled();
  });

  it('records money received', async () => {
    expect((await tools['finance.add'].run({ amount: 1000, direction: 'in', description: 'Salário' }, fakeCtx())).reply).toBe(
      'Anotado: entrada de R$ 1.000,00: Salário.',
    );
  });

  it('refuses bad input without writing', async () => {
    const ctx = fakeCtx();
    expect(await tools['finance.add'].run({ amount: -1, direction: 'out', description: 'x' }, ctx)).toEqual({
      ok: false,
      reply: 'Valor inválido. Use um número maior que zero, em reais.',
    });
    expect(ctx.db.runAsync).not.toHaveBeenCalled();
  });

  it('is the only finance tool routines may call', () => {
    expect(financeTools().filter((t) => t.routineAction).map((t) => t.name)).toEqual(['finance.add']);
  });

  it('sums a month', async () => {
    const ctx = fakeCtx();
    ctx.db.getFirstAsync.mockResolvedValueOnce({ out_cents: 123456, in_cents: 500000, n: 7 });
    expect((await tools['finance.summary'].run({}, ctx)).reply).toBe(
      'Em novembro de 2026: gastos R$ 1.234,56, entradas R$ 5.000,00 (7 registros).',
    );
    ctx.db.getFirstAsync.mockResolvedValueOnce({ out_cents: null, in_cents: null, n: 0 });
    expect((await tools['finance.summary'].run({ month: '2026-10' }, ctx)).reply).toBe('Nada registrado em outubro de 2026.');
    expect((await tools['finance.summary'].run({ month: 'outubro' }, ctx)).ok).toBe(false);
  });

  it('records a new description without a category, and a known one with its last category', async () => {
    const fresh = fakeCtx();
    await tools['finance.add'].run({ amount: 30, direction: 'out', description: 'Lanchonete Nova' }, fresh);
    // Entries categorized one by one ("só este registro") are not inherited.
    expect(fresh.db.getFirstAsync.mock.calls[0]).toEqual([expect.stringContaining('AND category_by_description = 1'), 'Lanchonete Nova']);
    expect(fresh.db.runAsync.mock.calls[0].at(-2)).toBeNull();

    const known = fakeCtx();
    known.db.getFirstAsync.mockResolvedValueOnce({ category_id: 7 });
    await tools['finance.add'].run({ amount: 52.4, direction: 'out', description: 'PIZZARIA FORNO', dedupKey: 'k|2' }, known);
    expect(known.db.runAsync.mock.calls[0].at(-2)).toBe(7);
  });

  it('lists descriptions without a category and the categories that exist', async () => {
    const ctx = fakeCtx();
    ctx.db.getAllAsync.mockImplementation(async (...[sql]: unknown[]) =>
      String(sql).includes('FROM finance_categories')
        ? [{ id: 1, name: 'Mercado' }]
        : [
            { description: 'PIZZARIA FORNO', n: 5, out_cents: 28140, in_cents: null },
            { description: 'Fulano', n: 1, out_cents: null, in_cents: 15000 },
          ],
    );
    expect((await tools['finance.uncategorized'].run({}, ctx)).reply).toBe(
      'Sem categoria: 6 registros em 2 descrições.\n' +
        'PIZZARIA FORNO · 5× · gastos R$ 281,40\n' +
        'Fulano · 1× · entradas R$ 150,00\n' +
        'Categorias existentes: Mercado.',
    );

    const done = fakeCtx();
    expect((await tools['finance.uncategorized'].run({}, done)).reply).toBe('Tudo categorizado. Categorias: nenhuma ainda.');
  });

  /** A db where categories get ids from [ids] and updates change [changes] rows per description or id. */
  function categorizeCtx(ids: Record<string, number>, changes: Record<string, number>, existing: string[] = []) {
    const ctx = fakeCtx();
    ctx.db.runAsync.mockImplementation(async (...[sql, ...args]: unknown[]) => {
      if (String(sql).startsWith('INSERT INTO finance_categories')) return { changes: existing.includes(String(args[0])) ? 0 : 1, lastInsertRowId: 0 };
      return { changes: changes[String(args[1])] ?? 0, lastInsertRowId: 0 };
    });
    ctx.db.getFirstAsync.mockImplementation(async (...[, name]: unknown[]) => ({ id: ids[String(name)] }));
    return ctx;
  }

  it('categorizes in batch by description or id, creating only missing categories', async () => {
    const ctx = categorizeCtx({ Delivery: 3, Mercado: 1 }, { 'PIZZARIA FORNO': 5, 'MERCADO BOM PRECO': 4, '42': 1 }, ['Mercado']);
    const result = await tools['finance.categorize'].run(
      {
        items: [
          { description: ' PIZZARIA  FORNO ', category: 'delivery' },
          { description: 'MERCADO BOM PRECO', category: 'Mercado' },
          { id: 42, category: 'Delivery' },
          { description: 'LOJA QUE NAO EXISTE', category: 'Mercado' },
          { category: 'Mercado' },
        ],
      },
      ctx,
    );
    expect(result).toEqual({
      ok: true,
      reply:
        'Categorizado: PIZZARIA FORNO → Delivery (5); MERCADO BOM PRECO → Mercado (4); #42 → Delivery (1). ' +
        'Categorias novas: Delivery. Não achei: LOJA QUE NAO EXISTE. Problemas: ?: falta descrição ou id, e categoria.',
    });
    expect(ctx.db.runAsync).toHaveBeenCalledWith(expect.stringContaining('category_by_description = 1 WHERE description = ?'), 3, 'PIZZARIA FORNO');
    expect(ctx.db.runAsync).toHaveBeenCalledWith(expect.stringContaining('category_by_description = 0 WHERE id = ?'), 3, 42);
    expect(ctx.notifyChanged).toHaveBeenCalledTimes(1);
  });

  it('takes a description out of its category with an empty name', async () => {
    const ctx = categorizeCtx({}, { 'PIX FULANO': 2 });
    expect((await tools['finance.categorize'].run({ items: [{ description: 'PIX FULANO', category: '' }] }, ctx)).reply).toBe(
      'Categorizado: PIX FULANO → sem categoria (2).',
    );
    expect(ctx.db.runAsync).toHaveBeenCalledWith(expect.stringContaining('SET category_id = ?'), null, 'PIX FULANO');
  });

  it('refuses an empty batch and changes nothing', async () => {
    const ctx = fakeCtx();
    expect((await tools['finance.categorize'].run({ items: [] }, ctx)).ok).toBe(false);
    expect(ctx.db.runAsync).not.toHaveBeenCalled();
  });

  it('reads out spending per category, short enough for voice', () => {
    expect(describeCategoryTotals([])).toBe('');
    expect(describeCategoryTotals([{ name: null, outCents: 5000 }])).toBe('Nenhum gasto tem categoria ainda.');
    expect(
      describeCategoryTotals([
        { name: 'Casa', outCents: 240000 },
        { name: 'Mercado', outCents: 80000 },
        { name: null, outCents: 40000 },
        { name: 'Delivery', outCents: 30000 },
        { name: 'Café', outCents: 10000 },
        { name: 'Saúde', outCents: 9000 },
        { name: 'Lazer', outCents: 1000 },
      ]),
    ).toBe(
      'Por categoria: Casa R$ 2.400,00, Mercado R$ 800,00, Delivery R$ 300,00, Café R$ 100,00, Saúde R$ 90,00, outras R$ 10,00, ' +
        'sem categoria R$ 400,00. 90% dos gastos têm categoria.',
    );
  });

  it('adds the categories to the month summary', async () => {
    const ctx = fakeCtx();
    ctx.db.getFirstAsync.mockResolvedValueOnce({ out_cents: 100000, in_cents: 0, n: 3 });
    ctx.db.getAllAsync.mockResolvedValueOnce([{ name: 'Mercado', out_cents: 100000 }]);
    expect((await tools['finance.summary'].run({}, ctx)).reply).toBe(
      'Em novembro de 2026: gastos R$ 1.000,00, entradas R$ 0,00 (3 registros). Por categoria: Mercado R$ 1.000,00.',
    );
  });

  it('renames a category, or merges it into one with the new name', async () => {
    const ctx = fakeCtx();
    const cats: Record<string, { id: number; name: string }> = { comida: { id: 1, name: 'Comida' }, delivery: { id: 2, name: 'Delivery' } };
    ctx.db.getFirstAsync.mockImplementation(async (...[, name]: unknown[]) => cats[String(name).toLowerCase()] ?? null);

    expect((await tools['finance.rename_category'].run({ from: 'comida', to: 'alimentação' }, ctx)).reply).toBe('Agora se chama Alimentação.');
    expect(ctx.db.runAsync).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE finance_categories SET name'), 'Alimentação', 1);

    ctx.db.runAsync.mockClear();
    expect((await tools['finance.rename_category'].run({ from: 'Comida', to: 'delivery' }, ctx)).reply).toBe('Juntei em Delivery.');
    expect(ctx.db.runAsync.mock.calls.map((c) => [String(c[0]).split(' ').slice(0, 3).join(' '), ...c.slice(1)])).toEqual([
      ['UPDATE finance_transactions SET', 2, 1],
      ['DELETE FROM finance_categories', 1],
    ]);

    expect((await tools['finance.rename_category'].run({ from: 'Viagem', to: 'Férias' }, ctx)).ok).toBe(false);
  });

  it('deletes a category and keeps its entries without one', async () => {
    const ctx = fakeCtx(3);
    ctx.db.getFirstAsync.mockResolvedValueOnce({ id: 4, name: 'Café' });
    expect((await tools['finance.delete_category'].run({ name: 'café' }, ctx)).reply).toBe('Apaguei Café. 3 registros ficaram sem categoria.');
    expect(ctx.db.runAsync.mock.calls[0]).toEqual([expect.stringContaining('SET category_id = NULL WHERE category_id = ?'), 4]);
    expect(ctx.db.runAsync.mock.calls.some((c) => String(c[0]).includes('DELETE FROM finance_transactions'))).toBe(false);
  });

  it('has no tool with an empty parameter schema', () => {
    for (const t of financeTools()) expect(Object.keys(t.parameters.properties).length).toBeGreaterThan(0);
  });

  it('refuses a category called "Sem categoria"', async () => {
    const ctx = fakeCtx();
    expect((await tools['finance.categorize'].run({ items: [{ description: 'X', category: 'sem categoria' }] }, ctx)).reply).toContain(
      'Nome de categoria inválido',
    );
    expect(ctx.db.runAsync).not.toHaveBeenCalled();
  });
});
