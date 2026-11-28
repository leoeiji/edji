/** Whole cents from an amount in reais, rounding half away from zero: 45.9 → 4590. */
export function toCents(amount: number): number {
  return Math.sign(amount) * Math.round(Math.abs(amount) * 100);
}

/** "R$ 1.234,56", in Brazilian format, without relying on Intl (Hermes may lack the locale). */
export function formatBRL(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const reais = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
}

/** "R$ 1.235", rounded to whole reais, for headlines. */
export function formatBRLRounded(cents: number): string {
  return formatBRL(Math.round(cents / 100) * 100).replace(/,00$/, '');
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "novembro". [month] is 1-12. */
export function monthOnly(month: number): string {
  return MONTHS[month - 1];
}

/** "novembro de 2026". [month] is 1-12. */
export function monthName(year: number, month: number): string {
  return `${MONTHS[month - 1]} de ${year}`;
}
