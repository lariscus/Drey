import { parseAutopilotSet } from '../autopilot';
import { dkTargetFor } from '../dk-target';
import type { Orchestrator } from '../orchestrator';
import type { SupervisorSet } from '../orchestrate/supervisor-set';
import { normalizeChainStore, normalizeFleetCaps, normalizeFleetHandover, normalizeFleetPools, type ChainConfig, type ChainMaster, type ColumnMode } from '../protocol';
import type { RunnerExit } from '../runner-exit';
import type { RouteContext, RouteGroup } from './route-context';

/** The chain's controls: its config, the master and the Autopilot, a column, the Notaus, a persona pause, the burn rate's lift, leftover claims. */
export class ChainRoutes implements RouteGroup {
  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly supervisors: SupervisorSet,
    private readonly exit: RunnerExit,
    /** The chain config arrived: the vault the fleet ledger writes into. */
    private readonly onVault: (vaultPath: string) => void,
  ) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    const route = `${ctx.method} ${ctx.pathname}`;
    switch (route) {
      case 'GET /chain':
        ctx.respond(200, this.orchestrator.status());
        return true;
      case 'POST /chain/config':
        return this.configure(ctx);
      case 'POST /claims/release-leftovers':
        return this.releaseLeftovers(ctx);
      case 'POST /chain/master':
        return this.master(ctx);
      case 'POST /chain/autopilot':
        return this.autopilot(ctx);
      case 'POST /chain/column':
        return this.column(ctx);
      case 'POST /chain/abort':
        ctx.respond(200, await this.orchestrator.abortAll());
        this.exit.leaveIfDeactivated(); // the runs it stopped are still settling; the idle span takes over once they are gone
        return true;
      case 'POST /chain/persona-pause':
        return this.personaPause(ctx);
      case 'POST /chain/hold/lift':
        ctx.respond(200, await this.orchestrator.liftHold()); // req-181: "Allow today once"
        return true;
      default:
        return false;
    }
  }

  /** Absent or invalid keys degrade to the defaults per key (T-0048): an older plugin keeps a newer runner working. */
  private async configure(ctx: RouteContext): Promise<boolean> {
    const body = (await ctx.body()) as Partial<ChainConfig>;
    if (typeof body.ticketsVaultPath !== 'string' || body.ticketsVaultPath.trim() === '') {
      ctx.respond(422, { ok: false, error: 'the chain config needs a ticketsVaultPath' });
      return true;
    }
    const store = normalizeChainStore(body.store);
    const handover = normalizeFleetHandover(body.handover);
    const status = await this.orchestrator.configure({
      ticketsVaultPath: body.ticketsVaultPath,
      ...(store === null ? {} : { store }),
      git: typeof body.git === 'string' && body.git.trim() !== '' ? body.git : 'git',
      defaultWorker: typeof body.defaultWorker === 'string' && body.defaultWorker.trim() !== '' ? body.defaultWorker : 'opencode',
      permissionMode: body.permissionMode === 'bypass' ? 'bypass' : 'accept-edits',
      caps: normalizeFleetCaps(body.caps),
      pools: normalizeFleetPools(body.pools),
      handover,
    });
    this.onVault(body.ticketsVaultPath);
    this.supervisors.setHandoverConfig(handover); // the start-time resolution reads it (T-0049)
    ctx.respond(200, status);
    return true;
  }

  /** E14-5b (4): the owner's "release leftover claims" — agent claims of this host with no live run. */
  private async releaseLeftovers(ctx: RouteContext): Promise<boolean> {
    const body = (await ctx.body()) as { dk?: unknown };
    const store = normalizeChainStore(body.dk);
    if (store === null) {
      ctx.respond(422, { ok: false, error: 'release-leftovers needs the dricket store (dk)' });
      return true;
    }
    try {
      ctx.respond(200, { ok: true, ...(await this.supervisors.releaseLeftoverClaims(dkTargetFor(store, []))) });
    } catch (error) {
      ctx.respond(200, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  private async master(ctx: RouteContext): Promise<boolean> {
    const body = (await ctx.body()) as { mode?: unknown };
    if (body.mode !== 'run' && body.mode !== 'halted') {
      ctx.respond(422, { ok: false, error: 'the master mode is "run" or "halted"' });
      return true;
    }
    ctx.respond(200, await this.orchestrator.setMaster(body.mode as ChainMaster));
    if (body.mode === 'halted') {
      this.exit.leaveIfDeactivated();
    }
    return true;
  }

  private async autopilot(ctx: RouteContext): Promise<boolean> {
    const parsed = parseAutopilotSet(await ctx.body(), new Date());
    if (!parsed.ok) {
      ctx.respond(422, parsed);
      return true;
    }
    ctx.respond(200, await this.orchestrator.setAutopilot(parsed.value));
    if (parsed.value.state === 'off') {
      this.exit.leaveIfDeactivated();
    }
    return true;
  }

  private async column(ctx: RouteContext): Promise<boolean> {
    const body = (await ctx.body()) as { phase?: unknown; mode?: unknown; stop?: unknown };
    if (typeof body.phase !== 'string' || body.phase.trim() === '') {
      ctx.respond(422, { ok: false, error: 'the column control needs a phase id' });
    } else if (body.stop === true) {
      ctx.respond(200, await this.orchestrator.stopColumn(body.phase));
    } else if (body.mode !== 'playing' && body.mode !== 'held') {
      ctx.respond(422, { ok: false, error: 'the column mode is "playing" or "held"' });
    } else {
      ctx.respond(200, await this.orchestrator.setColumn(body.phase, body.mode as ColumnMode));
    }
    return true;
  }

  private async personaPause(ctx: RouteContext): Promise<boolean> {
    const body = (await ctx.body()) as { persona?: unknown; paused?: unknown };
    if (typeof body.persona !== 'string' || body.persona.trim() === '') {
      ctx.respond(422, { ok: false, error: 'the persona pause needs a persona id' });
    } else if (typeof body.paused !== 'boolean') {
      ctx.respond(422, { ok: false, error: 'the persona pause needs paused: true or false' });
    } else {
      ctx.respond(200, await this.orchestrator.setPersonaPaused(body.persona, body.paused));
    }
    return true;
  }
}
