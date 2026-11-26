import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDb, loadPluginStates } from '@/core/db';
import type { Plugin, PluginContext } from '@/core/plugin';
import { enabledPlugins, type PluginStates } from '@/core/registry';
import { contextFor, ensureReady, processPendingRoutineRuns } from '@/core/runtime';
import { PLUGINS } from '@/plugins';

/**
 * Boots the runtime and loads the plugin states. `states` is null until the
 * database is ready; `views` are the enabled plugins that have a screen.
 */
export function usePlugins() {
  const [states, setStates] = useState<PluginStates | null>(null);
  const [contexts, setContexts] = useState<Record<string, PluginContext>>({});

  const reload = useCallback(async () => {
    setStates(await loadPluginStates(await getDb()));
  }, []);

  useEffect(() => {
    (async () => {
      await ensureReady();
      const entries = await Promise.all(PLUGINS.map(async (p) => [p.id, await contextFor(p.id)] as const));
      setContexts(Object.fromEntries(entries));
      await reload();
      // Firings the background task couldn't run (Android refused to start it) run now.
      processPendingRoutineRuns().catch(() => {});
    })();
  }, [reload]);

  const views = useMemo<Plugin[]>(() => (states ? enabledPlugins(PLUGINS, states).filter((p) => p.view) : []), [states]);

  return { plugins: PLUGINS, states, contexts, views, reload };
}
