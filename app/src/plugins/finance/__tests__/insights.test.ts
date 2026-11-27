import { buildMonthStory } from '../insights';
import type { Transaction } from '../transaction';

let nextId = 1;
/** An invented entry; [month] is 1-12, amounts in reais. */
function tx(month: number, day: number, reais: number, description: string, category: [number, string] | null, direction: 'out' | 'in' = 'out', year = 2026): Transaction {
  return {
    id: nextId++,
    amountCents: Math.round(reais * 100),
    direction,
    description,
    account: null,
    occurredAt: new Date(year, month - 1, day, 12, 0).getTime(),
    source: 'routine',
    categoryId: category?.[0] ?? null,
    category: category?.[1] ?? null,
  };
}

const CASA: [number, string] = [1, 'Casa'];
const DELIVERY: [number, string] = [2, 'Delivery'];
const MERCADO: [number, string] = [3, 'Mercado'];
const CAFE: [number, string] = [4, 'Café'];
const NOW = new Date(2026, 10, 26, 18, 0).getTime();

const OCTOBER = [
  tx(10, 5, 2400, 'ALUGUEL APTO', CASA),
  tx(10, 4, 50, 'PIZZARIA FORNO', DELIVERY),
  tx(10, 11, 50, 'PIZZARIA FORNO', DELIVERY),
  tx(10, 2, 300, 'MERCADO BOM PRECO', MERCADO),
  tx(10, 9, 300, 'MERCADO BOM PRECO', MERCADO),
  tx(10, 28, 50, 'PIZZARIA FORNO', DELIVERY), // after the 26th: outside the comparison
];
const SEPTEMBER = [tx(9, 5, 2400, 'ALUGUEL APTO', CASA), tx(9, 3, 300, 'MERCADO BOM PRECO', MERCADO)];
const NOVEMBER = [
  tx(11, 5, 2400, 'ALUGUEL APTO', CASA),
  ...[3, 6, 10, 12, 20].map((d) => tx(11, d, 50, 'PIZZARIA FORNO', DELIVERY)),
  tx(11, 8, 300, 'MERCADO BOM PRECO', MERCADO),
  ...[2, 3, 4, 5].map((d) => tx(11, d, 10, 'CAFE DA ESQUINA', CAFE)),
  tx(11, 5, 7800, 'Salário', null, 'in'),
];

describe('buildMonthStory', () => {
  it('compares with the same days of last month, ignoring income', () => {
    const s = buildMonthStory(NOVEMBER, OCTOBER, 2026, 11, NOW);
    expect(s.headline).toBe('Novembro está R$ 110 mais barato que outubro.');
    expect(s.sub).toBe('R$ 2.990,00 até hoje, contra R$ 3.100,00 até o dia 26 de outubro.');
    expect(s.coverage).toBe(1);
  });

  it('says which category rose and which fell most', () => {
    const s = buildMonthStory(NOVEMBER, OCTOBER, 2026, 11, NOW);
    expect(s.changes?.headline).toBe('Delivery subiu R$ 150. Mercado caiu R$ 300.');
    expect(s.changes?.rows.map((r) => [r.name, r.diffCents])).toEqual([
      ['Delivery', 15000],
      ['Café', 4000],
      ['Casa', 0],
      ['Mercado', -30000],
    ]);
  });

  it('splits an increase into buying more often and paying more, with a new category counted as frequency', () => {
    const s = buildMonthStory(NOVEMBER, OCTOBER, 2026, 11, NOW);
    expect(s.split?.headline).toBe('100% do aumento veio de comprar mais vezes.');
    expect(s.split?.rows.map((r) => [r.name, r.frequencyCents, r.priceCents, r.caption])).toEqual([
      ['Delivery', 15000, 0, '2 → 5 compras · mesmo valor médio'],
      ['Café', 4000, 0, '0 → 4 compras · nova neste mês'],
    ]);
  });

  it('blames price when each purchase got more expensive', () => {
    const before = [tx(10, 3, 100, 'CANTINA ROSA', [5, 'Restaurante']), tx(10, 10, 100, 'CANTINA ROSA', [5, 'Restaurante'])];
    const now = [tx(11, 3, 200, 'CANTINA ROSA', [5, 'Restaurante']), tx(11, 10, 200, 'CANTINA ROSA', [5, 'Restaurante'])];
    const s = buildMonthStory(now, before, 2026, 11, NOW);
    expect(s.split?.headline).toBe('100% do aumento veio de compras mais caras.');
    expect(s.split?.rows[0].caption).toBe('2 → 2 compras · cada compra R$ 100,00 mais cara (R$ 100,00 → R$ 200,00)');
  });

  it('keeps the frequency share within 100% when one part is negative', () => {
    const r: [number, string] = [6, 'Restaurante'];
    const before = [1, 2, 3, 4].map((d) => tx(10, d, 50, 'CANTINA ROSA', r));
    const now = [1, 2].map((d) => tx(11, d, 150, 'CANTINA ROSA', r));
    const s = buildMonthStory(now, before, 2026, 11, NOW);
    expect(s.split?.rows[0]).toMatchObject({ frequencyCents: -10000, priceCents: 20000, diffCents: 10000 });
    expect(s.split?.headline).toBe('100% do aumento veio de compras mais caras.');
  });

  it('tells the month without comparisons when there is no last month', () => {
    const s = buildMonthStory(NOVEMBER, [], 2026, 11, NOW);
    expect(s.headline).toBe('Você gastou R$ 2.990 em novembro até agora.');
    expect(s.sub).toBeNull();
    expect(s.changes).toBeNull();
    expect(s.split).toBeNull();
  });

  it('hides per-category analysis when too little spending has a category', () => {
    const loose = NOVEMBER.map((t) => (t.description === 'ALUGUEL APTO' ? { ...t, categoryId: null, category: null } : t));
    const s = buildMonthStory(loose, OCTOBER, 2026, 11, NOW);
    expect(s.coverage).toBeCloseTo(590 / 2990);
    expect(s.showCategories).toBe(false);
    expect(s.split).toBeNull();
    expect(s.changes?.rows[0]).toMatchObject({ name: 'Sem categoria', uncategorized: true, diffCents: 240000 });
  });

  it('marks recurring charges, seen once in each of three months, and keeps them out of the calendar scale', () => {
    const s = buildMonthStory(NOVEMBER, OCTOBER, 2026, 11, NOW, SEPTEMBER);
    expect(s.recurring).toEqual({ items: [{ description: 'ALUGUEL APTO', cents: 240000 }], monthlyCents: 240000 });
    const day5 = s.calendar.days[4];
    expect(day5).toMatchObject({ day: 5, cents: 1000, hasRecurring: true });
    expect(s.calendar.firstWeekday).toBe(0);
    expect(s.calendar.days[26]).toMatchObject({ day: 27, future: true, level: 0 });
    expect(s.calendar.headline).toBe('17 dias sem gastar nada. O dia mais caro foi domingo, 8/11: R$ 300.');
    expect(s.calendar.days[7].level).toBe(4);
  });

  it('finds small frequent purchases and their yearly cost', () => {
    const s = buildMonthStory(NOVEMBER, OCTOBER, 2026, 11, NOW);
    expect(s.small).toEqual([
      { description: 'PIZZARIA FORNO', count: 5, totalCents: 25000, avgCents: 5000, yearlyCents: Math.round((25000 / 26) * 365) },
      { description: 'CAFE DA ESQUINA', count: 4, totalCents: 4000, avgCents: 1000, yearlyCents: Math.round((4000 / 26) * 365) },
    ]);
  });

  it('compares the end of a long month with the whole of a shorter one', () => {
    const feb = [tx(2, 28, 100, 'FARMACIA', [7, 'Saúde'])];
    const mar = [tx(3, 31, 100, 'FARMACIA', [7, 'Saúde'])];
    const s = buildMonthStory(mar, feb, 2026, 3, new Date(2026, 2, 31, 20).getTime());
    expect(s.headline).toBe('Março está igual a fevereiro.');
    expect(s.sub).toBe('R$ 100,00 até hoje, contra R$ 100,00 até o dia 28 de fevereiro.');
  });

  it('compares a past month with the whole of the month before it', () => {
    const jan = [tx(1, 10, 100, 'FARMACIA', [7, 'Saúde'], 'out', 2026), tx(1, 30, 100, 'FARMACIA', [7, 'Saúde'], 'out', 2026)];
    const feb = [tx(2, 10, 200, 'FARMACIA', [7, 'Saúde'], 'out', 2026)];
    const s = buildMonthStory(feb, jan, 2026, 2, NOW);
    expect(s.headline).toBe('Fevereiro está igual a janeiro.');
    expect(s.sub).toBe('R$ 200,00 no mês, contra R$ 200,00 em janeiro.');
  });

  it('needs three months to call something recurring', () => {
    const pharmacy = (m: number, reais: number) => tx(m, 14, reais, 'FARMACIA CENTRAL', [7, 'Saúde']);
    const twoMonths = buildMonthStory([pharmacy(11, 92.1)], [pharmacy(10, 86.4)], 2026, 11, NOW);
    expect(twoMonths.recurring.items).toEqual([]);
    expect(twoMonths.calendar.days[13]).toMatchObject({ cents: 9210, hasRecurring: false });

    const visitedTwice = [pharmacy(9, 40), tx(9, 20, 40, 'FARMACIA CENTRAL', [7, 'Saúde'])];
    expect(buildMonthStory([pharmacy(11, 92.1)], [pharmacy(10, 86.4)], 2026, 11, NOW, visitedTwice).recurring.items).toEqual([]);

    const amountJumped = [pharmacy(9, 30)];
    expect(buildMonthStory([pharmacy(11, 92.1)], [pharmacy(10, 86.4)], 2026, 11, NOW, amountJumped).recurring.items).toEqual([]);

    const steady = [pharmacy(9, 90)];
    expect(buildMonthStory([pharmacy(11, 92.1)], [pharmacy(10, 86.4)], 2026, 11, NOW, steady).recurring.items).toEqual([
      { description: 'FARMACIA CENTRAL', cents: 9210 },
    ]);
  });
});
