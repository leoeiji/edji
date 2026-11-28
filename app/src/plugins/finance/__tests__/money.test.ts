import { formatBRL, monthName, toCents } from '../money';

describe('money', () => {
  it('formats cents in Brazilian reais', () => {
    expect(formatBRL(4590)).toBe('R$ 45,90');
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(100000000)).toBe('R$ 1.000.000,00');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(-4590)).toBe('-R$ 45,90');
  });

  it('turns reais into whole cents without float drift', () => {
    expect(toCents(45.9)).toBe(4590);
    expect(toCents(1234.56)).toBe(123456);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(19.995)).toBe(2000);
  });

  it('names the month in Portuguese', () => {
    expect(monthName(2026, 11)).toBe('novembro de 2026');
  });
});
