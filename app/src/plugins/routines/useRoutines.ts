import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { EdjiAssistant } from '../../../modules/edji-assistant';
import { PERMISSIONS, type PermissionId, type PermissionStatus } from '@/core/permissions';
import type { Place, Routine, RoutineFailure, RoutineRun } from './types';

export type RoutinesData = {
  routines: Routine[];
  places: Place[];
  runs: RoutineRun[];
  /** Open failures, newest first. */
  failures: RoutineFailure[];
  statuses: Partial<Record<PermissionId, PermissionStatus>>;
};

const EMPTY: RoutinesData = { routines: [], places: [], runs: [], failures: [], statuses: {} };

/** How many recent runs the screen loads (all routines together). */
const RUNS_LIMIT = 100;

/**
 * Routines, places, recent runs, open failures and permission statuses from the native
 * side. Reloads when the app comes back to the foreground, since the agent
 * changes routines from the voice session. `data` is null until the first load.
 */
export function useRoutines() {
  const [data, setData] = useState<RoutinesData | null>(null);

  const reload = useCallback(async () => {
    if (!EdjiAssistant) return setData(EMPTY);
    try {
      const [routines, places, runs, failures] = await Promise.all([
        EdjiAssistant.listRoutines(),
        EdjiAssistant.listPlaces(),
        EdjiAssistant.recentRuns(RUNS_LIMIT),
        EdjiAssistant.listFailures(null),
      ]);
      const statuses = EdjiAssistant.permissionStatus(PERMISSIONS.map((p) => p.id));
      setData({ routines, places, runs, failures, statuses });
    } catch {
      setData(EMPTY);
    }
  }, []);

  useEffect(() => {
    reload();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && reload());
    return () => sub.remove();
  }, [reload]);

  return { data, reload };
}
