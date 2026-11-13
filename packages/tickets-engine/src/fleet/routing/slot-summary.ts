import type { QuotaWindow, SlotSummary, SlotView } from '../protocol';

/** The window the 7e chip shows: the longest one (the week, or the month), else the first. */
function headlineWindow(windows: readonly QuotaWindow[]): QuotaWindow | null {
  let best: QuotaWindow | null = null;
  for (const window of windows) {
    if (best === null || (window.spanMs ?? 0) > (best.spanMs ?? 0)) {
      best = window;
    }
  }
  return best;
}

/** A slot as the Capacity band's Slots row needs it (req-177, board 7e). */
export function slotSummaryOf(view: SlotView): SlotSummary {
  const window = headlineWindow(view.windows);
  return {
    id: view.id,
    label: view.label,
    state: view.state,
    busy: view.busy,
    total: view.total,
    remaining: window?.remaining ?? null,
    reliability: window?.reliability ?? 'unknown',
    q: view.q,
    resetsAt: window?.resetsAt ?? null,
  };
}
