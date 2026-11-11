import type { TicketIssue } from '../contracts/tickets';
import { compareVersions, MIN_DK_VERSION, parseDkVersion } from './dk-process';

/**
 * The dricket CLI Drey ships (req-277): `scripts/dk-version.json` pins the
 * release the installer bundles; `dk-health.spec.ts` keeps the two equal.
 */
export const BUNDLED_DK_VERSION = '0.6.2';

/** What one probe call came back with (the process port; a spawn failure is `failure`, never a throw). */
export interface ProbeResult {
  readonly code: number | null;
  readonly stdout: string;
  /** `ENOENT` when the executable does not exist, another code or message for any other spawn failure, else null. */
  readonly failure: string | null;
}

export type ProbeExec = (bin: string, args: readonly string[]) => Promise<ProbeResult>;

/** What the board offers of the probe: the issues of `bin` (empty = dk and git are fine). Never throws. */
export interface DkHealth {
  issues(bin: string): Promise<readonly TicketIssue[]>;
}

const OK_TTL_MS = 5 * 60_000;
const FAILED_TTL_MS = 15_000;

function versionLine(stdout: string): string {
  return /version:\s*(\S+)/.exec(stdout)?.[1] ?? stdout.trim().split(/\r?\n/)[0] ?? '';
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0]?.slice(0, 120) ?? '';
}

/**
 * The issue `dk version` makes, or null: not found and not runnable are
 * errors, a release older than the engine's minimum is an error, one older
 * than the bundled release only a warning (it still works). A `dev` build
 * passes, like the gate in `dk-process.ts`.
 */
export function dkVersionIssue(bin: string, result: ProbeResult): TicketIssue | null {
  if (result.failure === 'ENOENT') {
    return { level: 'error', message: `dk was not found (${bin}). Reinstall Drey, which ships it, or set tickets.dk.path.` };
  }
  if (result.failure !== null || result.code !== 0) {
    const why = result.failure ?? `exit code ${result.code ?? '?'}`;
    return { level: 'error', message: `dk at ${bin} could not run: ${why}.` };
  }
  const line = versionLine(result.stdout);
  const parsed = parseDkVersion(line);
  if (parsed === null) {
    return /\bdev\b/.test(line) ? null : { level: 'error', message: `dk at ${bin} did not report a version: "${firstLine(result.stdout)}".` };
  }
  const shown = parsed.join('.');
  if (compareVersions(parsed, parseDkVersion(MIN_DK_VERSION)!) < 0) {
    return { level: 'error', message: `dk ${shown} at ${bin} is too old: Drey needs dk ${MIN_DK_VERSION} or newer. Update dk or clear tickets.dk.path to use the bundled one.` };
  }
  if (compareVersions(parsed, parseDkVersion(BUNDLED_DK_VERSION)!) < 0) {
    return { level: 'warning', message: `dk ${shown} at ${bin} is older than the dk ${BUNDLED_DK_VERSION} that Drey ships. Update dk or clear tickets.dk.path to use the bundled one.` };
  }
  return null;
}

/** The issue `git --version` makes, or null: dk calls the installed git, so a missing git stops every ticket move. */
export function gitIssue(result: ProbeResult): TicketIssue | null {
  if (result.failure === null && result.code === 0) {
    return null;
  }
  return { level: 'error', message: 'git was not found. dk needs the installed git: install git and restart Drey.' };
}

/**
 * Looks at `dk version` and `git --version` once per executable and keeps
 * the answer a few minutes (a failed one a few seconds, so a fix shows
 * quickly): every board snapshot carries the issues, none of them costs two
 * processes.
 */
export class DkHealthProbe implements DkHealth {
  private readonly cache = new Map<string, { readonly at: number; readonly issues: readonly TicketIssue[] }>();
  private readonly pending = new Map<string, Promise<readonly TicketIssue[]>>();

  constructor(
    private readonly exec: ProbeExec,
    private readonly now: () => number = Date.now,
  ) {}

  async issues(bin: string): Promise<readonly TicketIssue[]> {
    const cached = this.cache.get(bin);
    if (cached !== undefined && this.now() - cached.at < (cached.issues.length === 0 ? OK_TTL_MS : FAILED_TTL_MS)) {
      return cached.issues;
    }
    const running = this.pending.get(bin) ?? this.probe(bin);
    this.pending.set(bin, running);
    return running;
  }

  private async probe(bin: string): Promise<readonly TicketIssue[]> {
    try {
      const [dk, git] = await Promise.all([this.exec(bin, ['version']), this.exec('git', ['--version'])]);
      const issues = [dkVersionIssue(bin, dk), gitIssue(git)].filter((issue): issue is TicketIssue => issue !== null);
      this.cache.set(bin, { at: this.now(), issues });
      return issues;
    } catch (error) {
      return [{ level: 'error', message: `dk could not be checked: ${error instanceof Error ? error.message : String(error)}` }];
    } finally {
      this.pending.delete(bin);
    }
  }
}
