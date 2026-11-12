import { lockedCount, renderChainEntries } from '../core/chain-list';
import { validateChain } from '../core/chain-validate';
import { parsePlanChain } from '../core/plan-chain';
import { setDocumentField } from '../store/document-fields';
import type { RunCursor } from './protocol';
import { cursorChain } from './run-cursor';

/** What a chain run's green end writes into the ticket document, and what it says about the plan's chain. */
export interface AdvancedText {
  readonly text: string;
  /** Null when the plan carries no new chain; else the line the release's comment adds. */
  readonly chainNote: string | null;
}

/**
 * The document a chain run's green end leaves inside its claim (req-257):
 * the cursor's next position, and — when the run's plan carries a `### Chain`
 * that differs from the ticket's and holds under the write guard (personas of
 * the crew, nothing changed at or before the cursor) — that chain as the
 * ticket's (`x-chain`). A chain that does not hold leaves the ticket's as it
 * was and says why. Pure over the document text.
 */
export function advancedText(text: string, cursor: RunCursor): AdvancedText {
  const atNext = setDocumentField(text, 'x-at', String(cursor.at + 1)) ?? text;
  if (cursor.crew === undefined) {
    return { text: atNext, chainNote: null };
  }
  const plan = parsePlanChain(text);
  if (plan.kind === 'none') {
    return { text: atNext, chainNote: null };
  }
  if (plan.kind === 'unreadable') {
    return { text: atNext, chainNote: `the plan's ### Chain was not applied — ${plan.error}` };
  }
  const line = renderChainEntries(plan.entries).join(';');
  if (line === (cursor.entries ?? []).join(';')) {
    return { text: atNext, chainNote: null };
  }
  const saved = cursorChain(cursor);
  const refusal = validateChain(plan.entries, { personas: cursor.crew.personas, modeless: cursor.crew.modeless, saved, locked: lockedCount(cursor.at, saved.length) });
  if (refusal !== null) {
    return { text: atNext, chainNote: `the plan's ### Chain was not applied — ${refusal}` };
  }
  return { text: setDocumentField(atNext, 'x-chain', line) ?? atNext, chainNote: `the plan's ### Chain is the ticket's chain now: ${renderChainEntries(plan.entries).join('; ')}` };
}
