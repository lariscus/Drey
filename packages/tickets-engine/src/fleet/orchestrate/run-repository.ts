import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { RunInfo } from '../protocol';
import type { StoredRun, SupervisorRecord } from '../run/run-record';
import { storedOf, type LiveRun } from './live-run';

/** What `attach.json` records of a worker a later runner may take back (req-51). */
export interface AttachRecord {
  readonly address: string;
  readonly password: string;
  readonly pid: number | null;
  readonly pidStartedMs: number | null;
}

/** One `runs/<id>/` folder a restart found. */
export interface FoundRun {
  readonly dir: string;
  readonly stored: StoredRun;
}

/**
 * The supervisor's runs and their files under the fleet root:
 * `runs/<id>/run.json` (the record a restart reads) and `attach.json` (the take-back
 * credential, never in the record the board reads).
 */
export class RunRepository {
  private readonly runs = new Map<string, LiveRun>();

  constructor(private readonly root: string) {}

  add(run: LiveRun): void {
    this.runs.set(run.info.id, run);
  }

  find(runId: string): LiveRun | undefined {
    return this.runs.get(runId);
  }

  all(): readonly LiveRun[] {
    return [...this.runs.values()];
  }

  /** Every record, newest first. */
  list(): readonly RunInfo[] {
    return this.all()
      .map((r) => r.info)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** Every run with its request, newest first (the orchestrator's view). */
  records(): readonly SupervisorRecord[] {
    return this.all()
      .map((r) => ({ info: r.info, request: r.request }))
      .sort((a, b) => b.info.startedAt.localeCompare(a.info.startedAt));
  }

  dirFor(runId: string): string {
    return path.join(this.root, 'runs', runId);
  }

  /** The stream file's absolute path — Drey's watch view tails it. */
  streamPath(runId: string): string | null {
    const run = this.runs.get(runId);
    return run === undefined ? null : path.join(run.dir, 'stream.jsonl');
  }

  /** Every run folder with a readable record; a torn `run.json` is skipped. */
  async found(): Promise<readonly FoundRun[]> {
    const runsDir = path.join(this.root, 'runs');
    const entries = await fsp.readdir(runsDir).catch(() => [] as string[]);
    const out: FoundRun[] = [];
    for (const id of entries) {
      const raw = await fsp.readFile(path.join(runsDir, id, 'run.json'), 'utf8').catch(() => null);
      try {
        if (raw !== null) {
          out.push({ dir: path.join(runsDir, id), stored: JSON.parse(raw) as StoredRun });
        }
      } catch {
        // a torn run.json is noise; skip the run
      }
    }
    return out;
  }

  /**
   * Writes the record. The snapshot is taken at call time and the write
   * queues per run, so an older snapshot never lands after a newer one.
   */
  async persist(run: LiveRun): Promise<void> {
    const stored = storedOf(run);
    const write = run.writeQueue.then(() => fsp.writeFile(path.join(run.dir, 'run.json'), JSON.stringify(stored, null, 2), 'utf8'));
    run.writeQueue = write.catch(() => undefined); // the queue survives a failed write
    await write;
  }

  /** The run's folder. */
  async ensureDir(dir: string): Promise<void> {
    await fsp.mkdir(dir, { recursive: true });
  }

  async writeAttach(run: LiveRun, record: AttachRecord): Promise<void> {
    await fsp.writeFile(path.join(run.dir, 'attach.json'), JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
  }

  /** The attach record of a run folder, or null when absent or unreadable. */
  async readAttach(dir: string): Promise<Partial<Record<keyof AttachRecord, unknown>> | null> {
    const raw = await fsp.readFile(path.join(dir, 'attach.json'), 'utf8').catch(() => null);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as Partial<Record<keyof AttachRecord, unknown>>;
    } catch {
      return null;
    }
  }

  async hasAttach(run: LiveRun): Promise<boolean> {
    return fsp.stat(path.join(run.dir, 'attach.json')).then(
      () => true,
      () => false,
    );
  }

  /** The attach credential has no use once the run is over. */
  async removeAttach(run: LiveRun): Promise<void> {
    await fsp.rm(path.join(run.dir, 'attach.json'), { force: true }).catch(() => undefined);
  }
}
