import { permissionById, type PermissionId } from '@/core/permissions';
import type { Routine, RoutineRun } from './types';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "Hoje, 08:12", "Ontem, 18:40" or "20 nov, 08:12", in local time. */
export function formatWhen(timestamp: number, now: number = Date.now()): string {
  const d = new Date(timestamp);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / 86_400_000);
  if (days === 0) return `Hoje, ${time}`;
  if (days === 1) return `Ontem, ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${time}`;
}

/** The line under a routine in the list: a missing permission wins over open failures, which win over the last run. */
export function routineFooter(
  routine: Pick<Routine, 'lastRunAt'>,
  missing: PermissionId[],
  openFailures = 0,
  now: number = Date.now(),
): string {
  if (missing.length > 0) return `Falta ${lowerFirst(permissionById(missing[0]).label)}`;
  if (openFailures > 0) return openFailures === 1 ? '1 falha para corrigir' : `${openFailures} falhas para corrigir`;
  if (routine.lastRunAt) return `Última vez ${lowerFirst(formatWhen(routine.lastRunAt, now))}`;
  return 'Nunca rodou';
}

export function runLabel(run: Pick<RoutineRun, 'outcome' | 'detail'>): string {
  if (run.outcome === 'done') return run.detail || 'Feito';
  return run.detail || (run.outcome === 'blocked' ? 'Bloqueada' : 'Falhou');
}

function startOfDay(timestamp: number): number {
  const d = new Date(timestamp);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
