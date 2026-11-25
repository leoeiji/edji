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
};

/**
 * Current status of every permission. The microphone and the assistant role
 * are read today; the others come from the native `permissionStatus` once it
 * exists, and are `unavailable` until then (ADR 0005).
 */
export async function readPermissionStatuses(): Promise<PermissionStatuses> {
  const statuses = Object.fromEntries(PERMISSIONS.map((p) => [p.id, 'unavailable'])) as PermissionStatuses;
  if (Platform.OS !== 'android' || !EdjiAssistant) return statuses;

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
