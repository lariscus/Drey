import type { PriorityConfig } from '../contracts/tickets';
import { readStoreConfigText, tomlList, tomlString, tomlTable } from './store-config-text';
import { defaultGitRun, type GitRun } from './store-git-probe';

/**
 * A dricket store's priority vocabulary (D-11): `[priorities]` of `dricket.toml`,
 * which lives on the store's `main` branch, not on the ticket branch. On a dricket
 * board this is the vocabulary (dk refuses every other value), whatever
 * `pipeline.md` says. Read only: the file belongs to the store's admins.
 */

/** dk's starting set: what applies without a `[priorities]` table (dricket ADR-0005). */
export const DK_STARTING_PRIORITIES: PriorityConfig = { order: ['critical', 'high', 'normal', 'low'], default: 'normal' };

/** The vocabulary of a `dricket.toml` text; dk's starting set when it has no usable `[priorities]` table. */
export function parseStorePriorities(toml: string): PriorityConfig {
  const table = tomlTable(toml, 'priorities');
  const order = table === null ? [] : (tomlList(table, 'values') ?? []);
  if (table === null || order.length === 0) {
    return DK_STARTING_PRIORITIES;
  }
  const fallback = tomlString(table, 'default');
  return { order, default: fallback !== null && order.includes(fallback) ? fallback : order[0]! };
}

/** The store's vocabulary, or null when no ref holds a `dricket.toml` (unknown: the caller keeps what it has). */
export async function readStorePriorities(checkout: string, run: GitRun = defaultGitRun): Promise<PriorityConfig | null> {
  const config = await readStoreConfigText(checkout, run);
  return config === null ? null : parseStorePriorities(config.text);
}
