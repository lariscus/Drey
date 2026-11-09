/** The Slots and Governor blocks of board 8a. */
import type { I18n } from '../../../../../shared/i18n';
import type { LoadFacts, SlotFacts } from '../../../../../shared/service-window/contract';
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

export interface GovernorRowVm {
  readonly label: string;
  readonly value: string;
}

function quotaText(i18n: I18n, slot: SlotFacts, percent: number | null): string {
  if (percent === null) {
    return i18n.t('service_window.slots.no_readout');
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

/** The governor is req-180 and measures nothing yet: the labels stand, the values are dashes. */
export function governorRows(i18n: I18n, load: LoadFacts): readonly GovernorRowVm[] {
  return [
    {
      label: i18n.t('service_window.governor.heavy_seats'),
      value: i18n.t('service_window.governor.heavy_value', { count: load.heavySeats }),
    },
    {
      label: i18n.t('service_window.governor.light_seats'),
      value: i18n.t('service_window.governor.light_value'),
    },
    {
      label: i18n.t('service_window.governor.reserve'),
      value: i18n.t('service_window.governor.reserve_value', { percent: load.reserve }),
    },
    { label: i18n.t('service_window.governor.waiting'), value: i18n.t('service_window.governor.waiting_value') },
    { label: i18n.t('service_window.governor.dev_servers'), value: i18n.t('service_window.governor.dev_value') },
  ];
}
