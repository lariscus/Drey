/**
 * What happens at a chain entry (req-269, the persona board concept §14
 * reading 7), decided by the kind of the persona the entry names — the one
 * answer req-257's dispatch asks before it does anything at the cursor:
 *
 * - `run` — an agent persona: the runner dispatches a session (a slot, a
 *   class, a budget).
 * - `mission-turn` — Mission Control's persona (Pia): a Mission Control turn
 *   on the ticket — a direct call over the chat bridge with her prompt and
 *   her intents, every change a card the owner confirms; no session, no
 *   slot, no budget (R9: Pia executes, she does not work).
 * - `owner` — the human persona: the ticket parks for the owner (Accept /
 *   Send back).
 * - `missing` — the entry names no readable persona (deleted, misspelled):
 *   the ticket stands at You with *no persona for position n*.
 */
import type { Persona } from './persona';

export type ChainEntryWork = 'run' | 'mission-turn' | 'owner' | 'missing';

/** The work at an entry whose persona was looked up; null = no readable persona. */
export function entryWorkOf(persona: Pick<Persona, 'kind'> | null | undefined): ChainEntryWork {
  switch (persona?.kind) {
    case 'agent':
      return 'run';
    case 'mission':
      return 'mission-turn';
    case 'human':
      return 'owner';
    default:
      return 'missing';
  }
}
