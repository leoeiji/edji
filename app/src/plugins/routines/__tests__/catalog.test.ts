import { ACTION_CATALOG, TRIGGER_CATALOG } from '../catalog';
import { TRIGGER_VARIABLES } from '../types';

describe('catalog', () => {
  it('lists every trigger kind and every action kind exactly once', () => {
    expect(TRIGGER_CATALOG.map((e) => e.kind).sort()).toEqual(Object.keys(TRIGGER_VARIABLES).sort());
    expect(ACTION_CATALOG.map((e) => e.kind).sort()).toEqual(['ask_agent', 'notify', 'open_app', 'open_url', 'sound_mode']);
  });

  it('takes permissions from the requirements, including option-dependent ones', () => {
    const trigger = (kind: string) => TRIGGER_CATALOG.find((e) => e.kind === kind)!;
    const action = (kind: string) => ACTION_CATALOG.find((e) => e.kind === kind)!;
    expect(trigger('place').permissions).toEqual(['fine_location', 'background_location']);
    expect(action('sound_mode').permissions).toEqual(['dnd_access']);
    expect(action('ask_agent').permissions).toEqual(['notifications']);
    expect(action('open_url').permissions).toEqual(['background_launch']);
  });
});
