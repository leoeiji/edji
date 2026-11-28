import { PermissionsAndroid, Platform } from 'react-native';
import { readPermissionStatuses, requestPermission } from '../devicePermissions';

const mockAssistant: {
  isAssistant: jest.Mock;
  openAssistantSettings: jest.Mock;
  permissionStatus?: jest.Mock;
  openPermissionSettings?: jest.Mock;
} = { isAssistant: jest.fn(), openAssistantSettings: jest.fn() };

// A getter: the factory runs before `mockAssistant` is initialized (jest.mock is hoisted).
jest.mock('../../../modules/edji-assistant', () => ({
  get EdjiAssistant() {
    return mockAssistant;
  },
}));

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('granted');
  mockAssistant.isAssistant.mockReturnValue(false);
  mockAssistant.openAssistantSettings.mockReset();
  delete mockAssistant.permissionStatus;
  delete mockAssistant.openPermissionSettings;
});

afterEach(() => jest.restoreAllMocks());

describe('readPermissionStatuses', () => {
  it('reads the microphone and the assistant role, and marks the rest unavailable before the native side exists', async () => {
    const s = await readPermissionStatuses();
    expect(s.microphone).toBe('granted');
    expect(s.assistant_role).toBe('denied');
    expect(s.notification_access).toBe('unavailable');
    expect(s.background_location).toBe('unavailable');
  });

  it('uses the native status when available', async () => {
    mockAssistant.permissionStatus = jest.fn().mockReturnValue({ notification_access: 'granted', exact_alarms: 'denied' });
    const s = await readPermissionStatuses();
    expect(s.notification_access).toBe('granted');
    expect(s.exact_alarms).toBe('denied');
    expect(s.dnd_access).toBe('unavailable');
  });

  it('reports everything unavailable off Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const s = await readPermissionStatuses();
    expect(new Set(Object.values(s))).toEqual(new Set(['unavailable']));
  });
});

describe('requestPermission', () => {
  it('asks runtime permissions with the system dialog', async () => {
    await requestPermission('microphone');
    expect(PermissionsAndroid.request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  });

  it('opens the assistant settings for the assistant role', async () => {
    await requestPermission('assistant_role');
    expect(mockAssistant.openAssistantSettings).toHaveBeenCalled();
  });

  it('opens the Android settings screen for special permissions when the native side supports it', async () => {
    await expect(requestPermission('notification_access')).resolves.toBeUndefined();
    mockAssistant.openPermissionSettings = jest.fn();
    await requestPermission('notification_access');
    expect(mockAssistant.openPermissionSettings).toHaveBeenCalledWith('notification_access');
    expect(PermissionsAndroid.request).not.toHaveBeenCalled();
  });
});
