/**
 * The flow editor's view models and pure helpers (E10-5, concept v2 §5.7,
 * design board "iPad: Flow editor" and its phone twin): the gates of one
 * ticket's or one part's flow, the inspector's facts and the wording of
 * the chip and the draft. The wire is `GET /api/tickets/<id>/flow[/<part>]`,
 * `POST …/flow-edit`, `…/flow-draft` and `…/flow-save`; nothing here
 * imports engine code. Nothing is saved before "Save flow": the app
 * keeps a draft, and every edit is a round trip that returns the next
 * draft.
 */
import { InjectionToken } from '@angular/core';
import type { McFlow, McFlowPersona, McFlowStep } from '../api/dto';

export type McFlowReply = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** One edit on the draft, addressed by a step's `index`. */
export type McFlowOp =
  | { readonly op: 'insert'; readonly persona: string; readonly after: number }
  | { readonly op: 'remove'; readonly step: number }
  | { readonly op: 'move'; readonly step: number; readonly dir: -1 | 1 }
  | { readonly op: 'notify'; readonly step: number; readonly on: boolean }
  | { readonly op: 'persona'; readonly step: number; readonly persona: string }
  | { readonly op: 'reset' };

/** Exactly what the flow editor consumes of the app state. */
export interface McFlowState {
  /** The draft as the desk last answered; null while it loads or when closed. */
  flow(): McFlow | null;
  /** The flow as the file holds it (the dashed marks compare against it). */
  saved(): McFlow | null;
  error(): string | null;
  readOnly(): boolean;
  /** One edit on the draft; the refusal comes back as text. */
  edit(op: McFlowOp): Promise<McFlowReply>;
  /** Paul drafts a flow; `ask` is what the owner said, null = from the ticket alone. */
  draft(ask: string | null): Promise<McFlowReply>;
  /** Paul's reason while his draft is the working draft; null otherwise. */
  paulReason(): string | null;
  /** Throws Paul's draft away (back to the draft before it). */
  undoDraft(): void;
  /** "Save flow": writes the draft; the editor closes on success. */
  save(): Promise<McFlowReply>;
  close(): void;
}

export const MC_FLOW_STATE = new InjectionToken<McFlowState>('mc-flow-state');

/** The chip's wording: the number of positions, `6 steps`. */
export function changesLabelOf(chain: readonly string[]): string {
  return `${chain.length} ${chain.length === 1 ? 'step' : 'steps'}`;
}

/** The screen's eyebrow: `Flow` for a ticket, `Flow · Part 2` for a part. */
export function eyebrowOf(flow: McFlow): string {
  return flow.scope.kind === 'part' ? `Flow · Part ${flow.scope.index + 1}` : 'Flow';
}

/** Whether the draft differs from what is saved. */
export function isDirty(flow: McFlow | null, saved: McFlow | null): boolean {
  if (flow === null || saved === null) {
    return false;
  }
  return flow.chain.join('\n') !== saved.chain.join('\n');
}

function signatureOf(step: McFlowStep): string {
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

/**
 * The positions the draft changed against the saved flow (they are drawn
 * dashed: "nothing counts before Save flow"). A position counts as
 * unchanged when it matches the saved flow's persona, mode and notify rule
 * in order (a longest common subsequence), so an added persona does not mark
 * every position after it.
 */
export function changedIndicesOf(flow: McFlow, saved: McFlow | null): ReadonlySet<number> {
  if (saved === null) {
    return new Set<number>();
  }
  const misses = unmatched(saved.steps.map(signatureOf), flow.steps.map(signatureOf));
  return new Set(flow.steps.filter((_, at) => misses.has(at)).map((step) => step.index));
}

/** What one row says besides its title: the persona's title, `you` for the owner's own position, the id of a persona with no record. */
export function whoOf(step: McFlowStep, _flow: McFlow): string {
  if (step.owner) {
    return 'you';
  }
  return step.missing ? step.persona : step.title;
}

/** A short marks line for a row: `shape`, `tell me`. */
export function marksOf(step: McFlowStep): readonly string[] {
  const marks: string[] = [];
  if (step.mode === 'shape') {
    marks.push('shape');
  }
  if (step.notify) {
    marks.push('tell me');
  }
  return marks;
}

/** The gate the selected one runs after; null for the first gate of the list. */
export function runsAfterOf(flow: McFlow, step: McFlowStep): McFlowStep | null {
  const at = flow.steps.findIndex((s) => s.index === step.index);
  return at > 0 ? flow.steps[at - 1]! : null;
}

/** Whether a gate may move one place earlier / later (the same rules the desk enforces). */
export function moveRoomOf(flow: McFlow, step: McFlowStep): { readonly earlier: boolean; readonly later: boolean } {
  if (step.locked || step.state === 'current') {
    return { earlier: false, later: false };
  }
  const at = flow.steps.findIndex((s) => s.index === step.index);
  const above = flow.steps[at - 1];
  const below = flow.steps[at + 1];
  return { earlier: above !== undefined && above.state === 'future' && !above.locked, later: below !== undefined };
}

/** The personas a position can be added for or given to: the whole crew. */
export function addablePersonasOf(flow: McFlow): readonly McFlowPersona[] {
  return flow.personas;
}
