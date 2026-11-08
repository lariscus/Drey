import { promises as fsp } from 'node:fs';
import type { SupervisorSet } from '../orchestrate/supervisor-set';
import { personaCostReport, tokenReport, type ReportRun } from '../report';
import type { RouteContext, RouteGroup } from './route-context';

/** The runs, read: every record, the token report (T-0048), one record with its stream path, a stream's tail. */
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
    if (ctx.pathname === '/report') {
      ctx.respond(200, this.report());
      return true;
    }
    const [kind, runId] = ctx.parts;
    if (ctx.parts.length !== 2 || runId === undefined || (kind !== 'status' && kind !== 'stream')) {
      return false;
    }
    await this.one(ctx, kind, runId);
    return true;
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
