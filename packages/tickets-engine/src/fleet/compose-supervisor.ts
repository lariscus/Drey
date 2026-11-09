/**
 * The wiring of the Crew runner's parts (ADR-0096): every part built once
 * and handed its collaborators by constructor. This is the composition
 * root's helper — `runner.ts` builds the shared part once and one
 * supervisor per provider with the concrete adapter and store; a spec
 * calls it with fakes. A late-bound arrow (`(run) => stopper.claimLost(run)`)
 * closes the few loops between parts (a lost claim stops its own run).
 */
import { hostname } from 'node:os';
import { TicketsGit } from '../core/tickets-git';
import { NodeFileSystem } from './node-file-system';
import { NodeProcessTable } from './node-process-table';
import { NodeTreeMode } from './node-tree-mode';
import { clockOf, type Clock } from './ports/clock';
import { NULL_SINK, type EventSink } from './ports/event-sink';
import type { FileSystem } from './ports/file-system';
import type { ProcessTable } from './ports/process-table';
import type { TreeMode } from './ports/tree-mode';
import type { ExecFn } from './procs';
import type { ProviderAdapter } from './harness/contract';
import type { RunInfo, RunRequest } from './protocol';
import type { RunLimits } from './run/run-limits';
import { isTerminal } from './run/run-state';
import { RunStateMachine } from './run/run-state-machine';
import { execShell, probeExec, validateTrailers } from './shell-exec';
import type { StoreForTarget } from './store/ticket-store';
import { normalizeForMatch, prepareWorktree as defaultPrepareWorktree } from './worktrees';
import { AttachmentStore } from './orchestrate/attachment-store';
import { BackgroundWork } from './orchestrate/background-work';
import { ClaimRelease } from './orchestrate/claim-release';
import { EventFold } from './orchestrate/event-fold';
import { GateRunner, type GateSeats, type GateShell, type TrailerCheck } from './orchestrate/gate-runner';
import { HandoverSettings } from './orchestrate/handover-settings';
import { LeftoverClaims } from './orchestrate/leftover-claims';
import { OwnerAnswers } from './orchestrate/owner-answers';
import { ClosingRound } from './orchestrate/closing-round';
import { ClosingSignalRule } from './orchestrate/closing-signal-rule';
import { PersonaJournalWriter } from './orchestrate/persona-journal-writer';
import { PersonaMemory } from './orchestrate/persona-memory';
import { RecordedRunCosts } from './orchestrate/recorded-run-costs';
import { ResumeRoundAsker } from './orchestrate/resume-round-asker';
import { RoundProposalWriter } from './orchestrate/round-proposal-writer';
import { ProcessSupervisor } from './orchestrate/process-supervisor';
import { ReviewCheckout } from './orchestrate/review-checkout';
import { RunAdoption } from './orchestrate/run-adoption';
import { RunBookkeeper } from './orchestrate/run-bookkeeper';
import { RunClaims, type LeaseTimers } from './orchestrate/run-claims';
import { RunCompletion } from './orchestrate/run-completion';
import { IdleRelease } from './orchestrate/idle-release';
import { HeldSessionStarter } from './orchestrate/held-session-starter';
import { RunReaper } from './orchestrate/run-reaper';
import { RunReopener } from './orchestrate/run-reopener';
import { RunRepository } from './orchestrate/run-repository';
import { RunSettler } from './orchestrate/run-settler';
import { RunStarter, type PrepareWorktree } from './orchestrate/run-starter';
import { RunStopper } from './orchestrate/run-stopper';
import { RunStreams } from './orchestrate/run-streams';
import { RunSupervisor } from './orchestrate/run-supervisor';
import { RunTakeover } from './orchestrate/run-takeover';
import { RunnerHandover } from './orchestrate/runner-handover';
import { SessionHandover } from './orchestrate/session-handover';
import type { SlotBinder } from './orchestrate/slot-binder';
import { SteerService } from './orchestrate/steer-service';
import { StoreClaims } from './orchestrate/store-claims';
import { TicketCopy } from './orchestrate/ticket-copy';
import { WaitClaim } from './orchestrate/wait-claim';
import { WorkcopyFiles } from './orchestrate/workcopy-files';
import { WorkerLauncher, type WorkerSeats } from './orchestrate/worker-launcher';
import type { WorkerVaultGate } from './orchestrate/worker-vault';

type TicketsGitSeam = Pick<TicketsGit, 'run' | 'locate' | 'commitPaths' | 'push'>;

/** What the whole runner shares: one clock, one stream writer, one store side, the one ticket writer. */
export interface RunnerShared {
  readonly clock: Clock;
  readonly streams: RunStreams;
  readonly stores: StoreClaims;
  readonly bookkeeper: RunBookkeeper;
  readonly fs: FileSystem;
  readonly sink: EventSink;
}

/** The machine the shared part runs on: Node's files and no listener, unless the runner or a spec says otherwise. */
export interface SharedPorts {
  readonly fs?: FileSystem;
  readonly sink?: EventSink;
}

export function composeShared(storeFor: StoreForTarget, log: (message: string) => void, now?: () => Date, ports: SharedPorts = {}): RunnerShared {
  const clock = clockOf(now);
  const fs = ports.fs ?? new NodeFileSystem();
  const sink = ports.sink ?? NULL_SINK;
  const streams = new RunStreams(clock, fs, sink);
  const stores = new StoreClaims(storeFor, clock, log);
  const copy = new TicketCopy(stores, fs, new WorkcopyFiles(fs, log), log);
  const bookkeeper = new RunBookkeeper({
    streams,
    release: new ClaimRelease(stores, copy, clock, log),
    wait: new WaitClaim(stores, copy, log),
    copy,
    clock,
    actor: `agent@${hostname().toLowerCase()}`,
    log,
  });
  return { clock, streams, stores, bookkeeper, fs, sink };
}

export interface RunSupervisorDeps {
  readonly root: string;
  readonly adapter: ProviderAdapter;
  /** git executable for the worktree ops and the attachments' exclude file. */
  readonly git: string;
  readonly log: (message: string) => void;
  /** The store of a run's dricket target — the one ticket backend (req-176). */
  readonly storeFor: StoreForTarget;
  /** The runner's shared part; a spec without one gets its own. */
  readonly shared?: RunnerShared;
  readonly now?: () => Date;
  /** The process probes (liveness, start time). */
  readonly exec?: ExecFn;
  /** The gate's shell commands (cwd = the worktree). */
  readonly execShell?: GateShell;
  readonly prepareWorktree?: PrepareWorktree;
  readonly ticketsGit?: TicketsGitSeam;
  /** `dk validate --trailers` (the gate's trailer check): null = passes. */
  readonly validateTrailers?: TrailerCheck;
  readonly leaseTimers?: LeaseTimers;
  /** Run settled (terminal): the orchestrator's slot-freed trigger (M85). */
  readonly onRunSettled?: (info: RunInfo) => void;
  /** The quality rungs (M85, flagged off): a second worker's brief on a green gate, or null. */
  readonly secondOpinion?: (request: RunRequest) => Promise<string | null>;
  /** Per-run ceilings (0 = unlimited); a run that passes one is failed, never retried at once. */
  readonly limits?: Partial<RunLimits>;
  /** req-177: the slot (account) each run starts on; absent = no slots. */
  readonly slots?: SlotBinder;
  /** req-180: the resource governor's seats — light for the worker, heavy per gate command; absent = none. */
  readonly seats?: WorkerSeats & GateSeats;
  /** req-167: Drey Service's vault MCP, handed to every worker this supervisor spawns. */
  readonly vault?: WorkerVaultGate;
  /** req-183: the review checkout's on-disk guard; absent = Node's (`NodeTreeMode`). */
  readonly treeMode?: TreeMode;
  /** req-168: how long a held 1:1 stands idle before it is released; absent = the default span. */
  readonly oneOnOneIdleMs?: number;
}

/** The parts that touch the worker, the ticket and the record, with the loops between them closed. */
interface Runtime extends RunnerShared {
  readonly deps: RunSupervisorDeps;
  readonly table: ProcessTable;
  readonly machine: RunStateMachine;
  readonly background: BackgroundWork;
  readonly repo: RunRepository;
  readonly settings: HandoverSettings;
  readonly claims: RunClaims;
  readonly settler: RunSettler;
  readonly processes: ProcessSupervisor;
  readonly stopper: RunStopper;
  readonly takeover: RunTakeover;
  readonly completion: RunCompletion;
  readonly git: TicketsGitSeam;
  readonly review: ReviewCheckout;
}

/** The worker environment of a run's slot, when slots are wired. */
function slotEnvOf(slots: SlotBinder | undefined): { slotEnv?: (slotId: string) => Readonly<Record<string, string>> | undefined } {
  return slots === undefined ? {} : { slotEnv: (slotId) => slots.envOf(slotId) };
}

function runtimeOf(deps: RunSupervisorDeps): Runtime {
  const shared = deps.shared ?? composeShared(deps.storeFor, deps.log, deps.now);
  const { clock, streams, bookkeeper } = shared;
  const log = deps.log;
  const machine = new RunStateMachine();
  const background = new BackgroundWork();
  const repo = new RunRepository(deps.root, shared.fs, shared.sink);
  const settings = new HandoverSettings(deps.adapter.id);
  const table = new NodeProcessTable(deps.exec ?? probeExec(deps.root));
  const git = deps.ticketsGit ?? new TicketsGit(() => deps.git);
  const review = new ReviewCheckout({ git, mode: deps.treeMode ?? new NodeTreeMode(), fs: shared.fs, log });
  const timers = deps.leaseTimers !== undefined ? { leaseTimers: deps.leaseTimers } : {};
  const claims = new RunClaims({ stores: shared.stores, log, clock, background, ...timers, onLost: (run, why): Promise<void> => stopper.claimLost(run, why) });
  const settler = new RunSettler({ machine, repo, bookkeeper, clock, log, review, ...(deps.onRunSettled !== undefined ? { onRunSettled: deps.onRunSettled } : {}) });
  const takeover = new RunTakeover(repo, bookkeeper);
  const events: EventFold = new EventFold({ repo, streams, bookkeeper, background, log, interrupt: (run) => takeover.interrupt(run.info.id), claimLost: (run, why): Promise<void> => stopper.claimLost(run, why) });
  const processes: ProcessSupervisor = new ProcessSupervisor({ adapter: deps.adapter, repo, events, background, settings, table, log, ...slotEnvOf(deps.slots), ...(deps.vault !== undefined ? { vault: deps.vault } : {}), onExit: (run, code): Promise<void> => completion.onWorkerExit(run, code) });
  const stopper: RunStopper = new RunStopper(machine, repo, processes, { settler, bookkeeper, log });
  const gate = new GateRunner({ bookkeeper, shell: deps.execShell ?? execShell, trailers: deps.validateTrailers ?? validateTrailers, repo, review, ...(deps.seats !== undefined ? { seats: deps.seats } : {}) });
  const opinion = deps.secondOpinion !== undefined ? { secondOpinion: deps.secondOpinion } : {};
  const closing = closingRoundOf({ shared, repo, processes, log });
  const completion: RunCompletion = new RunCompletion({ machine, repo, gate, bookkeeper, settler, processes, closing, ...opinion });
  return { ...shared, deps, table, machine, background, repo, settings, claims, settler, processes, stopper, takeover, completion, git, review };
}

/** req-169: the closing round over the run's own session, its writers and the runner's records as the cost history. */
function closingRoundOf(parts: { shared: RunnerShared; repo: RunRepository; processes: ProcessSupervisor; log: (message: string) => void }): ClosingRound {
  const { shared, repo, processes, log } = parts;
  const { clock, fs, streams, bookkeeper } = shared;
  return new ClosingRound({
    rule: new ClosingSignalRule(new RecordedRunCosts(() => repo.list())),
    asker: new ResumeRoundAsker({ spawner: processes, stream: (run, event) => void streams.append(run, event).catch(() => undefined), delay: unrefDelay }),
    journal: new PersonaJournalWriter(fs, log),
    memory: new PersonaMemory(clock, fs, log),
    proposals: new RoundProposalWriter(clock, fs, log),
    clock,
    note: (run, what) => bookkeeper.note(run, what),
    log,
  });
}

/** A wait that never keeps the process alive by itself. */
function unrefDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

function prepareOf(rt: Runtime, git: TicketsGitSeam): PrepareWorktree {
  if (rt.deps.prepareWorktree !== undefined) {
    return rt.deps.prepareWorktree;
  }
  // Prepare-time healing (T-0044) never removes a tree a live (or detached) run holds.
  const isLive = (worktreePath: string): boolean => {
    const needle = normalizeForMatch(worktreePath);
    return rt.repo.list().some((r) => !isTerminal(r.state) && normalizeForMatch(r.worktreePath) === needle);
  };
  return (request, worktreePath) => defaultPrepareWorktree({ git, request, worktreePath, now: () => rt.clock.now(), isLive });
}

/** The two starts over one launcher: a ticket run's and a 1:1's (req-168). */
function startersOf(rt: Runtime, handover: RunnerHandover, git: TicketsGitSeam): { starter: RunStarter; heldSessions: HeldSessionStarter } {
  const { machine, repo, streams, stores, claims, bookkeeper, processes, background, clock } = rt;
  const log = rt.deps.log;
  const launcher = new WorkerLauncher({ machine, repo, processes, claims, background, streams, log, ...(rt.deps.seats !== undefined ? { seats: rt.deps.seats } : {}) });
  const sessions = new SessionHandover(repo, rt.settings, rt.deps.adapter.id, clock);
  const slots = rt.deps.slots !== undefined ? { slots: rt.deps.slots } : {};
  const retiring = (): boolean => handover.retiring;
  return {
    starter: new RunStarter({ machine, repo, streams, stores, claims, bookkeeper, sessions, launcher, prepareWorktree: prepareOf(rt, git), review: rt.review, clock, log, retiring, ...slots }),
    heldSessions: new HeldSessionStarter({ machine, repo, streams, bookkeeper, launcher, clock, log, retiring, ...slots }),
  };
}

/** req-168/173: the idle release of held sessions (1:1s, free sessions), the reaper's first look at a live run. */
function idleOf(rt: Runtime): IdleRelease {
  const idleMs = rt.deps.oneOnOneIdleMs !== undefined ? { idleMs: rt.deps.oneOnOneIdleMs } : {};
  return new IdleRelease({ settler: rt.settler, bookkeeper: rt.bookkeeper, clock: rt.clock, log: rt.deps.log, ...idleMs });
}

/** One provider's supervisor, every part wired. */
export function composeRunSupervisor(deps: RunSupervisorDeps): RunSupervisor {
  const rt = runtimeOf(deps);
  const { clock, machine, repo, streams, claims, bookkeeper, settler, processes, table, background, settings } = rt;
  const log = deps.log;
  const git = rt.git;
  const handover = new RunnerHandover(repo, processes, table, { clock, line: log });
  const { starter, heldSessions } = startersOf(rt, handover, git);
  const reopener = new RunReopener(repo, starter, settler, { processes, provider: deps.adapter.id });
  const answers = new OwnerAnswers(repo, bookkeeper, streams);
  const limits = deps.limits !== undefined ? { limits: deps.limits } : {};
  return new RunSupervisor({
    repo,
    background,
    settings,
    adoption: new RunAdoption({ machine, repo, streams, processes, claims, bookkeeper, table, clock, log }),
    handover,
    starter,
    heldSessions,
    stopper: rt.stopper,
    steer: new SteerService(repo, bookkeeper, { answers, reopener, hold: (run, why) => rt.takeover.hold(run, why) }, streams),
    takeover: rt.takeover,
    answers,
    attachments: new AttachmentStore(repo, git, rt.fs, clock),
    reopener,
    reaper: new RunReaper({ repo, settler, bookkeeper, settings, background, clock, table, log, ...limits, idle: idleOf(rt), replayExit: (run) => rt.completion.onWorkerExit(run, null) }),
    leftovers: new LeftoverClaims(deps.storeFor, log),
  });
}
