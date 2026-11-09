/**
 * The Crew runner's entry and its composition root (ADR-0075, ADR-0096):
 * the only module that knows every concrete adapter — the three harness
 * adapters, the dk-backed ticket store, the HTTP server. It wires the
 * supervisors (one per provider), the one ticket writer, the chain
 * orchestrator and the loopback API, and owns nothing else.
 *
 * Surface: a loopback HTTP endpoint with a bearer token — Drey talks to it,
 * and so can a terminal (curl). Standalone (a debugging tool since Drey
 * Service), `<root>/runner.json` is its descriptor and single-instance
 * guard; as the Crew runner component of Drey Service (req-164) the
 * service lock replaces both.
 *
 * When it leaves (req-110, `runner-lifecycle.ts`): with no live run and no
 * On/Paused Autopilot it exits when the Autopilot is switched Off, when the
 * engine asks (`POST /retire-if-idle`) and after the idle span without a
 * write. A live run always keeps it.
 *
 * Usage: node runner.js --root <abs-path-to-fleet-root> [--idle-ms <n>]
 */
import * as crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { ChainRoutes } from './api/chain-routes';
import { EventHub } from './api/event-hub';
import { EventStream } from './api/event-stream';
import { GovernorRoutes } from './api/governor-routes';
import { LifecycleRoutes } from './api/lifecycle-routes';
import { ModelRoutes } from './api/model-routes';
import { RunReadRoutes } from './api/run-read-routes';
import { RunWriteRoutes } from './api/run-write-routes';
import { RunnerHttpApi } from './api/runner-http-api';
import { SlotRoutes } from './api/slot-routes';
import { fleetBuildStamp } from './build-stamp';
import { governorSeats, type Governor } from './compose-governor';
import { composeOrchestrator } from './compose-orchestrator';
import { composeRouting, type Routing } from './compose-routing';
import { composeRunSupervisor, composeShared } from './compose-supervisor';
import { dkTargetFor, retreatStages } from './dk-target';
import { FleetEventWriter } from './event-writer';
import { kimiAdapter } from './harness/kimi';
import { nodeKimiUsageReader } from './harness/kimi-usage';
import type { Orchestrator, FleetEvents } from './orchestrator';
import type { RunSupervisor } from './orchestrate/run-supervisor';
import { SupervisorSet } from './orchestrate/supervisor-set';
import { freePort, nodeSpawnFn, scrubInheritedEnv } from './procs';
import type { GovernorSettings, PoolLoad, RunnerDescriptor, SlotView, WorkerProviderId } from './protocol';
import { claudeCodeAdapter } from './harness/claude-code';
import { opencodeAdapter } from './harness/opencode';
import { peerAlive, readDescriptor, removeDescriptor, writeDescriptor } from './runner-descriptor';
import { RunnerExit } from './runner-exit';
import { governorFor, seedsOf } from './runner-governor';
import { IdleWatch } from './runner-lifecycle';
import { NodeFileSystem } from './node-file-system';
import { SYSTEM_CLOCK } from './ports/clock';
import type { QuotaHttp } from './routing/quota-source';
import { RunnerLog } from './runner-log';
import { PoolCapacity } from './orchestrate/pool-capacity';
import { fetchTotalSlots } from './orchestrate/pool-sizes';
import type { DispatchPool } from './orchestrate/dispatch-pool';
import { DkTicketStores } from './store/dk-ticket-store';

const VERSION = 1;

export interface Args {
  readonly root: string;
  readonly idleMs: number;
  /** The service home (`service.json`, req-177); absent = the root's parent when the root is `<home>/fleet`, else the root. */
  readonly home?: string;
  /**
   * The board lives in a dricket store (D-42). Still passed by the service's
   * launch; since req-176 the runner writes tickets only through a store
   * claim, so a run record from before the cut-over writes nothing either way.
   */
  readonly storeBacked?: boolean;
}

/** The process seams the in-process spec replaces; the real entry uses the defaults. */
export interface RunnerDeps {
  /** Ends the process; `process.exit` by default. */
  readonly exit?: (code: number) => void;
  /** Mirrors every log line; `console.log` by default. */
  readonly stdout?: (line: string) => void;
  /** `file`: the standalone entry's `<root>/runner.json` and its guard; `none`: Drey Service's component (req-164). */
  readonly descriptor?: 'file' | 'none';
  /** Whether the runner installs its own SIGINT/SIGTERM/exit handlers; the service handles signals itself. */
  readonly signals?: boolean;
  /** req-177: the user's home (Claude's default login, opencode's and Kimi's folders); `os.homedir()` by default. */
  readonly userHome?: string;
  /** req-177: the remote quota reads; the global `fetch` by default. */
  readonly quotaHttp?: QuotaHttp;
  /** req-180: Settings → Background service's Load group, read live; the defaults when absent (standalone). */
  readonly governorSettings?: () => GovernorSettings;
}

/** What `startRunner` hands back: the spec reads the descriptor and ends the runner through it. */
export interface RunnerHandle {
  readonly port: number;
  readonly token: string;
  readonly descriptorPath: string;
  /** The endpoint record (port, token, pid, build) — the service writes it into `service.lock`. */
  readonly descriptor: RunnerDescriptor;
  /** The graceful stop: live runs stopped (bounded), the descriptor removed, `exit(0)`. */
  stop(): Promise<void>;
}

function parseArgs(argv: readonly string[]): Args {
  const value = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const root = value('--root') ?? '';
  const idleMs = Number(value('--idle-ms') ?? 15 * 60_000);
  if (root === '') {
    console.error('fleet runner: --root is required');
    process.exit(2);
  }
  const home = value('--home');
  return { root, idleMs: Number.isFinite(idleMs) && idleMs > 0 ? idleMs : 15 * 60_000, storeBacked: argv.includes('--store-backed'), ...(home !== undefined ? { home } : {}) };
}

/** The fleet ledger (E7): the vault arrives only with the chain config, so the writer is built on the first event. */
function ledgerOf(log: (message: string) => void): { events: FleetEvents; setVault: (vaultPath: string) => void } {
  let vaultPath: string | null = null;
  let writer: FleetEventWriter | null = null;
  return {
    events: {
      ledger: (write) => {
        if (vaultPath !== null) {
          writer ??= new FleetEventWriter({ vaultPath, log });
          writer.ledger(write);
        }
      },
    },
    setVault: (next) => {
      vaultPath = next;
    },
  };
}

/** What the fleet is composed over. */
interface FleetContext {
  readonly root: string;
  readonly log: (message: string) => void;
  readonly events: FleetEvents;
  readonly hub: EventHub;
  readonly routing: Routing;
  /** The provider pools' throttle (req-63), shared by the pool and the chain. */
  readonly capacity: PoolCapacity;
  /** req-180: the resource governor every spawn asks for a seat. */
  readonly governor: Governor;
}

/** The service home: `--home`, else the parent of a `<home>/fleet` root, else the root itself (a spec's temp root). */
function serviceHome(args: Args): string {
  return args.home ?? (path.basename(args.root) === 'fleet' ? path.dirname(args.root) : args.root);
}

/** The slots (req-177): their changes go out as `slot` events, the runs' events come back in. */
function routingFor(args: Args, deps: RunnerDeps, ctx: { log: (message: string) => void; hub: EventHub; capacity: PoolCapacity }): Routing {
  const { log, hub, capacity } = ctx;
  const http = deps.quotaHttp !== undefined ? { http: deps.quotaHttp } : {};
  const publish = { publish: (slot: SlotView) => hub.publish({ kind: 'slot', slot }), publishPool: (pool: PoolLoad) => hub.publish({ kind: 'pool', pool }) };
  const routing = composeRouting({ home: serviceHome(args), userHome: deps.userHome ?? homedir(), env: process.env, fs: new NodeFileSystem(), clock: SYSTEM_CLOCK, log, throttle: capacity, ...publish, ...http });
  hub.subscribe((event) => {
    routing.listener.publish(event);
    routing.pool.book.publish(event);
    routing.pool.shares.publish(event);
  });
  return routing;
}

/** The records a restart found: the slots re-reserve the live ones, the ledgers count them all, the governor re-seats them (req-180). */
function seedRouting(routing: Routing, supervisors: SupervisorSet, governor: Governor): void {
  const found = supervisors.records().map((record) => record.info);
  routing.listener.seed(found);
  routing.pool.book.seed(found);
  governor.governor.seed(seedsOf(found));
}

/** req-180: the resource governor over the service's Load settings (the defaults standalone). */
function governorOf(args: Args, deps: RunnerDeps, ctx: { log: (message: string) => void; hub: EventHub; routing: Routing }): Promise<Governor> {
  const settings = deps.governorSettings !== undefined ? { settings: deps.governorSettings } : {};
  return governorFor({ root: args.root, home: serviceHome(args), log: ctx.log, sink: ctx.hub, slots: () => ctx.routing.registry.views(), ...settings });
}

/** The capacity pool as the chain's dispatch asks it (req-170). */
function dispatchPoolOf(routing: Routing): DispatchPool {
  const { pool } = routing;
  return { classes: pool.grant, queue: pool.queue, load: () => pool.load(), sessionsOf: (provider) => pool.sessionsOf(provider), hold: pool.burnRate };
}

/** req-179: the day's budget a tranche takes its share of — the provider ledger over every slot; null while none is set. */
function dayBudgetOf(routing: Routing): { limitUsd(): number | null } {
  return {
    limitUsd: () => {
      const perSlot = routing.pool.settings.ledgers().providerPerDay;
      return perSlot === null ? null : perSlot * routing.registry.list().length;
    },
  };
}

/** The supervisors, one per provider, and the chain over them; the settle hook closes the loop back to the chain. */
function composeFleet(ctx: FleetContext): { supervisors: SupervisorSet; orchestrator: Orchestrator } {
  const { root, log, events, hub, routing, capacity } = ctx;
  const seats = governorSeats(ctx.governor.governor);
  const stores = new DkTicketStores();
  const shared = composeShared(stores.storeFor, log, undefined, { sink: hub });
  const adapters = [opencodeAdapter(nodeSpawnFn()), claudeCodeAdapter(nodeSpawnFn()), kimiAdapter(nodeSpawnFn(), nodeKimiUsageReader())];
  const byProvider = new Map<WorkerProviderId, RunSupervisor>(
    adapters.map((adapter) => [
      adapter.id,
      composeRunSupervisor({
        root,
        adapter,
        git: 'git',
        log,
        storeFor: stores.storeFor,
        shared,
        onRunSettled: (info) => {
          ctx.governor.governor.runSettled(info.id);
          void orchestrator.onRunSettled(info);
        },
        secondOpinion: (request) => orchestrator.secondOpinion(request),
        slots: routing.gate,
        seats,
      }),
    ]),
  );
  const supervisors = new SupervisorSet(byProvider);
  const orchestrator: Orchestrator = composeOrchestrator({
    root,
    log,
    events,
    bookkeeper: shared.bookkeeper,
    slots: routing.registry,
    pool: dispatchPoolOf(routing),
    capacity,
    migratePools: (config) => routing.pool.migrate(config.pools),
    dayBudget: dayBudgetOf(routing),
    sink: hub,
    seats,
    supervisorOf: (provider) => supervisors.forProvider(provider),
    // E14-5b: a killed runner's claims on a dricket store are released before the chain's first dispatch there.
    releaseLeftovers: async (store, pipeline) => {
      const report = await supervisors.releaseLeftoverClaims(dkTargetFor(store, pipeline, pipeline[0]?.id ?? ''), retreatStages(pipeline));
      if (report.released.length > 0 || report.skipped.length > 0) {
        const skipped = report.skipped.length > 0 ? `; skipped ${report.skipped.map((s) => `${s.id} (${s.reason})`).join(', ')}` : '';
        log(`leftover claims: released ${report.released.join(', ') || 'none'}${skipped}`);
      }
    },
    // The shipped default prompt beside the built plugin, for the "vault copy is older" note.
    shippedPrompt: (ref) =>
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(ref) ? fsp.readFile(path.join(__dirname, '..', '..', 'prompts', `${ref}.md`), 'utf8').catch(() => null) : Promise.resolve(null),
  });
  return { supervisors, orchestrator };
}

/** A runner already serves from this descriptor (a stale one — a crashed runner — is taken over). */
async function healthyPeer(descriptorPath: string): Promise<boolean> {
  const existing = await readDescriptor(descriptorPath);
  return existing !== null && (await peerAlive(existing));
}

/** The standalone process's own signals: live runs stopped (bounded), then out; the descriptor goes with the process. */
function installSignals(exit: RunnerExit, descriptorPath: string | null): void {
  const onSignal = (): void => void exit.stopLiveRuns().finally(() => exit.shutdown(0));
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('exit', () => descriptorPath !== null && removeDescriptor(descriptorPath));
}

/** The runner's log and build stamp, with the start lines written. */
async function openLog(args: Args, deps: RunnerDeps): Promise<{ log: RunnerLog; build: string }> {
  const log = new RunnerLog(path.join(args.root, 'runner.log'), deps.stdout ?? ((line: string): void => console.log(line)));
  // The build stamp (req-51): a rebuild that changed the fleet code makes the client retire this daemon with a handover.
  const build = await fleetBuildStamp(__filename);
  log.line(`daemon pid ${process.pid} starting in ${args.root} (v${VERSION})`);
  const scrubbed = scrubInheritedEnv(process.env);
  if (scrubbed.length > 0) {
    log.line(`workers start without ${scrubbed.length} inherited variable(s): ${scrubbed.join(', ')}`);
  }
  return { log, build };
}

/** Binds the API to the loopback port; `up` runs once it listens. */
function listen(server: ReturnType<RunnerHttpApi['server']>, port: number, up: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      up();
      resolve();
    });
  });
}

export async function startRunner(args: Args, deps: RunnerDeps = {}): Promise<RunnerHandle | null> {
  const exitProcess = deps.exit ?? ((code: number): void => process.exit(code));
  await fsp.mkdir(path.join(args.root, 'runs'), { recursive: true });
  const descriptorPath = path.join(args.root, 'runner.json');
  const writesDescriptor = (deps.descriptor ?? 'file') === 'file';
  if (writesDescriptor && (await healthyPeer(descriptorPath))) {
    exitProcess(0); // a healthy peer keeps this process out; a stale descriptor is taken over
    return null;
  }
  const { log, build } = await openLog(args, deps);
  const ledger = ledgerOf(log.line);
  const hub = new EventHub();
  const stream = new EventStream(hub);
  const capacity = new PoolCapacity(fetchTotalSlots, SYSTEM_CLOCK, log.line);
  const routing = routingFor(args, deps, { log: log.line, hub, capacity });
  const governor = await governorOf(args, deps, { log: log.line, hub, routing });
  const { supervisors, orchestrator } = composeFleet({ root: args.root, log: log.line, events: ledger.events, hub, routing, capacity, governor });
  await supervisors.adoptAll();
  seedRouting(routing, supervisors, governor);
  await routing.start();
  await orchestrator.load();
  const descriptor: RunnerDescriptor = { port: await freePort(), token: crypto.randomBytes(24).toString('hex'), pid: process.pid, startedAt: new Date().toISOString(), version: VERSION, build };
  const idle = new IdleWatch(args.idleMs);
  const closeStreams = (): void => {
    stream.closeAll();
    routing.stop();
    governor.ticker.stop();
  };
  const exit = new RunnerExit({ exit: exitProcess, log, orchestrator, supervisors, idle, idleMs: args.idleMs, descriptorPath: writesDescriptor ? descriptorPath : null, closeStreams });
  const api = new RunnerHttpApi(
    descriptor.token,
    [new LifecycleRoutes(exit, supervisors, log, { version: VERSION, build }), new ChainRoutes(orchestrator, supervisors, exit, ledger.setVault), new RunReadRoutes(supervisors), new RunWriteRoutes(supervisors), new SlotRoutes(routing.registry, routing.config, routing.check), new ModelRoutes(routing.poolDesk, routing.config), new GovernorRoutes(governor.governor), stream],
    { exit, idle },
  );
  const server = api.server();
  await listen(server, descriptor.port, () => {
    if (writesDescriptor) {
      writeDescriptor(descriptorPath, descriptor);
    }
    log.line(`listening on 127.0.0.1:${descriptor.port} (pid ${process.pid})`);
  });
  exit.start(server);
  governor.ticker.start(governor.governor);
  if (deps.signals ?? true) {
    installSignals(exit, writesDescriptor ? descriptorPath : null);
  }
  return {
    port: descriptor.port,
    token: descriptor.token,
    descriptorPath,
    descriptor,
    stop: async () => {
      await exit.stopLiveRuns();
      await new Promise<void>((resolve) => {
        server.once('close', resolve);
        exit.shutdown(0);
      });
    },
  };
}

// The process entry only: the spec imports `startRunner` and runs the daemon in-process against a temp root.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  void startRunner(parseArgs(process.argv.slice(2)));
}
