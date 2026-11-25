/**
 * Every device permission Edji may need, in the order the Permissions screen
 * shows them (ADR 0005). The voice session and the routines both point here,
 * so a missing permission always leads to the same screen (`edji://permissions`).
 */
export type PermissionId =
  | 'microphone'
  | 'assistant_role'
  | 'notifications'
  | 'nearby_devices'
  | 'fine_location'
  | 'background_location'
  | 'exact_alarms'
  | 'notification_access'
  | 'dnd_access'
  | 'background_launch'
  | 'battery_unrestricted';

/**
 * `runtime`: granted in a system dialog shown over the app.
 * `special`: the user turns it on in a screen of the Android settings.
 */
export type PermissionKind = 'runtime' | 'special';

export type PermissionGroupId = 'voice' | 'routines' | 'reliability';

/** `unavailable`: the native side can't tell yet, or the device doesn't have it. */
export type PermissionStatus = 'granted' | 'denied' | 'unavailable';

export type Permission = {
  id: PermissionId;
  /** Short Portuguese label for the screen. */
  label: string;
  /** What it is for, in one short Portuguese sentence. */
  reason: string;
  kind: PermissionKind;
  group: PermissionGroupId;
  /** Has to be granted first (Android asks background location only after fine location). */
  requires?: PermissionId;
  /** Not needed for anything to work, but strongly advised. */
  recommended?: boolean;
};

export const PERMISSION_GROUPS: { id: PermissionGroupId; title: string }[] = [
  { id: 'voice', title: 'Voz' },
  { id: 'routines', title: 'Rotinas' },
  { id: 'reliability', title: 'Funcionamento' },
];

export const PERMISSIONS: Permission[] = [
  { id: 'microphone', label: 'Microfone', reason: 'Ouvir você quando segura o botão lateral.', kind: 'runtime', group: 'voice' },
  { id: 'assistant_role', label: 'Assistente digital padrão', reason: 'Abrir o Edji pelo botão lateral.', kind: 'special', group: 'voice' },
  { id: 'notifications', label: 'Notificações', reason: 'Avisos das rotinas e da ação Notificação.', kind: 'runtime', group: 'routines' },
  { id: 'nearby_devices', label: 'Aparelhos por perto', reason: 'Rotinas de Bluetooth, como a do carro.', kind: 'runtime', group: 'routines' },
  { id: 'fine_location', label: 'Localização precisa', reason: 'Rotinas de lugar e de Wi-Fi.', kind: 'runtime', group: 'routines' },
  {
    id: 'background_location',
    label: 'Localização o tempo todo',
    reason: 'Saber que você chegou ou saiu com o Edji fechado.',
    kind: 'special',
    group: 'routines',
    requires: 'fine_location',
  },
  { id: 'exact_alarms', label: 'Alarmes exatos', reason: 'Rotinas de horário na hora certa.', kind: 'special', group: 'routines' },
  {
    id: 'notification_access',
    label: 'Acesso a notificações',
    reason: 'Rotinas que reagem a notificações, como as do banco.',
    kind: 'special',
    group: 'routines',
  },
  { id: 'dnd_access', label: 'Acesso ao Não perturbe', reason: 'Mudar para silencioso ou Não perturbe.', kind: 'special', group: 'routines' },
  {
    id: 'background_launch',
    label: 'Abrir apps em segundo plano',
    reason: 'Abrir um app ou link quando a rotina dispara.',
    kind: 'special',
    group: 'routines',
  },
  {
    id: 'battery_unrestricted',
    label: 'Sem restrição de bateria',
    reason: 'Evita que o sistema suspenda o Edji e corte as rotinas.',
    kind: 'special',
    group: 'reliability',
    recommended: true,
  },
];

const BY_ID = new Map(PERMISSIONS.map((p) => [p.id, p]));

export function permissionById(id: PermissionId): Permission {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Unknown permission "${id}"`);
  return p;
}

/**
 * The permissions still missing for [ids], prerequisites first and without
 * repeats. Only `granted` counts as present.
 */
export function missingPermissions(ids: PermissionId[], statuses: Partial<Record<PermissionId, PermissionStatus>>): PermissionId[] {
  const missing: PermissionId[] = [];
  const visit = (id: PermissionId) => {
    const p = permissionById(id);
    if (p.requires) visit(p.requires);
    if (statuses[id] !== 'granted' && !missing.includes(id)) missing.push(id);
  };
  ids.forEach(visit);
  return missing;
}

/** Short reply for the voice session when something is missing, e.g. "Falta acesso a notificações." */
export function describeMissing(missing: PermissionId[]): string {
  if (missing.length === 0) return '';
  const labels = missing.map((id) => lowerFirst(permissionById(id).label));
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
  return `Falta permitir ${list}. Abra Permissões.`;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
