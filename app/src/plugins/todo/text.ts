/**
 * Turns a transcript into a task title: collapses whitespace, drops trailing
 * punctuation and capitalizes the first letter. Returns "" if nothing is left.
 */
export function cleanTaskText(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim().replace(/[.!?…\s]+$/u, '');
  if (!text) return '';
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
}

/** Lowercase without accents, for matching spoken text against task titles. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
