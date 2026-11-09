import type { RoutingSettings, SlotView } from '../protocol';

/** Who a start spends for: the share estimate looks at their earlier runs. */
export interface ShareSubject {
  readonly ticket: string;
  readonly persona: string | null;
}

/** What a run is expected to take of a slot's window (0–1). */
export interface ShareEstimates {
  shareOf(subject: ShareSubject, slotId: string, window: string): number;
}

/** What the guard reads of the settings. */
export interface RoutingSettingsView {
  routing(): RoutingSettings;
}

const percent = (share: number): string => `${Math.round(share * 100)} %`;

/**
 * The reserve per window (req-178, board 7l's `Reserve per window`): a
 * share of every quota window is kept back. A start whose estimated share
 * would take any window of the slot below it waits — it frees as the
 * window resets. A window whose remaining share is not known is not
 * guarded (nothing to measure against); a reserve of 0 guards nothing.
 */
export class ReserveGuard {
  constructor(
    private readonly settings: RoutingSettingsView,
    private readonly shares: ShareEstimates,
  ) {}

  /** Why the slot cannot take this run without eating into its reserve; null when it can. */
  refusal(view: SlotView, subject: ShareSubject): string | null {
    const reserve = this.settings.routing().reservePerWindow;
    if (reserve <= 0) {
      return null;
    }
    for (const window of view.windows) {
      if (window.remaining === null) {
        continue;
      }
      const share = this.shares.shareOf(subject, view.id, window.name);
      if (window.remaining - share < reserve - 1e-9) {
        return `${view.label}: ${window.name} window ${percent(window.remaining)} left, a run takes about ${percent(share)}, ${percent(reserve)} is kept in reserve`;
      }
    }
    return null;
  }
}
