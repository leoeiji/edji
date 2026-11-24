import type { Plugin } from '../core/plugin';
import { todoPlugin } from './todo';

/** Every plugin compiled into the app, in side-panel order. Add new plugins here. */
export const PLUGINS: Plugin[] = [todoPlugin];
