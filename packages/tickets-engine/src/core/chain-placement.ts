/**
 * Where a chain ticket stands on the persona board (req-257): the pipeline
 * holds the lifecycle columns only, so an `active` / `running` ticket's
 * column is DERIVED from its chain — never stored:
 *
 * - the chain is through (the cursor past its last entry) -> the terminal
 *   column (the engine moves it to `done` right after);
 * - anything else -> null: the reader shows the stage itself as one
 *   "active" column, and the board's lanes draw the holder.
 */
import type { ChainEntry } from '../contracts/chain';

/** The chain fields the placement reads. */
export interface ChainPlacementInput {
  readonly chain: readonly ChainEntry[] | undefined;
  readonly at: number | undefined;
}

/** True when the cursor stands past the chain's last entry: every entry is done. */
export function chainFinished(chain: readonly ChainEntry[] | undefined, at: number | undefined): boolean {
  return chain !== undefined && chain.length > 0 && (at ?? 1) > chain.length;
}

/** The column of an `active` / `running` chain ticket; null = the stage's own column. */
export function chainColumnOf(ticket: ChainPlacementInput, terminal: string | null): string | null {
  return chainFinished(ticket.chain, ticket.at) ? terminal : null;
}
