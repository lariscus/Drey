/**
 * The wiring of the chain orchestrator (ADR-0096): the composition root's
 * helper, beside `compose-supervisor.ts`. Its ticket writes go through the
 * runner's one `RunBookkeeper`; a spec without the shared part gets its own.
 */
import type { PipelinePhase } from '../contracts/tickets';
import { NodeFileSystem } from './node-file-system';
import { Orchestrator } from './orchestrator';
import type { FileSystem } from './ports/file-system';
import { clockOf } from './ports/clock';
import type { ChainStoreConfig, WorkerProviderId } from './protocol';
import { execShell } from './shell-exec';
import { chainStoreIoOf, StoreChainBoard } from './store-chain-board';
import type { RunBookkeeper } from './orchestrate/run-bookkeeper';
import { BoardPersonas } from './orchestrate/board-personas';
import { Breaker } from './orchestrate/breaker';
import { ChainBoard } from './orchestrate/chain-board';
import { ChainState } from './orchestrate/chain-state';
import { ChainStateStore } from './orchestrate/chain-state-store';
import { CiSweep } from './orchestrate/ci-sweep';
import { Dispatcher } from './orchestrate/dispatcher';
import type { GateShell } from './orchestrate/gate-runner';
import { HumanGates } from './orchestrate/human-gates';
import { PoolCapacity, type SlotProbe } from './orchestrate/pool-capacity';
import { fetchTotalSlots } from './orchestrate/pool-sizes';
import { PromptSource } from './orchestrate/prompt-source';
import { SettledRuns, type FleetLedger } from './orchestrate/settled-runs';
import { SupervisorDirectory, type SupervisorPort } from './orchestrate/supervisor-directory';
import { TicketDispatch } from './orchestrate/ticket-dispatch';
import { WaitNotes } from './orchestrate/wait-notes';

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
}

export function composeOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const { log, bookkeeper } = deps;
  const clock = clockOf(deps.now);
  const state = new ChainState();
  const fs = deps.fs ?? new NodeFileSystem();
  const store = new ChainStateStore(deps.root, fs, clock, log);
  const persist = (): Promise<void> => store.persist(state);
  const pipelineRead = (): Promise<void> => orchestrator.pipelineRead();
  const board = new ChainBoard({
    doorFor: deps.storeChainFor ?? ((config) => new StoreChainBoard(chainStoreIoOf(config), log)),
    ...(deps.releaseLeftovers !== undefined ? { releaseLeftovers: deps.releaseLeftovers } : {}),
    log,
  });
  const directory = new SupervisorDirectory(deps.supervisorOf);
  const pools = new PoolCapacity(deps.probeSlots ?? fetchTotalSlots, clock, log);
  const notes = new WaitNotes(log);
  const note = (key: string, line: string): void => notes.skip(key, line);
  const personas = new BoardPersonas(note, fs);
  const events = deps.events !== undefined ? { events: deps.events } : {};
  const breaker = new Breaker(state, board, bookkeeper, { clock, log, persist });
  const dispatch = new TicketDispatch({ board, directory, personas, prompts: new PromptSource(note, fs, log, deps.shippedPrompt), notes, log, ...events });
  const humanGates = new HumanGates(board, personas, bookkeeper, log);
  const orchestrator: Orchestrator = new Orchestrator({
    state,
    store,
    directory,
    pools,
    settled: new SettledRuns({ state, directory, pools, breaker, clock, persist, ...events }),
    dispatcher: new Dispatcher({ state, board, directory, pools, personas, humanGates, dispatch, notes, clock, log, pipelineRead, persist }),
    ci: new CiSweep({ state, board, bookkeeper, shell: deps.execShell ?? execShell, clock, log, pipelineRead, persist }),
    clock,
    log,
    scanIntervalMs: deps.scanIntervalMs ?? 15_000,
  });
  return orchestrator;
}
