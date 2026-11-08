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
import * as path from 'node:path';
import { ChainRoutes } from './api/chain-routes';
import { LifecycleRoutes } from './api/lifecycle-routes';
import { RunReadRoutes } from './api/run-read-routes';
import { RunWriteRoutes } from './api/run-write-routes';
import { RunnerHttpApi } from './api/runner-http-api';
import { fleetBuildStamp } from './build-stamp';
import { composeOrchestrator } from './compose-orchestrator';
import { composeRunSupervisor, composeShared } from './compose-supervisor';
import { dkTargetFor, retreatStages } from './dk-target';
import { FleetEventWriter } from './event-writer';
import { kimiAdapter } from './kimi';
import { nodeKimiUsageReader } from './kimi-usage';
import type { Orchestrator, FleetEvents } from './orchestrator';
import type { RunSupervisor } from './orchestrate/run-supervisor';
import { SupervisorSet } from './orchestrate/supervisor-set';
import { freePort, nodeSpawnFn, scrubInheritedEnv } from './procs';
import type { RunnerDescriptor, WorkerProviderId } from './protocol';
import { claudeCodeAdapter, opencodeAdapter } from './providers';
import { peerAlive, readDescriptor, removeDescriptor, writeDescriptor } from './runner-descriptor';
import { RunnerExit } from './runner-exit';
import { IdleWatch } from './runner-lifecycle';
import { RunnerLog } from './runner-log';
import { DkTicketStores } from './store/dk-ticket-store';

const VERSION = 1;

export interface Args {
  readonly root: string;
  readonly idleMs: number;
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
  return { root, idleMs: Number.isFinite(idleMs) && idleMs > 0 ? idleMs : 15 * 60_000, storeBacked: argv.includes('--store-backed') };
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

/** The supervisors, one per provider, and the chain over them; the settle hook closes the loop back to the chain. */
function composeFleet(root: string, log: (message: string) => void, events: FleetEvents): { supervisors: SupervisorSet; orchestrator: Orchestrator } {
  const stores = new DkTicketStores();
  const shared = composeShared(stores.storeFor, log);
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
        onRunSettled: (info) => void orchestrator.onRunSettled(info),
        secondOpinion: (request) => orchestrator.secondOpinion(request),
      }),
    ]),
  );
  const supervisors = new SupervisorSet(byProvider);
  const orchestrator: Orchestrator = composeOrchestrator({
    root,
    log,
    events,
    bookkeeper: shared.bookkeeper,
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

export async function startRunner(args: Args, deps: RunnerDeps = {}): Promise<RunnerHandle | null> {
  const exitProcess = deps.exit ?? ((code: number): void => process.exit(code));
  await fsp.mkdir(path.join(args.root, 'runs'), { recursive: true });
  const descriptorPath = path.join(args.root, 'runner.json');
  const writesDescriptor = (deps.descriptor ?? 'file') === 'file';
  const existing = writesDescriptor ? await readDescriptor(descriptorPath) : null;
  if (existing !== null && (await peerAlive(existing))) {
    exitProcess(0); // a healthy peer keeps this process out; a stale descriptor is taken over
    return null;
  }
  const log = new RunnerLog(path.join(args.root, 'runner.log'), deps.stdout ?? ((line: string): void => console.log(line)));
  // The build stamp (req-51): a rebuild that changed the fleet code makes the client retire this daemon with a handover.
  const build = await fleetBuildStamp(__filename);
  log.line(`daemon pid ${process.pid} starting in ${args.root} (v${VERSION})`);
  const scrubbed = scrubInheritedEnv(process.env);
  if (scrubbed.length > 0) {
    log.line(`workers start without ${scrubbed.length} inherited variable(s): ${scrubbed.join(', ')}`);
  }
  const ledger = ledgerOf(log.line);
  const { supervisors, orchestrator } = composeFleet(args.root, log.line, ledger.events);
  await supervisors.adoptAll();
  await orchestrator.load();
  const descriptor: RunnerDescriptor = { port: await freePort(), token: crypto.randomBytes(24).toString('hex'), pid: process.pid, startedAt: new Date().toISOString(), version: VERSION, build };
  const idle = new IdleWatch(args.idleMs);
  const exit = new RunnerExit({ exit: exitProcess, log, orchestrator, supervisors, idle, idleMs: args.idleMs, descriptorPath: writesDescriptor ? descriptorPath : null });
  const api = new RunnerHttpApi(
    descriptor.token,
    [new LifecycleRoutes(exit, supervisors, log, { version: VERSION, build }), new ChainRoutes(orchestrator, supervisors, exit, ledger.setVault), new RunReadRoutes(supervisors), new RunWriteRoutes(supervisors)],
    { exit, idle },
  );
  const server = api.server();
  await new Promise<void>((resolve) => {
    server.listen(descriptor.port, '127.0.0.1', () => {
      if (writesDescriptor) {
        writeDescriptor(descriptorPath, descriptor);
      }
      log.line(`listening on 127.0.0.1:${descriptor.port} (pid ${process.pid})`);
      resolve();
    });
  });
  exit.start(server);
  if (deps.signals ?? true) {
    const onSignal = (): void => void exit.stopLiveRuns().finally(() => exit.shutdown(0));
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    process.once('exit', () => writesDescriptor && removeDescriptor(descriptorPath));
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
