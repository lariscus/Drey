import type { MessageKey, MessageParams } from '../../../../shared/i18n';
import { holdBadgeOf, laneTitleOf, type HoldStatus, type McHold, type McLane } from './hold';

type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * The one word a persona board row ends on (boards 10c v2 and 10e v2,
 * `T-0121 · 3/6 · Ben asks`): why it stands at You first, then a send-back's
 * stretch, then what the run does. The desktop's Tickets panel words the same
 * keys (`work.hold.*`, `board.*`).
 */
export function holdWordOf(hold: McHold, status: HoldStatus, lanes: readonly McLane[] | null, t: Translate): string {
  switch (hold.why) {
    case 'question':
      return t('work.hold.asks', { name: laneTitleOf(lanes, hold.named) || t('board.status.someone') });
    case 'second-send-back':
      return t('work.hold.sent_back_twice');
    case 'no-persona':
      return t('work.hold.no_persona');
    default:
      break;
  }
  const badge = holdBadgeOf(hold);
  if (badge === 'accept') {
    return t('board.badge.accept');
  }
  if (badge === 'sent-back-once') {
    return t('work.hold.sent_back');
  }
  return statusWordOf(status, lanes, t);
}

/** The status as the row's short word (no durations: the row has no room for them). */
export function statusWordOf(status: HoldStatus, lanes: readonly McLane[] | null, t: Translate): string {
  switch (status.kind) {
    case 'running':
      return t('board.status.running');
    case 'merging-main':
      return t('board.status.merging_main');
    case 'committing':
      return t('board.status.committing');
    case 'queued':
      return t('work.phone.queued');
    case 'waits-for':
      return t('board.status.waits_for', { name: laneTitleOf(lanes, status.persona) });
    case 'held':
      return t('board.status.held');
    case 'shaping':
      return t('board.status.shaping');
    case 'mission-turn':
      return t('board.status.mission_turn');
    case 'asks':
      return t('work.hold.asks', { name: laneTitleOf(lanes, status.persona) || t('board.status.someone') });
    case 'decide':
      return t('board.status.decide');
    case 'no-persona':
      return t('work.hold.no_persona');
    case 'ready':
      return t('board.badge.accept');
    case 'your-step':
      return t('board.status.your_step');
    case 'waiting':
      return t('board.status.waiting');
  }
}

/** The position as the row writes it: `3/6`. */
export function holdPositionOf(hold: Pick<McHold, 'position' | 'length'>, t: Translate): string {
  return t('work.hold.position', { at: hold.position, of: hold.length });
}
