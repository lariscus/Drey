import type { QuotaWindow } from '../protocol';

/** Below this remaining time share a window is about to reset: the share is held here so q stays finite. */
const MIN_TIME_SHARE = 0.01;

/**
 * The surplus of a slot (req-177, ADR-0095 later change): per window
 * `q = R / T` — the remaining share over the remaining time share — and the
 * slot's q is the minimum over its windows. q above 1 means the account has
 * more left than the time left would use up at an even pace. A value for
 * display only: choosing a slot by it is req-178.
 */
export class SurplusCalculator {
  /** One window's q; null when the window lacks the share, the reset or the span, or has already reset. */
  windowQ(window: QuotaWindow, now: Date): number | null {
    if (window.remaining === null || window.spanMs === null || window.spanMs <= 0 || window.resetsAt === null) {
      return null;
    }
    const leftMs = Date.parse(window.resetsAt) - now.getTime();
    if (!Number.isFinite(leftMs) || leftMs <= 0) {
      return null;
    }
    const timeShare = Math.max(MIN_TIME_SHARE, Math.min(1, leftMs / window.spanMs));
    return window.remaining / timeShare;
  }

  /** The slot's q: the minimum over the windows that can tell, rounded to two places; null when none can. */
  q(windows: readonly QuotaWindow[], now: Date): number | null {
    let min: number | null = null;
    for (const window of windows) {
      const q = this.windowQ(window, now);
      if (q !== null && (min === null || q < min)) {
        min = q;
      }
    }
    return min === null ? null : Math.round(min * 100) / 100;
  }
}
