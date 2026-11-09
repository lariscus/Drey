/**
 * The wiring of the chain orchestrator (ADR-0096): the composition root's
 * helper, beside `compose-supervisor.ts`. Its ticket writes go through the
 * runner's one `RunBookkeeper`; a spec without the shared part gets its own.
 */
import type { PipelinePhase } from '../contracts/tickets';
import { NodeFileSystem } from './node-file-system';
import { Orchestrator, type OrchestratorParts, type SlotSummarySource } from './orchestrator';
import type { FileSystem } from './ports/file-system';
import { clockOf } from './ports/clock';
import type { ChainConfig, ChainStoreConfig, WorkerProviderId } from './protocol';
import { execShell } from './shell-exec';
import { chainStoreIoOf, StoreChainBoard } from './store-chain-board';
import type { RunBookkeeper } from './orchestrate/run-bookkeeper';
import { BoardPersonas } from './orchestrate/board-personas';
import { Breaker } from './orchestrate/breaker';
import { ChainBoard } from './orchestrate/chain-board';
import { ChainState } from './orchestrate/chain-state';
import { ChainStateStore } from './orchestrate/chain-state-store';
import { CiSweep } from './orchestrate/ci-sweep';
import type { DispatchPool } from './orchestrate/dispatch-pool';
import { Dispatcher } from './orchestrate/dispatcher';
import type { GateSeats, GateShell } from './orchestrate/gate-runner';
import { HumanGates } from './orchestrate/human-gates';
import { LedgerCards } from './orchestrate/ledger-cards';
import { PoolCapacity, type SlotProbe } from './orchestrate/pool-capacity';
import { fetchTotalSlots } from './orchestrate/pool-sizes';
import { PromptSource } from './orchestrate/prompt-source';
import { SettledRuns, type FleetLedger } from './orchestrate/settled-runs';
import { SupervisorDirectory, type SupervisorPort } from './orchestrate/supervisor-directory';
import { TicketDispatch } from './orchestrate/ticket-dispatch';
import { WaitNotes } from './orchestrate/wait-notes';
import { PublishedHold, type StartHold } from './orchestrate/start-hold';
import { TicketsGit } from '../core/tickets-git';
import type { EventSink } from './ports/event-sink';
import { AnomalyDetector } from './orchestrate/tranche/anomaly-detector';
import { CheckpointReporter } from './orchestrate/tranche/checkpoint-reporter';
import { GitChangeSize } from './orchestrate/tranche/git-change-size';
import { RunFacts, type ChangeSizeReader } from './orchestrate/tranche/run-facts';
import { TrancheBudget, type DayBudget } from './orchestrate/tranche/tranche-budget';
import { TrancheLedger } from './orchestrate/tranche/tranche-ledger';
import { TranchePublisher } from './orchestrate/tranche/tranche-publisher';
import { Tranches } from './orchestrate/tranche/tranches';

export interface OrchestratorDeps {
  readonly root: string;
  readonly log: (message: string) => void;
  /** The supervisor that owns runs of this provider. */
  readonly supervisorOf: (provider: WorkerProviderId) => SupervisorPort;
  /** The runner's one ticket writer. */
  readonly bookkeeper: RunBookkeeper;
  readonly now?: () => Date;
  /** The safety-net rescan interval (default 15 s). */
  readonly scanIntervalMs?: number;
  /** The ci handover's shell exec (cwd = the work repo). */
  readonly execShell?: GateShell;
  /** req-180: the governor's heavy seat a ci check takes; absent = none. */
  readonly seats?: GateSeats;
  /** The shipped default prompt's text for a ref (version comparison); absent = no check. */
  readonly shippedPrompt?: (ref: string) => Promise<string | null>;
  /** The pool probe: a llama.cpp server's `total_slots`, or null. */
  readonly probeSlots?: SlotProbe;
  /** E7: the fleet ledger; absent = silent. */
  readonly events?: FleetLedger;
  /** The store door of a dricket chain (production: the checkout's files + `dk`). */
  readonly storeChainFor?: (store: ChainStoreConfig) => StoreChainBoard;
  /** E14-5b: gives up the claims no live run holds, once per runner life and store, before its first dispatch. */
  readonly releaseLeftovers?: (store: ChainStoreConfig, pipeline: readonly PipelinePhase[]) => Promise<void>;
  /** The files of the chain's state and the meta vault's personas and prompts; Node's by default. */
  readonly fs?: FileSystem;
  /** req-177: the slots' summary the chain status carries (the 7e band). */
  readonly slots?: SlotSummarySource;
  /** req-170: the capacity pool the dispatch asks for each persona's class; absent = no class requests. */
  readonly pool?: DispatchPool;
  /** req-170: the provider pools' throttle, shared with the pool (the runner builds it once); absent = its own. */
  readonly capacity?: PoolCapacity;
  /** req-170: moves `fleet.pool.<provider>.size` into `service.json` once, when a chain config arrives. */
  readonly migratePools?: (config: ChainConfig) => Promise<void>;
  /** req-179: the day's budget a tranche takes its share of (the provider ledger over the slots); absent = none. */
  readonly dayBudget?: DayBudget;
  /** req-179: the runner's event stream — the tranche's changes go out as `tranche` events; absent = none. */
  readonly sink?: EventSink;
  /** req-179: what a settled run changed (default: git in its worktree); a spec passes its own. */
  readonly changeSize?: ChangeSizeReader;
}

/** The tranche parts (req-179); their changes go out after each write of `chain.json`. */
function composeTranches(deps: OrchestratorDeps, state: ChainState, clock: ReturnType<typeof clockOf>): Tranches {
  const git =
    deps.changeSize ??
    new GitChangeSize(() => {
      const runner = new TicketsGit(() => state.config?.git ?? 'git');
      return (cwd, args) => runner.run(cwd, args);
    });
  return new Tranches({
    state,
    ledger: new TrancheLedger(state, clock),
    budget: new TrancheBudget(deps.dayBudget ?? { limitUsd: () => null }, clock),
    reporter: new CheckpointReporter(),
    detector: new AnomalyDetector(),
    facts: new RunFacts(git),
    clock,
    log: deps.log,
  });
}

/** req-181: the pool's burn-rate hold, told on the event stream when there is one. */
function holdOf(deps: OrchestratorDeps): { readonly hold?: StartHold } {
  const inner = deps.pool?.hold;
  if (inner === undefined) {
    return {};
  }
  return { hold: deps.sink === undefined ? inner : new PublishedHold(inner, deps.sink) };
}

/** The chain status's optional sources (req-177's slots, req-170's pool) and the pool migration. */
function statusParts(deps: OrchestratorDeps): Pick<OrchestratorParts, 'slots' | 'pool' | 'migratePools'> {
  return {
    ...(deps.slots !== undefined ? { slots: deps.slots } : {}),
    ...(deps.pool !== undefined ? { pool: deps.pool } : {}),
    ...(deps.migratePools !== undefined ? { migratePools: deps.migratePools } : {}),
  };
}

export function composeOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const { log, bookkeeper } = deps;
  const clock = clockOf(deps.now);
  const state = new ChainState();
  const fs = deps.fs ?? new NodeFileSystem();
  const store = new ChainStateStore(deps.root, fs, clock, log);
  const tranches = composeTranches(deps, state, clock);
  const published = deps.sink === undefined ? null : new TranchePublisher(deps.sink, () => tranches.status());
  const persist = async (): Promise<void> => {
    await store.persist(state);
    published?.publish();
  };
  const pipelineRead = (): Promise<void> => orchestrator.pipelineRead();
  const board = new ChainBoard({
    doorFor: deps.storeChainFor ?? ((config) => new StoreChainBoard(chainStoreIoOf(config), log)),
    ...(deps.releaseLeftovers !== undefined ? { releaseLeftovers: deps.releaseLeftovers } : {}),
    log,
  });
  const directory = new SupervisorDirectory(deps.supervisorOf);
  const pools = deps.capacity ?? new PoolCapacity(deps.probeSlots ?? fetchTotalSlots, clock, log);
  const notes = new WaitNotes(log);
  const note = (key: string, line: string): void => notes.skip(key, line);
  const personas = new BoardPersonas(note, fs);
  const events = deps.events !== undefined ? { events: deps.events } : {};
  const breaker = new Breaker(state, board, bookkeeper, { clock, log, persist });
  const dispatch = new TicketDispatch({ board, directory, personas, prompts: new PromptSource(note, fs, log, deps.shippedPrompt), notes, log, ...events });
  const humanGates = new HumanGates(board, personas, bookkeeper, log);
  const pool = deps.pool !== undefined ? { pool: deps.pool, ledgerCards: new LedgerCards({ state, board, bookkeeper, persist, log }) } : {};
  const hold = holdOf(deps);
  const orchestrator: Orchestrator = new Orchestrator({
    state,
    store,
    directory,
    pools,
    settled: new SettledRuns({ state, directory, pools, breaker, clock, persist, ...events }),
    dispatcher: new Dispatcher({ state, board, directory, pools, personas, humanGates, dispatch, notes, clock, log, pipelineRead, persist, tranches, ...pool, ...hold }),
    ci: new CiSweep({ state, board, bookkeeper, shell: deps.execShell ?? execShell, clock, log, pipelineRead, persist, ...(deps.seats !== undefined ? { seats: deps.seats } : {}) }),
    clock,
    log,
    scanIntervalMs: deps.scanIntervalMs ?? 15_000,
    tranches,
    persist,
    ...hold,
    ...statusParts(deps),
  });
  return orchestrator;
}
