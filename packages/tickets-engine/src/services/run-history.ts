/**
 * The finished runs on disk (`<fleet root>/runs/<id>/run.json`): what the
 * board shows while the Crew runner sleeps. Split out of `FleetClient` with
 * req-177 (the size baseline's ratchet).
 */
import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { recordedWorkerPids, workerGone, type ExecFn } from '../fleet/runner/procs';
import type { RunInfo } from '../fleet/protocol';

/** The process probes' exec: no shell, no window. */
const plainExec: ExecFn = async (cmd, args) => (await promisify(execFile)(cmd, [...args], { windowsHide: true })).stdout;

export class RunHistory {
  private readonly detachedProbes = new Map<string, { at: number; gone: boolean }>();

  constructor(
    /** The fleet root — `<engine home>/fleet`. */
    private readonly root: string,
    /** Test seam over the process probes of a detached record (D-34). */
    private readonly exec: ExecFn = plainExec,
  ) {}

  /** The persisted runs, newest first. Without a runner nothing supervises them, so a record that was still live reads as `stopped` (no lane for it). */
  async read(): Promise<RunInfo[]> {
    const runsDir = path.join(this.root, 'runs');
    const ids = await fsp.readdir(runsDir).catch(() => [] as string[]);
    const found: RunInfo[] = [];
    for (const id of ids) {
      try {
        const stored = JSON.parse(await fsp.readFile(path.join(runsDir, id, 'run.json'), 'utf8')) as { info?: RunInfo };
        if (stored.info === undefined) {
          continue;
        }
        const settled = ['done', 'stopped', 'failed', 'detached'].includes(stored.info.state);
        const dead = stored.info.state === 'detached' && (await this.detachedWorkerGone(id, stored.info));
        found.push(settled && !dead ? stored.info : { ...stored.info, state: 'stopped' });
      } catch {
        // an unreadable record is skipped
      }
    }
    return found.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** A run's stream file, read in place (the watch view with no runner awake); null for an unsafe id or no file. */
  stream(runId: string): Promise<string | null> {
    return /^[\w.-]+$/.test(runId) ? fsp.readFile(path.join(this.root, 'runs', runId, 'stream.jsonl'), 'utf8').catch(() => null) : Promise.resolve(null);
  }

  /** D-34: with no runner to settle it, a detached record whose worker is gone only reads as over. Asked at most every 30 s per run: the board polls. */
  private async detachedWorkerGone(id: string, info: RunInfo): Promise<boolean> {
    const cached = this.detachedProbes.get(id);
    const now = Date.now();
    if (cached !== undefined && (cached.gone || now - cached.at < 30_000)) {
      return cached.gone;
    }
    const pids = await recordedWorkerPids(path.join(this.root, 'runs', id), info.pid);
    const gone = await workerGone(pids, Date.parse(info.lastActivity), this.exec);
    this.detachedProbes.set(id, { at: now, gone });
    return gone;
  }
}
