import { PermissionsAndroid, Platform, type Permission as AndroidPermission } from 'react-native';
import { EdjiAssistant } from '../../modules/edji-assistant';
import { PERMISSIONS, type PermissionId, type PermissionStatus } from './permissions';

export type PermissionStatuses = Record<PermissionId, PermissionStatus>;

/** Runtime permissions asked with the system dialog; the rest open a settings screen. */
const ANDROID_RUNTIME: Partial<Record<PermissionId, AndroidPermission>> = {
  microphone: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  notifications: PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  nearby_devices: PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  fine_location: PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  // Android 11+ answers this request by opening the location screen ("Permitir o tempo todo").
  background_location: PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
};

/**
 * Current status of every permission, from the native side (ADR 0005).
 * Everything is `unavailable` where there is no native module.
 */
export async function readPermissionStatuses(): Promise<PermissionStatuses> {
  const statuses = Object.fromEntries(PERMISSIONS.map((p) => [p.id, 'unavailable'])) as PermissionStatuses;
  if (Platform.OS !== 'android' || !EdjiAssistant) return statuses;

  // Permissions may have changed in the Android settings: the routine triggers depend on them.
  EdjiAssistant.syncRoutines?.();
  const native = EdjiAssistant.permissionStatus?.(PERMISSIONS.map((p) => p.id));
  if (native) Object.assign(statuses, native);
  statuses.microphone = (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) ? 'granted' : 'denied';
  statuses.assistant_role = EdjiAssistant.isAssistant() ? 'granted' : 'denied';
  return statuses;
}

/**
 * Asks for [id]: the system dialog for runtime permissions, otherwise the
 * Android settings screen. The caller refreshes when the app becomes active.
 */
export async function requestPermission(id: PermissionId): Promise<void> {
  if (Platform.OS !== 'android' || !EdjiAssistant) return;
  if (id === 'assistant_role') return EdjiAssistant.openAssistantSettings();
  const runtime = ANDROID_RUNTIME[id];
  if (runtime) {
    await PermissionsAndroid.request(runtime);
    return;
  }
  EdjiAssistant.openPermissionSettings?.(id);
}
