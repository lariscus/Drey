import { CAPABILITY_CLASSES, type CapabilityClass, type ClassRequest, type ModelRow, type SlotView } from '../protocol';
import type { ModelTable } from './model-table';
import type { RoutingSettingsView } from './reserve-guard';
import type { RouteCandidate } from './route-candidate';
import type { SlotFit } from './slot-fit';

/** What the step up reads of the settings: the threshold and the table. */
export interface StepUpSettings extends RoutingSettingsView {
  table(): ModelTable;
}

const rank = (c: CapabilityClass): number => CAPABILITY_CLASSES.indexOf(c);

/**
 * The model step up within the slot (req-178, board 7l's `Upgrade above
 * q`): when the chosen slot's surplus is above the threshold, the session
 * runs the next stronger model of its persona's pool that the same slot
 * serves — the lightest class above the one granted, in the pool's order —
 * when that model passes the filter there too (its sessions, the caps, the
 * ledger, the reserve). One step, only upwards, never onto another slot;
 * never on a pinned model or class (the request says `stepUp: false`).
 */
export class StepUp {
  constructor(
    private readonly settings: StepUpSettings,
    private readonly fit: SlotFit,
  ) {}

  /** The stepped candidate; null when the chosen one stays. */
  consider(chosen: RouteCandidate, request: ClassRequest, providerViews: readonly SlotView[]): RouteCandidate | null {
    const threshold = this.settings.routing().upgradeAboveQ;
    const q = chosen.view.q;
    if (request.stepUp !== true || chosen.row === null || threshold === null || q === null || q <= threshold) {
      return null;
    }
    const steps = this.stronger(chosen.row, chosen.view, request);
    const next = steps[0]?.row.class ?? null;
    for (const step of steps.filter((s) => s.row.class === next)) {
      const candidate: RouteCandidate = { row: step.row, entry: request.pool[step.order]!, provider: step.row.provider, view: chosen.view, order: step.order };
      if (this.fit.refusal(candidate, chosen.view, request, providerViews) === null) {
        return candidate;
      }
    }
    return null;
  }

  /** The pool's rows on this slot above the granted class, lightest class first, then pool order. */
  private stronger(granted: ModelRow, view: SlotView, request: ClassRequest): { row: ModelRow; order: number }[] {
    const table = this.settings.table();
    const found: { row: ModelRow; order: number }[] = [];
    request.pool.forEach((entry, order) => {
      const row = entry.model === null ? null : table.rowOn(entry.model, view);
      if (row !== null && (entry.provider === null || entry.provider === view.provider) && rank(row.class) < rank(granted.class)) {
        found.push({ row, order });
      }
    });
    return found.sort((a, b) => rank(b.row.class) - rank(a.row.class) || a.order - b.order);
  }
}
