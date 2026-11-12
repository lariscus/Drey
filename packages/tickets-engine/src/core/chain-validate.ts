/**
 * The chain's guard for WRITES (req-266, the persona board concept §6):
 * every entry names a persona that exists when an editor writes it, the
 * chain is not empty and not longer than the cap, and no edit touches a
 * position at or before the cursor — past entries and the current one stay
 * as they are (the current entry's notify rule may still change). A persona
 * deleted after the write is not a validation error on a stored ticket:
 * that is the "no persona for position n" case the runner handles
 * (req-257). Pure: the caller hands in the persona ids and the saved chain.
 */
import { MAX_CHAIN_ENTRIES, type ChainEntry } from '../contracts/chain';
import { renderChainEntry } from './chain-list';

export interface ChainGuard {
  /** The persona ids under `_meta/personas/` (the human persona included). */
  readonly personas: readonly string[];
  /** The chain as the ticket holds it now — what the locked positions are compared with. */
  readonly saved: readonly ChainEntry[];
  /** How many leading positions are locked (core/chain-list.ts `lockedCount`). */
  readonly locked: number;
}

function sameStep(a: ChainEntry, b: ChainEntry): boolean {
  return a.persona === b.persona && a.mode === b.mode;
}

/** The refusal line, or null when the chain may be written. */
export function validateChain(entries: readonly ChainEntry[], guard: ChainGuard): string | null {
  if (entries.length === 0) {
    return 'a chain needs at least one persona';
  }
  if (entries.length > MAX_CHAIN_ENTRIES) {
    return `a chain holds at most ${MAX_CHAIN_ENTRIES} entries`;
  }
  for (const [index, entry] of entries.entries()) {
    if (!guard.personas.includes(entry.persona)) {
      return `position ${index + 1}: persona "${entry.persona}" does not exist`;
    }
  }
  for (let index = 0; index < guard.locked; index += 1) {
    const was = guard.saved[index];
    const now = entries[index];
    if (was === undefined) {
      break;
    }
    const isCurrent = index === guard.locked - 1;
    if (now === undefined || !sameStep(was, now) || (!isCurrent && was.notify !== now.notify)) {
      return `position ${index + 1} (${renderChainEntry(was)}) is ${isCurrent ? 'the current step' : 'done'} — only the positions after it can change`;
    }
  }
  return null;
}
