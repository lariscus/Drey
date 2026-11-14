/**
 * The Flow tab's pure half (E13-11): what the gate rows say, which gates
 * the draft changed against the saved flow, what the inspector offers.
 * The grammar and every edit stay in the engine (`core/flow-edit.ts`);
 * this file only reads the engine's `FlowReply`, the same shape the phone's
 * editor renders (`libs/mission-ui/src/flow/flow.model.ts` is its twin).
 */
import { STANDARD_FLOW_ID, type FlowPersona, type FlowReply, type FlowStepView } from '../../../../packages/tickets-engine/src/contracts/flow';

/** An answer the desk gave for a flow, minus the failure case. */
export type FlowDraft = Extract<FlowReply, { readonly ok: true }>;

/** The chip's wording: the number of positions, `6 steps`. */
export function changesLabelOf(chain: readonly string[]): string {
  return `${chain.length} ${chain.length === 1 ? 'step' : 'steps'}`;
}

/** The tab's eyebrow: `Flow` for a ticket, `Flow · Part 2` for a part. */
export function eyebrowOf(flow: FlowDraft): string {
  return flow.scope.kind === 'part' ? `Flow · Part ${flow.scope.index + 1}` : 'Flow';
}

/** Whether the draft differs from what was last saved. */
export function isDirty(flow: FlowDraft | null, saved: FlowDraft | null): boolean {
  if (flow === null || saved === null) {
    return false;
  }
  return flow.chain.join('\n') !== saved.chain.join('\n');
}

function signatureOf(step: FlowStepView): string {
  return [step.persona, step.mode ?? '', step.notify ? 'n' : ''].join('|');
}

/** The indices of `after` that sit outside a longest common subsequence with `before` — what an edit added or changed. */
function unmatched(before: readonly string[], after: readonly string[]): ReadonlySet<number> {
  const rows = before.length + 1;
  const cols = after.length + 1;
  const len: number[] = new Array<number>(rows * cols).fill(0);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      len[i * cols + j] = before[i] === after[j] ? len[(i + 1) * cols + j + 1]! + 1 : Math.max(len[(i + 1) * cols + j]!, len[i * cols + j + 1]!);
    }
  }
  const out = new Set<number>();
  let i = 0;
  let j = 0;
  while (j < after.length) {
    if (i < before.length && before[i] === after[j]) {
      i += 1;
      j += 1;
    } else if (i < before.length && len[(i + 1) * cols + j]! >= len[i * cols + j + 1]!) {
      i += 1;
    } else {
      out.add(j);
      j += 1;
    }
  }
  return out;
}

/** The positions the draft changed against the saved flow; they are drawn dashed until "Save flow". */
export function changedIndicesOf(flow: FlowDraft, saved: FlowDraft | null): ReadonlySet<number> {
  if (saved === null) {
    return new Set<number>();
  }
  const misses = unmatched(saved.steps.map(signatureOf), flow.steps.map(signatureOf));
  return new Set(flow.steps.filter((_, at) => misses.has(at)).map((step) => step.index));
}

/** Who works a position, for its row: the persona's title, the owner's own name for the owner's position. */
export function whoOf(step: FlowStepView, flow: FlowDraft): string {
  if (step.owner) {
    return humanNameOf(flow);
  }
  return step.missing ? step.persona : step.title;
}

/** The owner's display name: the human persona's title (configurable, default `You`). */
export function humanNameOf(flow: Pick<FlowDraft, 'personas'>): string {
  return flow.personas.find((p) => p.kind === 'human')?.title ?? 'You';
}

/** The short marks on a position's row. */
export function marksOf(step: FlowStepView): readonly string[] {
  const marks: string[] = [];
  if (step.mode === 'shape') {
    marks.push('Shape');
  }
  if (step.notify) {
    marks.push('Tell me');
  }
  return marks;
}

/** The gate the selected one runs after; null for the first of the list. */
export function runsAfterOf(flow: FlowDraft, step: FlowStepView): FlowStepView | null {
  const at = flow.steps.findIndex((s) => s.index === step.index);
  return at > 0 ? flow.steps[at - 1]! : null;
}

/** Whether a gate may move one place earlier / later (the engine enforces the same rules). */
export function moveRoomOf(flow: FlowDraft, step: FlowStepView): { readonly earlier: boolean; readonly later: boolean } {
  if (step.locked || step.state === 'current') {
    return { earlier: false, later: false };
  }
  const at = flow.steps.findIndex((s) => s.index === step.index);
  const above = flow.steps[at - 1];
  const below = flow.steps[at + 1];
  return { earlier: above !== undefined && above.state === 'future' && !above.locked, later: below !== undefined };
}

/** The personas a position can be added for: the whole crew. */
export function addablePersonasOf(flow: FlowDraft): readonly FlowPersona[] {
  return flow.personas;
}

/** The personas a position can be given: the whole crew. */
export function personasFor(flow: FlowDraft): readonly FlowPersona[] {
  return flow.personas;
}

/** The flow tab's fixed key for a ticket (and optionally one plan part). */
export const FLOW_SCHEME = 'flow://';

export interface FlowTarget {
  readonly ticketId: string;
  /** 0-based part index; null = the ticket's own chain. */
  readonly part: number | null;
}

export const flowKeyOf = (target: FlowTarget): string =>
  `${FLOW_SCHEME}${target.ticketId}${target.part === null ? '' : `/${target.part}`}`;

export const flowTitleOf = (target: FlowTarget): string =>
  isStandardFlow(target) ? 'Flow · Default' : target.part === null ? `Flow · ${target.ticketId}` : `Flow · ${target.ticketId} · Part ${target.part + 1}`;

/** The target is the default flow itself (E10-5b), not a ticket's. */
export const isStandardFlow = (target: FlowTarget): boolean => target.ticketId === STANDARD_FLOW_ID;

/** The target a flow key names; null for any other key. */
export function flowTargetOfKey(key: string): FlowTarget | null {
  const match = /^flow:\/\/(T-\d{4,}|standard)(?:\/(\d{1,3}))?$/.exec(key);
  return match === null ? null : { ticketId: match[1]!, part: match[2] === undefined ? null : Number(match[2]) };
}
