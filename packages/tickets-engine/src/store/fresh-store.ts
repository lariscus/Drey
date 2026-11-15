import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * The fresh install's dricket store (E14-9b item 6): with no store configured,
 * Drey creates one beside the meta vault and runs it itself — the engine's
 * start for an existing board, "Initialize board" for a fresh one. The store
 * stands on the lifecycle stages (`inbox prioritized active running done`,
 * `claim = ["running"]`) with the board's priority vocabulary; the working
 * copy is left on the `tickets` branch, where the board reads it.
 *
 * `dk init` has no stage option yet (R-27) and writes a `dricket.toml` whose
 * built-in `[transitions.agent]` names dk's own stages — with a `[stages]`
 * table that table is invalid. So the creation is: `dk init <dir>`, then one
 * commit on `main` that swaps the tables, then the checkout back to
 * `tickets`.
 */

/** Where a fresh install's store goes: beside the meta vault, as `<vault>-tickets-store`. */
export function defaultStorePathOf(vaultPath: string): string {
  return path.join(path.dirname(vaultPath), `${path.basename(vaultPath)}-tickets-store`);
}

/** The store's `dricket.toml`: dk's built-in stage table out, the lifecycle stages in. */
export function lifecycleStoreToml(initToml: string): string {
  const withoutAgentTransitions = initToml.replace(/\[transitions\.agent\][\s\S]*?(?=\n\[|$)/, '');
  const withBoardPriorities = withoutAgentTransitions.replace(
    'values = ["critical", "high", "normal", "low"]',
    'values = ["urgent", "high", "normal", "low"]',
  );
  return `${withBoardPriorities.replace(/\s*$/, '\n')}\n[stages]\nvalues = ["inbox", "prioritized", "active", "running", "done"]\ninitial = "inbox"\nterminal = ["done"]\nclaim = ["running"]\ncancelled = "cancelled"\n`;
}

/** The pieces of the creation that touch the machine: the dk binary and git in the store. */
export interface FreshStoreIo {
  /** The `dk` executable; empty = `dk` on PATH. */
  readonly dkPath: string;
  /** One git invocation inside the store directory (the engine's TicketsGit). */
  git(cwd: string, args: readonly string[]): Promise<unknown>;
  log?(line: string): void;
}

/** Creates the store at `dir` on the lifecycle stages; throws with dk's or git's message. */
export async function initLifecycleStore(dir: string, io: FreshStoreIo): Promise<void> {
  const dk = io.dkPath === '' ? 'dk' : io.dkPath;
  await promisify(execFile)(dk, ['init', dir, 't'], { windowsHide: true, encoding: 'utf8' });
  const git = async (args: readonly string[]): Promise<void> => {
    await io.git(dir, args);
  };
  // A fresh box may carry no git identity; dk's own scaffold commits used the
  // ambient one, ours sets a local one only when none resolves.
  for (const [key, value] of [['user.email', 'drey@localhost'], ['user.name', 'Drey']] as const) {
    await git(['config', key]).catch(() => git(['config', key, value]));
  }
  await git(['checkout', '-q', 'main']);
  const tomlPath = path.join(dir, 'dricket.toml');
  await fsp.writeFile(tomlPath, lifecycleStoreToml(await fsp.readFile(tomlPath, 'utf8')), 'utf8');
  await git(['commit', '-q', '-am', 'the lifecycle stages']);
  await git(['checkout', '-q', 'tickets']);
  io.log?.(`fresh store created at ${dir}`);
}
