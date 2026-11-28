import { useCallback, useEffect, useState } from 'react';
import { getDb } from '@/core/db';
import { onChanged } from '@/core/events';
import { ensureReady } from '@/core/runtime';
import { listSkills } from '@/core/skills/catalog';
import { SKILLS_TOPIC } from '@/core/skills/store';
import type { Skill } from '@/core/skills/types';
import { PLUGINS } from '@/plugins';

/** Every skill (system, plugins, the user's), reloaded when a user skill changes. `null` until loaded. */
export function useSkills(): { skills: Skill[] | null; reload(): Promise<void> } {
  const [skills, setSkills] = useState<Skill[] | null>(null);

  const reload = useCallback(async () => {
    await ensureReady();
    setSkills(await listSkills(await getDb(), PLUGINS));
  }, []);

  useEffect(() => {
    reload();
    return onChanged(SKILLS_TOPIC, () => {
      reload();
    });
  }, [reload]);

  return { skills, reload };
}
