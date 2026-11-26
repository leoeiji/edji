import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { readPermissionStatuses, requestPermission, type PermissionStatuses } from '@/core/devicePermissions';
import type { PermissionId } from '@/core/permissions';

/**
 * Status of every device permission, refreshed when the app comes back to
 * the foreground (the user may have changed it in the Android settings).
 * `statuses` is null until the first read.
 */
export function usePermissions() {
  const [statuses, setStatuses] = useState<PermissionStatuses | null>(null);

  const refresh = useCallback(async () => {
    setStatuses(await readPermissionStatuses());
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const request = useCallback(
    async (id: PermissionId) => {
      await requestPermission(id);
      await refresh();
    },
    [refresh],
  );

  return { statuses, request };
}
