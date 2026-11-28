/** Brazilian number formats for usage, without relying on Intl (Hermes may lack the locale). */

/** "6.600", whole number with dot thousands. */
export function formatInt(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "1,2" with [digits] decimals and a comma, trailing zeros dropped. */
function decimal(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.?0+$/, '').replace('.', ',');
}

/** "980", "61,8 mil", "1,21 mi": short token counts for headlines and tiles. */
export function formatTokensShort(n: number): string {
  const abs = Math.abs(n);
  if (abs < 10_000) return formatInt(n);
  if (abs < 1_000_000) return `${decimal(n / 1000, abs < 100_000 ? 1 : 0)} mil`;
  return `${decimal(n / 1_000_000, 2)} mi`;
}

/**
 * "US$ 0,42", "US$ 0,0021": OpenRouter credits are dollars. Small amounts keep
 * two significant digits, so a single reply does not read as zero.
 */
export function formatCost(usd: number): string {
  if (usd === 0) return 'US$ 0';
  if (usd >= 1) return `US$ ${usd.toFixed(2).replace('.', ',')}`;
  const digits = Math.min(6, Math.max(2, 1 - Math.floor(Math.log10(usd))));
  return `US$ ${usd.toFixed(digits).replace('.', ',')}`;
}

/** "640 ms", "2,1 s", "14 s". */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return s < 10 ? `${decimal(s, 1)} s` : `${Math.round(s)} s`;
}

/** "5.160 tpm": output tokens per minute. */
export function formatTpm(tpm: number): string {
  return `${formatInt(tpm)} tpm`;
}
