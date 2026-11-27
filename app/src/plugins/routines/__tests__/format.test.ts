import { formatWhen, routineFooter, runLabel } from '../format';

const now = new Date(2026, 10, 25, 21, 0).getTime();

describe('formatWhen', () => {
  it('says today, yesterday or the date', () => {
    expect(formatWhen(new Date(2026, 10, 25, 8, 12).getTime(), now)).toBe('Hoje, 08:12');
    expect(formatWhen(new Date(2026, 10, 24, 18, 40).getTime(), now)).toBe('Ontem, 18:40');
    expect(formatWhen(new Date(2026, 10, 20, 7, 5).getTime(), now)).toBe('20 nov, 07:05');
  });
});

describe('routineFooter', () => {
  it('shows a missing permission, then open failures, then the last run', () => {
    expect(routineFooter({ lastRunAt: now }, ['background_location'], 2, now)).toBe('Falta localização o tempo todo');
    expect(routineFooter({ lastRunAt: now }, [], 1, now)).toBe('1 falha para corrigir');
    expect(routineFooter({ lastRunAt: now }, [], 3, now)).toBe('3 falhas para corrigir');
    expect(routineFooter({ lastRunAt: new Date(2026, 10, 25, 8, 12).getTime() }, [], 0, now)).toBe('Última vez hoje, 08:12');
    expect(routineFooter({ lastRunAt: null }, [], 0, now)).toBe('Nunca rodou');
  });
});

describe('runLabel', () => {
  it('uses the native detail and falls back by outcome', () => {
    expect(runLabel({ outcome: 'done', detail: 'Abriu Spotify' })).toBe('Abriu Spotify');
    expect(runLabel({ outcome: 'done', detail: '' })).toBe('Feito');
    expect(runLabel({ outcome: 'blocked', detail: '' })).toBe('Bloqueada');
    expect(runLabel({ outcome: 'failed', detail: '' })).toBe('Falhou');
  });
});
