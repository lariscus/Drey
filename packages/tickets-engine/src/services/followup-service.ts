/**
 * The follow-up filer (owner request 2026-11-14): when a worker's run is
 * done and its last message proposed follow-up tickets (`FOLLOWUPS:`,
 * `core/followups.ts`, kept on the run's record), this hands them to the
 * Mission Control chat as pending cards. It creates nothing on the board
 * and decides nothing — the chat's confirm path is the only way a proposal
 * becomes a ticket.
 *
 * Triggered by the fleet's change notices; each run is looked at once per
 * process (the chat service is idempotent per run across restarts), and one
 * scan runs at a time so two notices never file a run twice.
 */
import type { RunInfo } from '../fleet/protocol';
import type { FollowupFiling } from './chat-service';
import type { FollowupDraft } from '../core/followups';

export interface FollowupServiceDeps {
  /** The fleet's run records (`FleetClient.runs`). */
  readonly runs: () => Promise<readonly RunInfo[]>;
  /** The chat's filing seam (`ChatService.fileFollowups`). */
  readonly file: (input: {
    readonly ticket: string;
    readonly runId: string;
    readonly drafts: readonly FollowupDraft[];
  }) => Promise<FollowupFiling>;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
  /** The clock; the specs pin it. */
  readonly now?: () => Date;
}

/** How far back before the service started a finished run still counts (a run that ended while the engine restarted). */
const GRACE_MS = 60 * 60 * 1000;

export class FollowupService {
  /** Runs already handed over (or refused for good) in this process. */
  private readonly handled = new Set<string>();
  private scanning: Promise<void> = Promise.resolve();
  /**
   * Runs that ended before this stamp are history: an owner who deleted an
   * old follow-ups session must not see its cards come back with the next
   * restart.
   */
  private readonly since: string;

  constructor(private readonly deps: FollowupServiceDeps) {
    this.since = new Date((deps.now?.() ?? new Date()).getTime() - GRACE_MS).toISOString();
  }

  /** Queues one scan; resolves when it has finished. Never rejects. */
  scan(): Promise<void> {
    this.scanning = this.scanning.then(() => this.scanOnce()).catch((error: unknown) => {
      this.deps.log(`follow-ups: ${error instanceof Error ? error.message : String(error)}`, 'warn');
    });
    return this.scanning;
  }

  private async scanOnce(): Promise<void> {
    for (const run of await this.deps.runs()) {
      // Only a finished run: a gate retry or a steer may still change what the worker proposes.
      if (run.state !== 'done' || this.handled.has(run.id) || (run.followups ?? []).length === 0) {
        continue;
      }
      if (run.endedAt === null || run.endedAt < this.since) {
        continue;
      }
      const filed = await this.deps.file({ ticket: run.ticketId, runId: run.id, drafts: run.followups ?? [] });
      if (!filed.ok) {
        // Not handled: the next notice retries (no vault yet, a transient write failure).
        this.deps.log(`follow-ups of ${run.id} (${run.ticketId}) not filed: ${filed.error}`, 'warn');
        continue;
      }
      this.handled.add(run.id);
      if (filed.filed > 0) {
        this.deps.log(`follow-ups of ${run.id} (${run.ticketId}): ${String(filed.filed)} card(s) await the owner in ${filed.file ?? 'chat'}`, 'info');
      }
    }
  }
}
