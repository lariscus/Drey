/** The Slots block of board 8a (the Governor block: governor-rows.ts). */
import type { I18n } from '../../../../../shared/i18n';
import type { SlotFacts } from '../../../../../shared/service-window/contract';
import { joinParts, weekdayTime } from './format';

export interface SlotRowVm {
  readonly id: string;
  readonly label: string;
  /** One entry per seat: true = busy. */
  readonly seats: readonly boolean[];
  readonly busyTitle: string;
  /** Bar fill 0-100; null draws the empty track. */
  readonly fill: number | null;
  readonly text: string;
  readonly reliability: SlotFacts['reliability'];
  readonly reliabilityLabel: string;
}

/** req-317: no share to draw — what the runner counted instead, or that it counted nothing yet. */
function countedText(i18n: I18n, slot: SlotFacts): string {
  if (slot.used === null || slot.unit === null || slot.used <= 0) {
    return i18n.t('service_window.slots.no_runs');
  }
  return i18n.t(`service_window.slots.counted_${slot.unit}`, { count: slot.used });
}

function quotaText(i18n: I18n, slot: SlotFacts, percent: number | null): string {
  if (percent === null) {
    return countedText(i18n, slot);
  }
  const q = slot.q === null ? null : i18n.formatNumber(slot.q, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return joinParts([
    i18n.t('service_window.slots.percent', { percent }),
    q === null ? null : i18n.t('service_window.slots.q', { q }),
    slot.resetsAt === null ? null : i18n.t('service_window.slots.resets', { when: weekdayTime(i18n, slot.resetsAt) }),
  ]);
}

export function slotRows(i18n: I18n, slots: readonly SlotFacts[] | null): readonly SlotRowVm[] {
  return (slots ?? []).map((slot) => {
    const total = Math.max(0, slot.total);
    const percent = slot.left === null ? null : Math.round(slot.left * 100);
    return {
      id: slot.id,
      label: slot.label,
      seats: Array.from({ length: total }, (_, index) => index < slot.busy),
      busyTitle: i18n.t('service_window.slots.busy', { busy: slot.busy, total }),
      fill: percent === null ? null : Math.min(100, Math.max(0, percent)),
      text: quotaText(i18n, slot, percent),
      reliability: slot.reliability,
      reliabilityLabel: i18n.t(`service_window.slots.${slot.reliability}`),
    };
  });
}
