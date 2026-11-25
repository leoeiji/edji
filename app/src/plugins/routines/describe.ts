import type { Action, RoutineDraft, Trigger, Weekday } from './types';

/** Resolves names the routine only references by id. */
export type DescribeContext = { placeName(placeId: string): string | undefined };

const WEEKDAYS: Record<Weekday, string> = { 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sáb', 7: 'dom' };

/**
 * One Portuguese sentence for a routine, shown in the list and read back in
 * the voice session: "Ao conectar em Carro, abrir Spotify."
 */
export function describeRoutine(draft: Pick<RoutineDraft, 'trigger' | 'actions'>, ctx: DescribeContext): string {
  return `${describeTrigger(draft.trigger, ctx)}, ${joinPt(draft.actions.map(describeAction))}.`;
}

export function describeTrigger(trigger: Trigger, ctx: DescribeContext): string {
  switch (trigger.kind) {
    case 'bluetooth':
      return trigger.event === 'connected' ? `Ao conectar em ${trigger.device.name}` : `Ao desconectar de ${trigger.device.name}`;
    case 'wifi':
      return trigger.event === 'connected' ? `Ao conectar no Wi-Fi ${trigger.ssid}` : `Ao sair do Wi-Fi ${trigger.ssid}`;
    case 'place': {
      const place = ctx.placeName(trigger.placeId) ?? 'um lugar apagado';
      return trigger.event === 'enter' ? `Ao chegar em ${place}` : `Ao sair de ${place}`;
    }
    case 'time':
      return `${describeDays(trigger.days)} às ${trigger.at}`;
    case 'notification':
      return trigger.textContains
        ? `Ao chegar notificação do ${trigger.appLabel} com “${trigger.textContains}”`
        : `Ao chegar notificação do ${trigger.appLabel}`;
  }
}

export function describeAction(action: Action): string {
  switch (action.kind) {
    case 'open_app':
      return `abrir ${action.label}`;
    case 'notify':
      return `avisar “${action.text}”`;
    case 'open_url':
      return `abrir o link ${linkTarget(action.url)}`;
    case 'sound_mode':
      return {
        normal: 'mudar o som para normal',
        vibrate: 'pôr no vibrar',
        silent: 'pôr no silencioso',
        dnd: 'ligar o Não perturbe',
      }[action.mode];
    case 'ask_agent':
      return action.reply === 'notify' ? 'perguntar ao agente e avisar a resposta' : 'perguntar ao agente';
  }
}

function describeDays(days: Weekday[]): string {
  const key = days.join(',');
  if (days.length === 0 || key === '1,2,3,4,5,6,7') return 'Todo dia';
  if (key === '1,2,3,4,5') return 'Em dias úteis';
  if (key === '6,7') return 'Nos fins de semana';
  return `Em ${joinPt(days.map((d) => WEEKDAYS[d]))}`;
}

/** Host for web links, the scheme for app links: "spotify.com", "do app spotify". */
function linkTarget(url: string): string {
  const https = url.match(/^https:\/\/(?:www\.)?([^/?#]+)/i);
  if (https) return https[1].toLowerCase();
  return `do app ${url.split(':')[0].toLowerCase()}`;
}

/** "a", "a e b", "a, b e c". */
function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}
