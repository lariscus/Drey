import type { ChainEntry } from '../contracts/chain';
import { lockedCount, renderChainEntries } from '../core/chain-list';
import { cursorAfterGreen } from '../core/chain-red-gate';
import { validateChain } from '../core/chain-validate';
import { parsePlanChain } from '../core/plan-chain';
import { documentField, setDocumentField } from '../store/document-fields';
import type { RunCursor } from './protocol';
import { cursorChain } from './run-cursor';

/** req-78: the store fields of the red-gate loop. */
const RETURN_TO_KEY = 'x-return-to';
const RED_BACKS_KEY = 'x-red-backs';

/** What a chain run's green end writes into the ticket document, and what it says about the plan's chain. */
export interface AdvancedText {
  readonly text: string;
  /** Null when the plan carries no new chain; else the line the release's comment adds. */
  readonly chainNote: string | null;
  /** The position the cursor stands at now (`length + 1` = the chain is through). */
  readonly next: number;
  /** req-78: true when the cursor went straight back to the position whose red gate sent the ticket here. */
  readonly returned: boolean;
}

/** The plan's `### Chain` as the ticket's new chain, or the note why not; null = none to apply. */
function planChainOf(text: string, cursor: RunCursor): { readonly entries: readonly ChainEntry[] | null; readonly note: string | null } {
  const plan = cursor.crew === undefined ? ({ kind: 'none' } as const) : parsePlanChain(text);
  if (plan.kind === 'none') {
    return { entries: null, note: null };
  }
  if (plan.kind === 'unreadable') {
    return { entries: null, note: `the plan's ### Chain was not applied — ${plan.error}` };
  }
  if (renderChainEntries(plan.entries).join(';') === (cursor.entries ?? []).join(';')) {
    return { entries: null, note: null };
  }
  const saved = cursorChain(cursor);
  const crew = cursor.crew!;
  const refusal = validateChain(plan.entries, { personas: crew.personas, modeless: crew.modeless, saved, locked: lockedCount(cursor.at, saved.length) });
  return refusal !== null ? { entries: null, note: `the plan's ### Chain was not applied — ${refusal}` } : { entries: plan.entries, note: `the plan's ### Chain is the ticket's chain now: ${renderChainEntries(plan.entries).join('; ')}` };
}

/** req-78: the position a red gate sent the ticket back from, read inside the claim; undefined when none stands after the cursor. */
function returnToOf(text: string): number | undefined {
  const raw = documentField(text, RETURN_TO_KEY);
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : undefined;
}

/**
 * req-78: the return holds only while the position still names the persona that went red — a replan
 * that moved it drops the return (the cursor walks on).
 */
function returnHolds(before: readonly ChainEntry[], after: readonly ChainEntry[], position: number): boolean {
  return before[position - 1]?.persona !== undefined && before[position - 1]?.persona === after[position - 1]?.persona;
}

/**
 * The document a chain run's green end leaves inside its claim (req-257):
 * the cursor's next position, and — when the run's plan carries a `### Chain`
 * that differs from the ticket's and holds under the write guard (personas of
 * the crew, nothing changed at or before the cursor) — that chain as the
 * ticket's (`x-chain`). A chain that does not hold leaves the ticket's as it
 * was and says why. req-78: a pending `x-return-to` after the cursor sends
 * it straight back there and is cleared; a green end that is no return ends
 * the red-gate loop (`x-red-backs` cleared). Pure over the document text.
 */
export function advancedText(text: string, cursor: RunCursor): AdvancedText {
  const plan = planChainOf(text, cursor);
  const before = cursorChain(cursor);
  const after = plan.entries ?? before;
  const pending = returnToOf(text);
  const held = pending !== undefined && returnHolds(before, after, pending) ? pending : undefined;
  const { at: next, returned } = cursorAfterGreen(after.length, cursor.at, held);
  const steps: ((doc: string) => string | null)[] = [
    (doc) => setDocumentField(doc, 'x-at', String(next)),
    (doc) => (pending === undefined ? doc : setDocumentField(doc, RETURN_TO_KEY, null)),
    (doc) => (returned ? doc : setDocumentField(doc, RED_BACKS_KEY, null)),
    (doc) => (plan.entries === null ? doc : setDocumentField(doc, 'x-chain', renderChainEntries(plan.entries).join(';'))),
  ];
  const written = steps.reduce((doc, step) => step(doc) ?? doc, text);
  const dropped = pending !== undefined && held === undefined && pending > cursor.at ? `the return to position ${pending} is dropped — the chain changed there` : null;
  return { text: written, chainNote: [plan.note, dropped].filter((note): note is string => note !== null).join('; ') || null, next, returned };
}
