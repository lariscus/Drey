import { promises as fsp } from 'node:fs';
import type { SupervisorSet } from '../orchestrate/supervisor-set';
import { personaCostReport, tokenReport, type ReportRun } from '../report';
import { sessionRecordOf } from '../session/session-record';
import { attachCommandOf } from './attach-command';
import type { RouteContext, RouteGroup } from './route-context';

/** The runs, read: every record, the session records (req-173), the token report (T-0048), one record with its stream path, a stream's tail. */
export class RunReadRoutes implements RouteGroup {
  constructor(private readonly supervisors: SupervisorSet) {}

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
      ctx.respond(200, this.report());
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

  /** Token telemetry grouped by ticket, phase and model, and the personas' costs — curl-able next to /status. */
  private report(): unknown {
    const runs: ReportRun[] = this.supervisors.records().map((record) => ({
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
    }));
    return { ok: true, groups: tokenReport(runs), byPersona: personaCostReport(runs) };
  }
}
