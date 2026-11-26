import type { PermissionId } from '@/core/permissions';
import type { Action, RoutineDraft, Trigger } from './types';

const TRIGGER_PERMISSIONS: Record<Trigger['kind'], PermissionId[]> = {
  bluetooth: ['nearby_devices'],
  wifi: ['fine_location', 'background_location'],
  place: ['fine_location', 'background_location'],
  time: ['exact_alarms'],
  notification: ['notification_access'],
};

function actionPermissions(action: Action): PermissionId[] {
  switch (action.kind) {
    case 'open_app':
    case 'open_url':
      return ['background_launch'];
    case 'notify':
      return ['notifications'];
    case 'sound_mode':
      // Normal and vibrate need nothing; leaving silent or DND touches the DND policy.
      return action.mode === 'silent' || action.mode === 'dnd' ? ['dnd_access'] : [];
    case 'ask_agent':
      return action.reply === 'notify' ? ['notifications'] : [];
  }
}

/** Every permission a routine needs to run, without repeats, trigger first. */
export function requiredPermissions(draft: Pick<RoutineDraft, 'trigger' | 'actions'>): PermissionId[] {
  const ids = [...TRIGGER_PERMISSIONS[draft.trigger.kind], ...draft.actions.flatMap(actionPermissions)];
  return [...new Set(ids)];
}

/** Whether the routine sends text to the agent, which needs the routines opt-in besides permissions. */
export function usesNetwork(draft: Pick<RoutineDraft, 'actions'>): boolean {
  return draft.actions.some((a) => a.kind === 'ask_agent');
}
