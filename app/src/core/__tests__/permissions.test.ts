import { PERMISSION_GROUPS, PERMISSIONS, describeMissing, missingPermissions, permissionById } from '../permissions';

describe('permissions catalog', () => {
  it('has unique ids, known groups and prerequisites that exist', () => {
    const ids = PERMISSIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = PERMISSION_GROUPS.map((g) => g.id);
    for (const p of PERMISSIONS) {
      expect(groups).toContain(p.group);
      if (p.requires) expect(ids).toContain(p.requires);
    }
  });

  it('throws on an unknown id', () => {
    expect(() => permissionById('camera' as never)).toThrow('Unknown permission');
  });
});

describe('missingPermissions', () => {
  it('puts prerequisites first and skips what is granted', () => {
    expect(missingPermissions(['background_location'], {})).toEqual(['fine_location', 'background_location']);
    expect(missingPermissions(['background_location'], { fine_location: 'granted' })).toEqual(['background_location']);
    expect(missingPermissions(['nearby_devices', 'notifications'], { nearby_devices: 'granted', notifications: 'granted' })).toEqual([]);
  });

  it('does not repeat a permission asked twice', () => {
    expect(missingPermissions(['fine_location', 'background_location', 'fine_location'], {})).toEqual([
      'fine_location',
      'background_location',
    ]);
  });

  it('treats an unknown status as missing', () => {
    expect(missingPermissions(['exact_alarms'], { exact_alarms: 'unavailable' })).toEqual(['exact_alarms']);
  });
});

describe('describeMissing', () => {
  it('names what is missing in short Portuguese', () => {
    expect(describeMissing([])).toBe('');
    expect(describeMissing(['notification_access'])).toBe('Falta permitir acesso a notificações. Abra Permissões.');
    expect(describeMissing(['fine_location', 'background_location'])).toBe(
      'Falta permitir localização precisa e localização o tempo todo. Abra Permissões.',
    );
  });
});
