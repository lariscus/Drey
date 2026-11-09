import type { ProcessTable } from '../ports/process-table';
import type { RunInfo } from '../protocol';
import type { ProviderAdapter, UsageTotals, WorkerHandle } from '../harness/contract';
import type { BackgroundWork } from './background-work';
import type { EventFold } from './event-fold';
import type { HandoverSettings } from './handover-settings';
import { messageOf, type LiveRun } from './live-run';
import type { RunRepository } from './run-repository';

/** Where the worker works: a review's read-only checkout (req-183), else the run's worktree. */
function workFolderOf(info: RunInfo): string {
  return info.review?.checkout ?? info.worktreePath;
}

/** What one worker is started with; the caller composes the instruction. */
export interface SpawnPlan {
  readonly instruction: string;
  readonly resumeRef: string | null;
  readonly compactFirst?: boolean;
  /** Deliver no prompt at spawn: the worker stands until the owner sends (req-75). */
  readonly holdAtSpawn?: boolean;
  /** The resumed session's spend before this run (req-53). */
  readonly usageBase?: UsageTotals;
  /** A resume the adapter cannot establish (T-0049): the starter replaces the worker. */
  readonly onResumeFailed?: (reason: string) => void;
  /** Record the server's attach info — a worker a later runner may take back (req-51). */
  readonly recordAttach?: boolean;
  /** Keep the session's spend base on the record when the adapter reads it. */
  readonly trackUsageBase?: boolean;
  /** req-180: the light seat's environment (`DREY_DEV_PORT`, the parallelism variables), under the slot's. */
  readonly env?: Readonly<Record<string, string>>;
}

/** What a booted server reports for a later take-back. */
type ServerInfo = { readonly address: string; readonly password: string; readonly pid: number | null };

/** A worker that outlived its runner, as `attach.json` recorded it. */
export interface RecordedServer {
  readonly address: string;
  readonly password: string;
  readonly pid: number;
  readonly pidStartedMs: number | undefined;
}

export interface ProcessSupervisorDeps {
  readonly adapter: ProviderAdapter;
  readonly repo: RunRepository;
  readonly events: EventFold;
  readonly background: BackgroundWork;
  readonly settings: HandoverSettings;
  readonly table: ProcessTable;
  readonly log: (message: string) => void;
  /** req-177: the worker environment of the run's slot (its login folder). */
  readonly slotEnv?: (slotId: string) => Readonly<Record<string, string>> | undefined;
  /** The worker the run owns exited: the completion decides. */
  readonly onExit: (run: LiveRun, code: number | null) => Promise<void>;
}

/**
 * The run's worker processes (ADR-0075): the one spawn path, the take-back
 * of a worker that outlived its runner, and the guarded kills. The handle
 * the run currently owns decides its exit; a worker a replacement took
 * over decides nothing.
 */
export class ProcessSupervisor {
  constructor(private readonly deps: ProcessSupervisorDeps) {}

  get providerId(): ProviderAdapter['id'] {
    return this.deps.adapter.id;
  }

  get canAttach(): boolean {
    return this.deps.adapter.attach !== undefined;
  }

  spawn(run: LiveRun, plan: SpawnPlan): WorkerHandle {
    const request = run.request;
    const slotEnv = run.info.slot === undefined ? undefined : this.deps.slotEnv?.(run.info.slot.id);
    const env = plan.env === undefined && slotEnv === undefined ? undefined : { ...plan.env, ...slotEnv };
    const handle = this.deps.adapter.spawn({
      cwd: workFolderOf(run.info),
      instruction: plan.instruction,
      model: request.model,
      permissionMode: request.permissionMode,
      contextCap: this.deps.settings.contextCap(request.model),
      resumeRef: plan.resumeRef,
      ...(plan.compactFirst === true ? { compactFirst: true } : {}),
      ...(plan.holdAtSpawn === true ? { holdAtSpawn: true } : {}),
      ...(plan.usageBase !== undefined ? { usageBase: plan.usageBase } : {}),
      ticketId: request.ticketId,
      ...(env !== undefined ? { env } : {}),
      onEvent: (event) => this.deps.events.onEvent(run, event),
      onSessionRef: (ref) => this.keepSession(run, ref),
      ...(plan.recordAttach === true ? { onAttachInfo: (info: ServerInfo) => this.deps.background.track(this.recordAttach(run, info)) } : {}),
      ...(plan.trackUsageBase === true ? { onUsageBase: (base: UsageTotals) => this.keepUsageBase(run, base) } : {}),
      ...(plan.onResumeFailed !== undefined ? { onResumeFailed: plan.onResumeFailed } : {}),
    });
    this.own(run, handle);
    return handle;
  }

  /** Binds a worker that outlived its runner to the run (no adapter can since req-182); throws when the adapter cannot attach. */
  attach(run: LiveRun, server: RecordedServer): WorkerHandle {
    const attach = this.deps.adapter.attach;
    if (attach === undefined) {
      throw new Error(`the ${this.deps.adapter.id} worker cannot be re-attached`);
    }
    const info = run.info;
    const handle = attach(
      {
        cwd: workFolderOf(info),
        instruction: run.request.instruction,
        model: run.request.model,
        permissionMode: run.request.permissionMode,
        resumeRef: info.sessionRef,
        ticketId: run.request.ticketId,
        usageBase: run.usageBase ?? { tokensIn: 0, tokensOut: 0, cacheReadTokens: 0, costUsd: null },
        onEvent: (event) => this.deps.events.onEvent(run, event),
        onSessionRef: () => undefined,
      },
      {
        address: server.address,
        password: server.password,
        sessionRef: info.sessionRef ?? '',
        runStartedMs: run.startedAtMs,
        seenBeforeMs: Date.parse(info.lastActivity) || 0,
        pid: server.pid,
        kill: async () => {
          await this.deps.table.killGuarded(server.pid, server.pidStartedMs);
        },
      },
    );
    this.own(run, handle);
    return handle;
  }

  /**
   * Writes what a later runner needs to take this worker back. The pid is
   * the server's own — the process listening on the address — not the
   * shell around it: the shell dies with its runner while the server lives
   * on, and a recorded shell pid read as a dead worker.
   */
  async recordAttach(run: LiveRun, info: ServerInfo): Promise<void> {
    try {
      const serverPid = (await this.deps.table.listener(Number(new URL(info.address).port))) ?? info.pid;
      const pidStartedMs = serverPid === null ? null : await this.deps.table.startMs(serverPid);
      await this.deps.repo.writeAttach(run, { address: info.address, password: info.password, pid: serverPid, pidStartedMs });
    } catch (error) {
      this.deps.log(`run ${run.info.id}: could not record the attach info — ${messageOf(error)}`);
    }
  }

  /** Ends the server `attach.json` records (guarded by its creation time) before a fresh worker takes the session over. */
  async killRecordedServer(dir: string): Promise<void> {
    const attach = await this.deps.repo.readAttach(dir);
    if (attach !== null && typeof attach.pid === 'number' && typeof attach.pidStartedMs === 'number') {
      await this.deps.table.killGuarded(attach.pid, attach.pidStartedMs).catch(() => undefined);
    }
  }

  /** The guarded kill of a recorded process (pid-reuse guard: its creation time). */
  async kill(pid: number, startedMs: number | null | undefined): Promise<void> {
    await this.deps.table.killGuarded(pid, startedMs ?? undefined);
  }

  private own(run: LiveRun, handle: WorkerHandle): void {
    run.handle = handle;
    void handle.exited.then((code) => {
      if (run.handle === handle) {
        this.deps.background.track(this.deps.onExit(run, code));
      }
    });
  }

  private keepSession(run: LiveRun, ref: string): void {
    run.info = { ...run.info, sessionRef: ref };
    this.deps.background.track(this.deps.repo.persist(run));
  }

  private keepUsageBase(run: LiveRun, base: UsageTotals): void {
    run.usageBase = base;
    this.deps.background.track(this.deps.repo.persist(run));
  }
}
