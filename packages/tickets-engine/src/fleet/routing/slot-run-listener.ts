import type { NormalizedEvent } from '../harness/contract';
import type { EventSink, RunnerEvent } from '../ports/event-sink';
import type { RunInfo } from '../protocol';
import { isTerminal } from '../runner/run-state';
import type { ClaudeCodeQuotaSource } from './claude-code-quota-source';
import type { CountingQuotaSource } from './counting-quota-source';
import { isLoginFailure } from './login-failure';
import type { SlotRegistry } from './slot-registry';
import type { Seat, SlotReservations } from './slot-reservations';

export interface SlotRunListenerDeps {
  readonly registry: Pick<SlotRegistry, 'flagLogin' | 'refresh' | 'announce'>;
  readonly reservations: SlotReservations;
  readonly claude: Pick<ClaudeCodeQuotaSource, 'observe'>;
  readonly counting: Pick<CountingQuotaSource, 'record'>;
}

/** What a finished run used, as the counting fallback measures it: input without cache reads, plus output. */
function tokensOf(info: RunInfo): number {
  return Math.max(0, info.tokensIn - (info.cacheReadTokens ?? 0)) + info.tokensOut;
}

/** The weight a run's record says it holds (req-170): what the pool granted it; none on a run before the pool. */
function seatOf(info: RunInfo): Seat | undefined {
  return info.grant === undefined ? undefined : { model: info.grant.model, class: info.grant.class, cost: info.grant.cost };
}

/**
 * The slots' ear on the runner's events (req-177): a run's record keeps
 * its slot reserved while it lives, frees it when it ends, feeds its
 * telemetry to the counting and asks for a fresh quota read; a stream line
 * with Claude Code's rate-limit windows updates its slot; a refused login
 * (in a line or the run's last error) marks the slot `needs login`. It is
 * an `EventSink` beside the SSE hub, so the orchestration knows nothing of
 * it.
 */
export class SlotRunListener implements EventSink {
  private readonly ended = new Set<string>();

  constructor(private readonly deps: SlotRunListenerDeps) {}

  publish(event: RunnerEvent): void {
    if (event.kind === 'run') {
      this.onRun(event.info);
    } else if (event.kind === 'line') {
      this.onLine(event.runId, event.event);
    }
  }

  /** The records a restarted runner found: live runs hold their slot again, ended ones count. No login alarm from history. */
  seed(records: readonly RunInfo[]): void {
    for (const info of records) {
      const slotId = info.slot?.id;
      if (slotId === undefined) {
        continue;
      }
      if (isTerminal(info.state)) {
        this.ended.add(info.id);
        this.count(slotId, info);
      } else {
        this.deps.reservations.reserve(slotId, info.id, seatOf(info));
      }
    }
    void this.deps.registry.refresh();
  }

  private onRun(info: RunInfo): void {
    const slotId = info.slot?.id;
    if (slotId === undefined || this.ended.has(info.id)) {
      return;
    }
    if (!isTerminal(info.state)) {
      this.deps.reservations.reserve(slotId, info.id, seatOf(info));
      this.deps.registry.announce();
      return;
    }
    this.ended.add(info.id);
    this.deps.reservations.release(info.id);
    this.count(slotId, info);
    if (info.state === 'failed' && isLoginFailure(info.lastError)) {
      this.deps.registry.flagLogin(slotId, (info.lastError ?? '').slice(0, 200));
    }
    void this.deps.registry.refresh(slotId);
  }

  private onLine(runId: string, line: NormalizedEvent): void {
    const slotId = this.deps.reservations.slotOf(runId);
    if (slotId === null) {
      return;
    }
    if (line.rateLimit !== undefined && this.deps.claude.observe(slotId, line.rateLimit, new Date(line.ts))) {
      void this.deps.registry.refresh(slotId);
    }
    if (line.kind === 'error' && isLoginFailure(line.text)) {
      this.deps.registry.flagLogin(slotId, (line.text ?? '').slice(0, 200));
    }
  }

  private count(slotId: string, info: RunInfo): void {
    const at = new Date(info.endedAt ?? info.lastActivity);
    this.deps.counting.record(slotId, { runId: info.id, at: Number.isNaN(at.getTime()) ? new Date(0) : at, tokens: tokensOf(info) });
  }
}
