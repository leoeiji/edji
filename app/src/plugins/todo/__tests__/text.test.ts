import { cleanTaskText, normalizeForMatch } from '../text';

describe('cleanTaskText', () => {
  it('collapses spaces, drops trailing punctuation and capitalizes', () => {
    expect(cleanTaskText('  comprar   pão. ')).toBe('Comprar pão');
  });
  it('keeps already clean text', () => {
    expect(cleanTaskText('Ligar para a escola')).toBe('Ligar para a escola');
  });
  it('drops trailing ! ? and …', () => {
    expect(cleanTaskText('pagar o boleto!?…')).toBe('Pagar o boleto');
  });
  it('capitalizes accented first letters', () => {
    expect(cleanTaskText('água das plantas')).toBe('Água das plantas');
  });
  it('returns empty for blank or punctuation-only input', () => {
    expect(cleanTaskText('   ')).toBe('');
    expect(cleanTaskText('...')).toBe('');
  });
});

describe('normalizeForMatch', () => {
  it('ignores case and accents', () => {
    expect(normalizeForMatch('  Comprar  PÃO ')).toBe('comprar pao');
  });
});
