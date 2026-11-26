import type { Plugin } from '@/core/plugin';
import { RoutinesView } from './RoutinesView';
import { routineTools } from './tools';

/**
 * Routines: a trigger and the actions it runs, created by the agent (ADR 0005).
 * The routines live in the native `edji-routines.db`, so there are no migrations here.
 */
export const routinesPlugin: Plugin = {
  id: 'routines',
  name: 'Rotinas',
  version: '1',
  enabledByDefault: true,
  tools: routineTools(),
  view: { title: 'Rotinas', Component: RoutinesView },
};
