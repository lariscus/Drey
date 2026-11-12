/**
 * The flow editor's pure half (E10-5, re-cut by req-266): edits on a
 * ticket's (or a plan part's) chain — the ordered list of personas — and
 * the list itself is what gets written. Add a persona after a position,
 * remove one, move one earlier or later, change who takes a position, the
 * notify rule, or reset to the standard flow (`flow:` in pipeline.md).
 *
 * Only positions after the cursor are editable: past entries and the
 * current one are locked (a running step stays as it is). Every result is
 * checked by `validateChain` before it returns.
 */
import type { ChainEntry } from '../contracts/chain';
import { renderChainEntries } from './chain-list';
import { validateChain, type ChainGuard } from './chain-validate';

/** One edit on the draft, addressed by the entry's 0-based index in the chain. */
export type FlowOp =
  | { readonly op: 'view' }
  /** Adds `persona` after the entry at `after`; -1 = at the front. */
  | { readonly op: 'insert'; readonly persona: string; readonly after: number }
  | { readonly op: 'remove'; readonly step: number }
  | { readonly op: 'move'; readonly step: number; readonly dir: -1 | 1 }
  | { readonly op: 'notify'; readonly step: number; readonly on: boolean }
  | { readonly op: 'persona'; readonly step: number; readonly persona: string }
  | { readonly op: 'reset' };

export type FlowEdit =
  | { readonly ok: true; readonly entries: readonly ChainEntry[]; readonly chain: readonly string[] }
  | { readonly ok: false; readonly error: string };

/** What an edit is checked against: the guard of `validateChain` plus the standard flow a reset returns to. */
export interface FlowContext extends ChainGuard {
  readonly standard: readonly ChainEntry[];
}

function refuse(error: string): FlowEdit {
  return { ok: false, error };
}

function finish(entries: readonly ChainEntry[], context: FlowContext): FlowEdit {
  const refusal = validateChain(entries, context);
  return refusal === null ? { ok: true, entries, chain: renderChainEntries(entries) } : refuse(refusal);
}

function lockedLine(index: number, context: FlowContext): string {
  return `position ${index + 1} is ${index === context.locked - 1 ? 'the current step' : 'done'} — only the positions after it can change`;
}

/** The standard flow with the locked positions kept as they are. */
function reset(entries: readonly ChainEntry[], context: FlowContext): ChainEntry[] {
  const kept = entries.slice(0, context.locked);
  return [...kept, ...context.standard.slice(kept.length)];
}

/** Applies one edit to the chain; the result is the new list, validated. */
export function applyFlowOp(entries: readonly ChainEntry[], edit: FlowOp, context: FlowContext): FlowEdit {
  if (edit.op === 'view') {
    return finish(entries, context);
  }
  if (edit.op === 'reset') {
    return finish(reset(entries, context), context);
  }
  if (edit.op === 'insert') {
    if (edit.after < -1 || edit.after >= entries.length) {
      return refuse('no such position to add after');
    }
    if (edit.after + 1 < context.locked) {
      return refuse(lockedLine(edit.after + 1, context));
    }
    const next = [...entries];
    next.splice(edit.after + 1, 0, { persona: edit.persona, mode: null, notify: false });
    return finish(next, context);
  }
  const at = entries[edit.step];
  if (at === undefined) {
    return refuse('no such position');
  }
  const isCurrentNotify = edit.op === 'notify' && edit.step === context.locked - 1;
  if (edit.step < context.locked && !isCurrentNotify) {
    return refuse(lockedLine(edit.step, context));
  }
  const next = [...entries];
  switch (edit.op) {
    case 'remove':
      next.splice(edit.step, 1);
      return finish(next, context);
    case 'move': {
      const to = edit.step + edit.dir;
      if (to < 0 || to >= entries.length) {
        return refuse(edit.dir < 0 ? 'that is the first position' : 'that is the last position');
      }
      if (to < context.locked) {
        return refuse(`it cannot move ahead of position ${to + 1} — that one has begun`);
      }
      next[edit.step] = entries[to]!;
      next[to] = at;
      return finish(next, context);
    }
    case 'notify':
      next[edit.step] = { ...at, notify: edit.on };
      return finish(next, context);
    case 'persona':
      next[edit.step] = { ...at, persona: edit.persona };
      return finish(next, context);
  }
}
