import { promises as fsp } from 'node:fs';
import type { SupervisorSet } from '../runner/supervisor-set';
import { journalByModel } from '../../core/persona/journal-report';
import { holdSpans } from '../../core/pipeline/hold-spans';
import { JournalReader } from '../runner/journal-reader';
import { LedgerReader } from './ledger-reader';
import { personaReport, positionReport } from '../telemetry/persona-report';
import type { RunInfo } from '../protocol';
import { tokenReport, type ReportRun } from '../telemetry/report';
import { sessionRecordOf } from '../session/session-record';
import { attachCommandOf } from './attach-command';
import type { RouteContext, RouteGroup } from './route-context';

/** A run's working time: the closed busy spans (req-67) plus an open one, else the wall clock of an ended run; null when unknown. */
export function busyMsOf(info: RunInfo, nowMs: number): number | null {
  if (info.execMs !== undefined) {
    const since = info.execSince === null || info.execSince === undefined ? Number.NaN : Date.parse(info.execSince);
    return info.execMs + (Number.isNaN(since) ? 0 : Math.max(0, nowMs - since));
  }
  const started = Date.parse(info.startedAt);
  const ended = info.endedAt === null ? Number.NaN : Date.parse(info.endedAt);
  return Number.isNaN(started) || Number.isNaN(ended) ? null : Math.max(0, ended - started);
}

/** What the report reads besides the records: the persona journals, the ledgers, the chain's vault (req-274). */
export interface RunReportSources {
  readonly journals?: JournalReader;
  readonly ledgers?: LedgerReader;
  /** The tickets vault the chain serves now; its ledger counts even before a run of it is recorded. */
  readonly chainVault?: () => string | null;
  readonly now?: () => Date;
}

/** The runs, read: every record, the session records (req-173), the token report (T-0048), one record with its stream path, a stream's tail. */
export class RunReadRoutes implements RouteGroup {
  constructor(
    private readonly supervisors: SupervisorSet,
    private readonly sources: RunReportSources = {},
  ) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    if (ctx.method !== 'GET') {
      return false;
    }
    if (ctx.pathname === '/status') {
      ctx.respond(200, { runs: this.supervisors.list() });
      return true;
    }
    if (ctx.pathname === '/sessions') {
      // req-173 (R12): every run, 1:1 and free session as its session record
      ctx.respond(200, { sessions: this.supervisors.records().map((r) => sessionRecordOf(r.info, r.request.permissionMode)) });
      return true;
    }
    if (ctx.pathname === '/report') {
      ctx.respond(200, await this.report());
      return true;
    }
    const [kind, runId] = ctx.parts;
    if (ctx.parts.length !== 2 || runId === undefined) {
      return false;
    }
    if (kind === 'instruction' || kind === 'attach') {
      this.inspect(ctx, kind, runId);
      return true;
    }
    if (kind !== 'status' && kind !== 'stream') {
      return false;
    }
    await this.one(ctx, kind, runId);
    return true;
  }

  /**
   * The Sessions tab (req-166): `GET /instruction/<run>` — the composed
   * instruction the run started with; `GET /attach/<run>` — the command that
   * attaches a terminal to its harness session.
   */
  private inspect(ctx: RouteContext, kind: 'instruction' | 'attach', runId: string): void {
    const record = this.supervisors.ofRun(runId)?.records().find((r) => r.info.id === runId);
    if (record === undefined) {
      ctx.respond(404, { ok: false, error: `unknown run "${runId}"` });
    } else if (kind === 'instruction') {
      ctx.respond(200, { ok: true, instruction: record.request.instruction });
    } else {
      const { provider, sessionRef, worktreePath } = record.info;
      ctx.respond(200, { ok: true, command: attachCommandOf(provider, sessionRef, worktreePath) });
    }
  }

  /** One run's record with its stream path, or its stream's tail. */
  private async one(ctx: RouteContext, kind: 'status' | 'stream', runId: string): Promise<void> {
    const supervisor = this.supervisors.ofRun(runId);
    const streamPath = supervisor === null ? null : supervisor.streamPath(runId);
    if (supervisor === null || streamPath === null) {
      ctx.respond(404, { ok: false, error: `unknown run "${runId}"` });
    } else if (kind === 'status') {
      ctx.respond(200, { run: supervisor.get(runId), streamPath });
    } else {
      const tail = await fsp.readFile(streamPath, 'utf8').catch(() => '');
      ctx.raw(200, 'application/x-ndjson', tail.slice(-200_000));
    }
  }

  /**
   * Token telemetry grouped by ticket, phase and model; the persona rows
   * (cost, red gates, time held) and the chain-position rows (busy, held,
   * waiting) of req-274; and (req-169) the persona journals grouped by
   * model — curl-able next to /status.
   */
  private async report(): Promise<unknown> {
    const now = this.sources.now?.() ?? new Date();
    const records = this.supervisors.records();
    const runs: ReportRun[] = records.map((record) => ({
      ticketId: record.info.ticketId,
      persona: record.info.persona ?? null,
      costUsd: record.info.costUsd ?? null,
      phase: record.info.phase ?? record.request.phase,
      model: record.info.model ?? record.request.model,
      provider: record.info.provider,
      usage: record.info.usage ?? null,
      tokensIn: record.info.tokensIn,
      tokensOut: record.info.tokensOut,
      tokensBeforeFirstWrite: record.info.tokensBeforeFirstWrite ?? null,
      position: record.info.chainPosition?.at ?? null,
      busyMs: busyMsOf(record.info, now.getTime()),
      gate: record.info.gateResult ?? null,
    }));
    const chainVault = this.sources.chainVault?.() ?? null;
    const vaults = [...records.map((record) => record.request.ticketsVaultPath), ...(chainVault !== null ? [chainVault] : [])];
    const byModel = journalByModel(await (this.sources.journals ?? new JournalReader()).entriesOf(vaults));
    const spans = holdSpans(await (this.sources.ledgers ?? new LedgerReader()).eventsOf(vaults), now.toISOString());
    return { ok: true, groups: tokenReport(runs), byPersona: personaReport(runs, spans), byPosition: positionReport(runs, spans), byModel };
  }
}
