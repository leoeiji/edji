import { ACTION_CATALOG, STEP_CATALOG, TRIGGER_CATALOG } from '../catalog';
import { TRIGGER_OUTPUTS } from '../types';

describe('catalog', () => {
  it('lists every trigger, step and action kind exactly once', () => {
    expect(TRIGGER_CATALOG.map((e) => e.kind).sort()).toEqual(Object.keys(TRIGGER_OUTPUTS).sort());
    expect(STEP_CATALOG.map((e) => e.kind).sort()).toEqual(['extract', 'match', 'number']);
    expect(ACTION_CATALOG.map((e) => e.kind).sort()).toEqual(['ask_agent', 'notify', 'open_app', 'open_url', 'run_tool', 'sound_mode']);
  });

  it('takes permissions from the requirements, including option-dependent ones', () => {
    const trigger = (kind: string) => TRIGGER_CATALOG.find((e) => e.kind === kind)!;
    const action = (kind: string) => ACTION_CATALOG.find((e) => e.kind === kind)!;
    expect(trigger('place').permissions).toEqual(['fine_location', 'background_location']);
    expect(action('sound_mode').permissions).toEqual(['dnd_access']);
    expect(action('ask_agent').permissions).toEqual(['notifications']);
    expect(action('open_url').permissions).toEqual(['background_launch']);
    expect(action('run_tool').permissions).toEqual([]);
  });
});
