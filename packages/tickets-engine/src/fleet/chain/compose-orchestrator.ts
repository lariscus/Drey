/**
 * The wiring of the chain orchestrator (ADR-0096): the composition root's
 * helper, beside `compose-supervisor.ts`. Its ticket writes go through the
 * runner's one `RunBookkeeper`; a spec without the shared part gets its own.
 */
import { ChainConfigRestorer } from './chain-config-restorer';
import { loadDisciplineTexts, type DisciplineTexts } from '../runner/discipline-texts';
import { NodeFileSystem } from '../runner/node-file-system';
import { Orchestrator, type OrchestratorParts, type SlotSummarySource } from './orchestrator';
import type { FileSystem } from '../ports/file-system';
import { clockOf } from '../ports/clock';
import type { ChainConfig, ChainStoreConfig, WorkerProviderId } from '../protocol';
import { chainStoreIoOf, StoreChainBoard } from './store-chain-board';
import type { RunBookkeeper } from '../runner/run-bookkeeper';
import { BoardPersonas } from './board-personas';
import { ChainBoard } from './chain-board';
import { ChainState } from './chain-state';
import { ChainStateStore } from './chain-state-store';
import type { DispatchPool } from './dispatch-pool';
import { Dispatcher } from './dispatcher';
import { HolderPass } from './holder-pass';
import { HoldRecorder } from './hold-recorder';
import { PersonaBreaker } from './persona-breaker';
import { LedgerCards } from './ledger-cards';
import { PoolCapacity, type SlotProbe } from './pool-capacity';
import { fetchTotalSlots } from './pool-sizes';
import { PromptSource } from '../runner/prompt-source';
import { SettledRuns, type FleetLedger } from '../runner/settled-runs';
import { SupervisorDirectory, type SupervisorPort } from '../runner/supervisor-directory';
import { TicketDispatch } from './ticket-dispatch';
import { WaitNotes } from '../runner/wait-notes';
import { PublishedHold, type StartHold } from './start-hold';
import type { EventSink } from '../ports/event-sink';

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
  /**
   * The discipline texts of the run briefs (req-279: `prompts/disciplines/`);
   * absent = the shipped files beside the compiled engine (a spec may
   * pass a fixture).
   */
  readonly disciplines?: () => Promise<DisciplineTexts>;
  /** The pool probe: a llama.cpp server's `total_slots`, or null. */
  readonly probeSlots?: SlotProbe;
  /** E7: the fleet ledger; absent = silent. */
  readonly events?: FleetLedger;
  /** The store door of a dricket chain (production: the checkout's files + `dk`). */
  readonly storeChainFor?: (store: ChainStoreConfig) => StoreChainBoard;
  /** E14-5b: gives up the claims no live run holds, once per runner life and store, before its first dispatch. */
  readonly releaseLeftovers?: (store: ChainStoreConfig) => Promise<void>;
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
  /** The runner's event stream — the burn-rate hold's changes go out as `hold` events; absent = none. */
  readonly sink?: EventSink;
}

/** req-279: the discipline texts of the briefs — the shipped files by default, a spec's fixture over the deps. */
function disciplinesOf(deps: OrchestratorDeps): () => Promise<DisciplineTexts> {
  return deps.disciplines ?? loadDisciplineTexts;
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
  const persist = async (): Promise<void> => {
    await store.persist(state);
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
  const personaBreaker = new PersonaBreaker(state, { clock, log, persist });
  const dispatch = new TicketDispatch({ board, directory, personas, prompts: new PromptSource(note), disciplines: disciplinesOf(deps), notes, log, ...events });
  const pool = deps.pool !== undefined ? { pool: deps.pool, ledgerCards: new LedgerCards({ state, board, bookkeeper, persist, log }) } : {};
  const hold = holdOf(deps);
  const orchestrator: Orchestrator = new Orchestrator({
    state,
    store,
    directory,
    pools,
    settled: new SettledRuns({ state, directory, pools, personaBreaker, clock, persist, ...events }),
    dispatcher: new Dispatcher({ state, board, directory, pools, dispatch, notes, clock, log, pipelineRead, persist, holders: new HolderPass({ state, personas, directory, notes, breaker: personaBreaker, holds: new HoldRecorder({ book: state, persist, ...events }) }), ...pool, ...hold }),
    clock,
    log,
    scanIntervalMs: deps.scanIntervalMs ?? 15_000,
    persist,
    restoreConfig: (vault) => new ChainConfigRestorer(fs).restore(vault),
    ...hold,
    ...statusParts(deps),
  });
  return orchestrator;
}
