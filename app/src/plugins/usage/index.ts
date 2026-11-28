import type { Plugin } from '@/core/plugin';
import { UsageView } from './UsageView';

/**
 * Usage: a dashboard of the model's token use, read from the core's
 * `usage_steps` (ADR 0008). No tables or tools of its own; turning it off
 * hides the screen, and the core keeps counting.
 */
export const usagePlugin: Plugin = {
  id: 'usage',
  name: 'Uso',
  version: '1',
  enabledByDefault: true,
  view: { title: 'Uso', Component: UsageView },
};
