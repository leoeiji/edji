import type { Plugin } from '@/core/plugin';
import { financePlugin } from './finance';
import { routinesPlugin } from './routines';

/** Every plugin compiled into the app, in side-panel order. Add new plugins here. */
export const PLUGINS: Plugin[] = [routinesPlugin, financePlugin];
