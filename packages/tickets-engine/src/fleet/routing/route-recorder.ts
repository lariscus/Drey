import type { ClassRequest, FilteredSlot, RouteRecord } from '../protocol';
import type { CostEstimate } from './cost-estimate';
import type { RouteCandidate } from './route-candidate';

/** What one decision hands the recorder. */
export interface RouteDecisionInput {
  readonly request: ClassRequest;
  readonly chosen: RouteCandidate;
  readonly stepped: RouteCandidate | null;
  readonly filtered: readonly FilteredSlot[];
}

/** The filtered slots as the line lists them: one entry per slot, its reasons once each. */
function filteredText(filtered: readonly FilteredSlot[], chosenSlot: string): string {
  const bySlot = new Map<string, string[]>();
  for (const entry of filtered.filter((f) => f.slot !== chosenSlot)) {
    const reasons = bySlot.get(entry.slot) ?? [];
    if (!reasons.includes(entry.reason)) {
      reasons.push(entry.reason);
    }
    bySlot.set(entry.slot, reasons);
  }
  const parts = [...bySlot].map(([slot, reasons]) => `${slot} (${reasons.join('; ')})`);
  return parts.length === 0 ? '' : ` · filtered: ${parts.join(', ')}`;
}

/**
 * The routing's decision as a record and a line (req-178, board 8a's log):
 * `route T-0121 → claude-a/sonnet: class B, q 1.4, est $0.40 · filtered:
 * kimi (no image input)`. The record keeps every filtered slot; the line
 * leaves out the chosen slot's own (another model refused there is not why
 * the run went elsewhere).
 */
export class RouteRecorder {
  constructor(private readonly costs: CostEstimate) {}

  record(input: RouteDecisionInput): RouteRecord {
    const { request, chosen, stepped, filtered } = input;
    const final = stepped ?? chosen;
    const model = final.row?.model ?? final.entry.model;
    const q = chosen.view.q;
    const estimatedUsd = this.costs.usdFor({ ticket: request.ticket, persona: request.persona, model });
    const stepUp = stepped !== null && chosen.row !== null ? { from: chosen.row.model, fromClass: chosen.row.class } : null;
    const record = { slot: chosen.view.id, model, class: final.row?.class ?? null, requested: request.class, q, estimatedUsd, stepUp, filtered };
    return { ...record, line: this.lineOf(request.ticket, record) };
  }

  private lineOf(ticket: string, record: Omit<RouteRecord, 'line'>): string {
    const { stepUp, q, estimatedUsd } = record;
    const what = record.class === null ? 'not in the model table' : `class ${record.class}${stepUp !== null ? ` (step up from ${stepUp.from}, ${stepUp.fromClass})` : ''}`;
    const est = estimatedUsd === null ? '?' : `$${estimatedUsd.toFixed(2)}`;
    return `route ${ticket} → ${record.slot}/${record.model ?? 'default'}: ${what}, q ${q === null ? '?' : String(q)}, est ${est}${filteredText(record.filtered, record.slot)}`;
  }
}
