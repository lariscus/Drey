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
import { HUMAN_PERSONA_ID } from './persona';

export interface ChainGuard {
  /** The persona ids under `_meta/personas/` (the human persona included). */
  readonly personas: readonly string[];
  /**
   * The persona ids that are not agents besides `you` — Mission Control's
   * persona (req-269): an entry naming one takes no mode, since only an
   * agent's run can be the interactive one. `you` is always one of them.
   */
  readonly modeless?: readonly string[];
  /** The chain as the ticket holds it now — what the locked positions are compared with. */
  readonly saved: readonly ChainEntry[];
  /** How many leading positions are locked (core/chain-list.ts `lockedCount`). */
  readonly locked: number;
}

function sameStep(a: ChainEntry, b: ChainEntry): boolean {
  return a.persona === b.persona && a.mode === b.mode;
}

/** One entry's refusal: an unknown persona, or (after the cursor) a mode on an entry that is not an agent's (req-269). */
function entryRefusal(entry: ChainEntry, index: number, guard: ChainGuard): string | null {
  if (!guard.personas.includes(entry.persona)) {
    return `position ${index + 1}: persona "${entry.persona}" does not exist`;
  }
  const modeless = entry.persona === HUMAN_PERSONA_ID || (guard.modeless ?? []).includes(entry.persona);
  if (index >= guard.locked && entry.mode !== null && modeless) {
    return `position ${index + 1}: only an agent persona's entry takes a mode — ${renderChainEntry(entry)}`;
  }
  return null;
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
    const refusal = entryRefusal(entry, index, guard);
    if (refusal !== null) {
      return refusal;
    }
  }
  return lockedRefusal(entries, guard);
}

/** The first locked position the edit changed, or null: past entries stay, the current one may change only its notify rule. */
function lockedRefusal(entries: readonly ChainEntry[], guard: ChainGuard): string | null {
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
