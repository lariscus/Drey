import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * A scratch dk store ON THE LIFECYCLE STAGES (`inbox prioritized active running done`, claim = running):
 * the only stages the board (req-307) draws. Call it right after `dk init <storeDir>`, with the spec's
 * temp HOME / git identity already in the environment; the store is left checked out on `tickets`.
 *
 * - `urgentPriorities`: swap dk's own vocabulary (`critical high normal low`) for the board's
 *   (`urgent high normal low`); a spec that reads dk's vocabulary keeps it by leaving this off.
 */
export function writeLifecycleStages(storeDir: string, options: { readonly urgentPriorities: boolean } = { urgentPriorities: true }): void {
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: storeDir, windowsHide: true, stdio: 'pipe' });
  };
  git(['config', 'core.autocrlf', 'false']);
  git(['checkout', '-q', 'main']);
  const tomlPath = path.join(storeDir, 'dricket.toml');
  let toml = readFileSync(tomlPath, 'utf8').replace(/\[transitions\.agent\][\s\S]*?(?=\n\[|$)/, '');
  if (options.urgentPriorities) {
    toml = toml.replace('values = ["critical", "high", "normal", "low"]', 'values = ["urgent", "high", "normal", "low"]');
  }
  writeFileSync(tomlPath, `${toml}\n[stages]\nvalues = ["inbox", "prioritized", "active", "running", "done"]\ninitial = "inbox"\nterminal = ["done"]\nclaim = ["running"]\ncancelled = "cancelled"\n`);
  git(['commit', '-q', '-am', 'the lifecycle stages']);
  git(['checkout', '-q', 'tickets']);
}
