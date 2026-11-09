/**
 * The fleet runner's wire protocol (ADR-0075, milestone 84): the shapes
 * the tickets plugin's main side exchanges with the standalone runner
 * over its loopback HTTP surface — and the runner's normalized run
 * record, which doubles as `run.json` on disk.
 *
 * The runner is a plain Node process (spawned detached with
 * ELECTRON_RUN_AS_NODE from the plugin bundle's sibling file): it never
 * imports Electron, and everything crossing this file must stay
 * JSON-serializable. The instruction text is composed plugin-side (the
 * vault is where prompts and ticket context live); the runner owns the
 * worker process, its pipes, the worktree and the machine gate.
 */
import type { HandoverMode } from './protocol-fleet-config';
import type { CapabilityClass, PoolGrantRecord, RunLedgerInput } from './protocol-pool';
import type { RouteRecord } from './protocol-routing';
import type { ModelNeeds } from '../contracts/ticket-pool-meta';
import type { SlotProfile } from './protocol-slots';
import type { ShapedQuestion } from '../contracts/question-shape';
import type { TicketForm } from '../contracts/tickets';

// The fleet settings shapes (T-0048, T-0049, req-63) and the chain protocol (M85) live beside this file.
export { DEFAULT_FLEET_CAPS, DEFAULT_FLEET_HANDOVER, DEFAULT_FLEET_POOL, normalizeFleetCaps, normalizeFleetHandover, normalizeFleetPools } from './protocol-fleet-config';
export type { FleetCaps, FleetHandoverConfig, FleetPool, FleetPools, HandoverMode } from './protocol-fleet-config';
export { normalizeChainStore } from './protocol-chain';
export { CAPABILITY_CLASSES, isCapabilityClass, isPartSize, PART_SIZE_CLASS } from './protocol-pool';
export type { CapabilityClass, CapacityConfig, ClassRequest, FullLedger, LedgerDefaults, LedgerFigure, LedgerName, ModelRow, ModelsReply, PartSize, PoolDecision, PoolEntry, PoolGrantDecision, PoolGrantRecord, PoolLoad, PoolSettings, PoolWaitDecision, QueueEntry, QueueReason, RunLedgerInput, SlotLoad } from './protocol-pool';
export { DEFAULT_ROUTING, INPUT_MODALITIES } from './protocol-routing';
export type { CapabilityImportReport, FilteredSlot, InputModality, ModelCapabilities, RouteRecord, RouteStepUp, RoutingSettings } from './protocol-routing';
export type { ModelNeeds } from '../contracts/ticket-pool-meta';
export { SLOT_PROFILES } from './protocol-slots';
export type { QuotaKind, QuotaReliability, QuotaWindow, SlotBilling, SlotProfile, SlotStateName, SlotSummary, SlotView } from './protocol-slots';
export type { AutopilotRecord, AutopilotReason, AutopilotRefusal, AutopilotState, ChainConfig, ChainMaster, ChainStatus, ChainStoreConfig, ChainTrip, ColumnMode } from './protocol-chain';
export { DEFAULT_EARLY_STOP, DEFAULT_TRANCHE, normalizeTranche, tranchesOff, tranchesPerDay } from './protocol-tranche';
export type { AnomalyRule, CheckpointReport, EarlyStop, EarlyStopConfig, RedTicket, TrancheConfig, TrancheEnd, TrancheStatus } from './protocol-tranche';
export { DEFAULT_DEV_PORTS, DEFAULT_GOVERNOR_SETTINGS } from './protocol-governor';
export type { DevServerLease, GovernorSettings, GovernorStatus, GovernorWait, HeavyTask, PortRange, SeatClass, SeatHolder } from './protocol-governor';

/** The workers of milestone 84, in fleet order (the assignment default). */
export type WorkerProviderId = 'opencode' | 'claude-code' | 'kimi';

export const WORKER_PROVIDERS: readonly WorkerProviderId[] = ['opencode', 'claude-code', 'kimi'];

export function isWorkerProvider(value: unknown): value is WorkerProviderId {
  return typeof value === 'string' && (WORKER_PROVIDERS as readonly string[]).includes(value);
}

/** How the runner may let the agent answer itself (blast radius; ADR-0075). */
export type PermissionMode = 'accept-edits' | 'bypass';

/**
 * The interactive dialog modes (req-65): the owner drives the run as a
 * conversation — held from turn one, no gate, no move at its end; the
 * owner moves the ticket themselves when the dialog ends. `'plan'`
 * interviews the owner and writes the plan into the ticket. (A second
 * mode, `'refine'` -- the checkpoint companion -- was removed in E13-9:
 * shaping is the ticket file plus Mission Control in the Assistant.)
 */
export type InteractiveMode = 'plan';

/** Where a run's ticket is claimed and released (E14-5): the store the board runs on. */
export interface RunDkTarget {
  /** `dk` executable; empty = `dk` on PATH. */
  readonly bin: string;
  /** The dricket store (`tickets.dk.store`). */
  readonly store: string;
  /** `DK_DATA_DIR`; empty = dk's default. */
  readonly dataDir: string;
  /** The checkout the board reads (`tickets.dk.checkout`); empty = none. */
  readonly checkout: string;
  /**
   * The stage a parked ticket (a manual step follows, or the worker is blocked)
   * is released to, with a comment. Null = it stays in its stage with the comment:
   * the owner's store may have no `blocked` stage (`dricket.toml` `[stages]`).
   */
  readonly parkStage: string | null;
  /** E14-5b (Q-03): the stage a run that waits for the owner is released to; null = it stays where it is, unclaimed. Absent on older runners. */
  readonly needsInputStage?: string | null;
  /** The stage before the working one, for a release that may not stay put (dk refuses `build -> build` for an agent). */
  readonly retreatStage: string | null;
  /** Workers put `Dricket-*` trailers on their commits and the gate runs `dk validate --trailers` (off by default). */
  readonly trailers: boolean;
}

/**
 * What the runner needs to start one run. One run = one ticket = one
 * worktree on the deterministic branch (ADR-0075); the ticket-file
 * context rides along because the runner composes the instruction and
 * runs the machine gate in the worker's checkout.
 */
export interface RunRequest {
  /** The ticket this run works on (schema id = filename stem). */
  readonly ticketId: string;
  /**
   * The ticket's form (E8, concept §5.6): `'scout'` dispatches an
   * exploration, not a build — the runner prepares no worktree
   * (`worktreePath` then names the read ground, never a prepared
   * worktree), runs no gate (`gate: 'none'`) and moves nothing. Absent
   * = `'ship'`, the wire shape every pre-E8 sender produced; the
   * build-stamp respawn keeps the plugin and the runner in lockstep, so
   * a runner that predates the field never receives it for long.
   */
  readonly form?: TicketForm;
  /** Absolute path of the tickets vault (the runner edits the file there). */
  readonly ticketsVaultPath: string;
  /** Vault-relative path of the ticket file (`tickets/<phase>/<id>.md`). */
  readonly ticketRelPath: string;
  /** The phase the ticket sits in now (the runner moves it on success). */
  readonly phase: string;
  /** Absolute path of the work repo's checkout. */
  readonly repoPath: string;
  /**
   * The run's worktree, absolute (`<ticketsRepo>/_worktrees/<ticket-id>`
   * by default, ADR-0080). Computed in `composeRunRequest` — the runner
   * never derives paths; an old sender without the field is refused.
   */
  readonly worktreePath: string;
  /** The deterministic branch — `t/<id>` (ADR-0076). */
  readonly branch: string;
  /** The base ref a fresh worktree branches from (repos.md `branch:` or HEAD). */
  readonly baseRef: string | null;
  /**
   * Git-ignored folders of `repoPath` the worktree links instead of
   * rebuilding (repos.md `link:`, req-56) — the toolchain a worker would
   * otherwise hunt for. Absent on requests from before it existed.
   */
  readonly links?: readonly string[];
  /**
   * The ticket's further work repos (req-72), primary excluded — one
   * worktree each, same branch, prepared like the primary's. Absent on
   * single-repo tickets (the overwhelmingly common shape).
   */
  readonly extraRepos?: readonly {
    readonly name: string;
    readonly repoPath: string;
    readonly worktreePath: string;
    readonly baseRef: string | null;
    readonly links?: readonly string[];
  }[];
  readonly provider: WorkerProviderId;
  readonly permissionMode: PermissionMode;
  /** Provider model pin, when the assignment names one (`worker@provider/model`). */
  readonly model: string | null;
  /** The composed instruction (prompt template + ticket context, plugin-side). */
  readonly instruction: string;
  /**
   * What a resumed session is prompted with instead (req-80): the session
   * already holds the full brief, so only what changed since — diff stat,
   * gate failure, the gate. Used only while `briefDigest` still matches the
   * resumed run's; absent from older senders (the full instruction rides).
   */
  readonly continuationInstruction?: string;
  /** A hash of the brief's stable parts (instructions, phase template, plan, description, gate). */
  readonly briefDigest?: string;
  /** The machine gate: the ticket's backticked acceptance commands, in order. */
  readonly acceptance: readonly string[];
  /**
   * `commands` runs the acceptance commands (the normal gate).
   * `structural` is the plan phase's gate: the ticket entered without
   * executable criteria (writing them is the plan's job), so the gate
   * instead checks that the run produced at least one.
   * `none` (E8, concept §5.6) is the scout run's shape: exploration only,
   * the worker's finished turn is the deliverable's declaration and no
   * gate ever runs.
   */
  readonly gate: 'commands' | 'structural' | 'none';
  /** Git executable for worktree + ticket commits (the plugin's gitPath or `git`). */
  readonly git: string;
  /** Transition target after a green gate — the pipeline's next phase id. */
  readonly nextPhase: string | null;
  /** Resolved directory name for `nextPhase` (numbered `NN-<id>` folders,
   *  T-0041); null exactly when `nextPhase` is null. Older stored records
   *  predate it — readers fall back to the phase id. */
  readonly nextPhaseDir: string | null;
  /** pipeline.md `push:` — the remote the transition commit is pushed to
   *  after a green move (T-0041); null = never push. */
  readonly pushRemote: string | null;
  /** Next phase claims (claim: true) → stamped with this identity. */
  readonly claimIdentity: string | null;
  /**
   * E10-6: a manual step follows this gate in the ticket's chain. On a
   * green gate the ticket does not move on (a pulled ticket moves into the
   * working column only): it parks with `awaiting: <human persona id>`.
   */
  readonly parkFor?: string;
  /**
   * The column's own run ceilings (`max-turns:` / `max-work:` in
   * pipeline.md); absent keys fall back to the runner's defaults.
   */
  readonly limits?: { readonly maxTurns?: number; readonly maxWorkMs?: number };
  /** The dialog's explicit worker choice, recorded on the ticket (`worker:`). */
  readonly recordWorker?: string;
  /**
   * Who asked for this run (D-41): `chain`, `accept`, `mcp`, `drey:run-dialog`,
   * `drey:plan-dialog`, `device <name> (<id>)`, `handoff of <run>`. The runner logs it and
   * refuses a start without one. Optional on the wire: records from before D-41 have none.
   */
  readonly origin?: string;
  /**
   * How the run's context should reach the worker (T-0049): `'auto'`
   * lets the supervisor resolve it from the ticket's run history, an
   * explicit mode is honoured when structurally legal. Absent — every
   * request from an older plugin — means `'fresh'`.
   */
  readonly handover?: HandoverMode | 'auto';
  /**
   * The owner drives this run as a dialog (req-65): the worker is held
   * from turn one, the run never gates and never moves — the owner moves
   * the ticket themselves when the dialog ends. The ticket's `run:` stamp
   * is still laid (the run occupies the worktree and keeps the
   * dispatcher off the ticket while it lives).
   */
  readonly interactive?: InteractiveMode;
  /**
   * The working column when the orchestrator dispatched the run (M85,
   * ADR-0077): the pool whose slot the run occupies — which can differ
   * from `phase`, because a pool tops up from the previous column (the
   * ticket then still sits in that column while the run works it).
   * Null on an owner-started run.
   */
  readonly column?: string | null;
  /**
   * E14-5 (ADR-0090): the ticket lives in a dricket store. Present = the runner
   * claims through `dk` before the worker spawns, keeps the lease alive, gives
   * the ticket up with a stage and a message, and writes NO ticket file (no
   * `run:` stamp, no Log line, no folder move). Absent = the files backend,
   * every older sender.
   */
  readonly dk?: RunDkTarget;
  /** req-177: the repository's profile (`profile:` in `_meta/repos.md`); absent = `private`. A run is served only by a slot of this profile. */
  readonly profile?: SlotProfile;
  /** req-170: the class the start asked the pool for (the dispatch's class request); absent = a pinned model decides by its own row. */
  readonly poolClass?: CapabilityClass;
  /** req-170: why that class — the plan part's size, the phase floor, the ticket pin; lands on the run record. */
  readonly poolWhy?: string;
  /** req-170: what the ledgers need (the ticket's allowance, the persona's budget and permission); absent = the Settings defaults. */
  readonly ledger?: RunLedgerInput;
  /** req-178: the capabilities the run's model must have (the phase's and the ticket's `needs:`); the start's gate filters on them again. */
  readonly poolNeeds?: ModelNeeds;
  /** req-178: the dispatch's routing decision — the start's gate prefers its slot and keeps its class (a step up stays one); lands on the run record. */
  readonly poolRoute?: RouteRecord;
}

/** How the run's worktree was obtained — `prepareWorktree` (T-0047) is
 *  idempotent per ticket, so a repeated run reports what it did. */
export type WorktreeOutcome = 'reused' | 'created' | 'recreated' | 'moved-aside';

// ---------------------------------------------------------------------------
// Token telemetry (T-0048): what a provider reported one run used. A
// counter is `null` when the provider never reported it — 0 is a
// measurement, absence is not (the pinned plan provider may report no
// cache fields at all).

export interface RunUsage {
  readonly input: number | null;
  readonly cacheRead: number | null;
  readonly cacheCreation: number | null;
  readonly output: number | null;
}

/** One question of OpenCode's `question` tool (a field of its pending form). */
export interface WaitQuestion {
  /** The form field the answer goes to (`q0`, `q1`, …). */
  readonly key: string;
  /** The short label the worker gave the question. */
  readonly header?: string;
  readonly question: string;
  /** The choices offered; the owner may also answer in their own words. */
  readonly options: readonly { readonly label: string; readonly description?: string }[];
  /** Several choices may be picked. */
  readonly multiple: boolean;
}

/** The owner's answer to a question form: per field key, a choice or free text (several for `multiple`). */
export type QuestionAnswers = Readonly<Record<string, string | readonly string[]>>;

/** Checks an answers payload off the wire; null when it is not one. */
export function questionAnswersOf(raw: unknown): QuestionAnswers | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const answers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      answers[key] = value;
    } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      answers[key] = value as string[];
    } else {
      return null;
    }
  }
  return answers;
}

/**
 * What a live worker waits on the owner for (req-64): a question it ended
 * its turn with (`QUESTION: …`) or asked with OpenCode's `question` tool,
 * or a tool call the provider wants approved (OpenCode's permission
 * requests). The run stays up, its session and context kept, until the
 * owner answers.
 */
export interface RunWaiting {
  readonly kind: 'question' | 'permission';
  /** The question, or what the tool wants to do (action and resources). */
  readonly text: string;
  /** When the wait began (ISO). */
  readonly since: string;
  /** The provider's id of the permission request or question form — what the answer names. */
  readonly requestId?: string;
  /** The questions of a question form, with their choices (absent for a `QUESTION:` turn). */
  readonly questions?: readonly WaitQuestion[];
  /** The parsed fixed shape of a `QUESTION:` turn, req-75 W2; absent when the text does not follow it. */
  readonly shaped?: ShapedQuestion;
}

/**
 * The lead-in a worker opens its last message with when it cannot go on
 * without the owner (req-64). The turn then does not end the run: the
 * worker stands, waiting, until the owner answers in the takeover tab.
 */
export const QUESTION_MARKER = 'QUESTION:';

/**
 * The lead-in a worker ends its last message with when the step cannot
 * be completed (an unresolved merge conflict, a protected repo's merge,
 * a failed push): the turn ends, but it is no completion declaration —
 * the runner runs no gate and moves nothing; the ticket stays put until
 * the owner moves it (ADR-0077's agent-decided completion, the refusal
 * half: a green gate must never move a step the worker declared
 * incomplete).
 */
export const BLOCKED_MARKER = 'BLOCKED:';

/** The owner's answer to a permission request (OpenCode's three replies). */
export type PermissionDecision = 'once' | 'always' | 'reject';

/** A run as the runner reports it — and as `run.json` persists it. */
export interface RunInfo {
  readonly id: string;
  readonly ticketId: string;
  /** The persona that dispatched the run (ADR-0088 E3); null/absent pre-personas. */
  readonly persona?: string | null;
  readonly provider: WorkerProviderId;
  readonly state: RunState;
  readonly pid: number | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** The provider session to resume/steer with, once known. */
  readonly sessionRef: string | null;
  readonly tokensIn: number;
  readonly tokensOut: number;
  /**
   * The part of `tokensIn` served from the provider's prompt cache
   * (req-53) — absent on a run.json written before it was recorded.
   */
  readonly cacheReadTokens?: number;
  readonly costUsd: number | null;
  readonly lastActivity: string;
  /**
   * What the worker is doing right now, in one short line (the last
   * tool call or the first line of its last text) — the board's lane
   * shows it. Absent on a run.json written before the lanes existed.
   */
  readonly activity?: string;
  /** req-180: the dev-server port the governor leased the run's worktree (`DREY_DEV_PORT`); absent = none. */
  readonly devPort?: number;
  /**
   * The size of the worker's current context window in tokens (the
   * last model call's input incl. cache reads); null/absent while the
   * provider has reported none.
   */
  readonly contextTokens?: number | null;
  /**
   * The model's context window in tokens — the limit the board measures
   * `contextTokens` against. Null/absent while the provider has
   * reported none (the board then measures against its default window);
   * absent on run.json records written before the field existed.
   */
  readonly contextWindow?: number | null;
  /**
   * The owner has taken the run over (the takeover tab): the worker's
   * finished turn does not end the run, the reaper leaves a quiet worker
   * alone, and the runner sends it nothing of its own until it is handed back.
   */
  readonly held?: boolean;
  /**
   * An interactive dialog run (req-65): started for the owner's
   * conversation — held from turn one, no gate, no move. The takeover
   * tab shows the dialog's end moves for such a run.
   */
  readonly interactive?: InteractiveMode;
  /**
   * A scout run (E8, concept §5.6): exploration only — no worktree, no
   * gate, no move; the report card in "Needs you" is its endpoint.
   * Absent = a ship run, like every record written before E8.
   */
  readonly form?: TicketForm;
  /**
   * A quiet interactive start (req-75): the worker was spawned WITHOUT
   * its composed brief — nothing runs until the owner's first message,
   * which wraps the brief once. Set at spawn, cleared on that first
   * send; absent on records written before it existed.
   */
  readonly quietStart?: true;
  /**
   * Whether the worker is in the middle of a turn (`busy`) or standing
   * and waiting for input (`idle`) — the board's "running or standing".
   * Absent while the provider has not said (and for providers that
   * cannot).
   */
  readonly turn?: 'busy' | 'idle';
  /** What the worker waits on the owner for (req-64); null/absent = nothing. */
  readonly waiting?: RunWaiting | null;
  /**
   * Working time already accumulated, in milliseconds — the busy spans
   * the runner closed (the turn went idle or a wait began). The elapsed
   * clocks (req-67) add the open span to it instead of running on the
   * wall clock, so waits for the owner and standing workers do not tick.
   * Absent on run.json records written before req-67 — readers fall back
   * to the wall clock since the start.
   */
  readonly execMs?: number;
  /**
   * When the run's open working span began (ISO); null while it stands.
   * Undefined (together with execMs) on pre-req-67 records; a run whose
   * provider reports no turn never carries either.
   */
  readonly execSince?: string | null;
  /**
   * The slash commands the worker accepts (names without the slash) — the
   * takeover tab's prompt box lists them. Absent until the worker reports.
   */
  readonly commands?: readonly string[];
  /** The working column whose pool owns this run (`request.column ?? request.phase`). */
  readonly column?: string | null;
  /** How many steer messages reached the worker, and how. */
  readonly steerCount: number;
  readonly lastSteerRung: SteerRung | null;
  readonly worktreePath: string;
  readonly branch: string;
  /** On every run started after T-0047; absent on adopted pre-T-0047 records. */
  readonly worktree?: WorktreeOutcome;
  /** The machine gate's verdict, once it ran (T-0048); absent when it never did. */
  readonly gateResult?: 'green' | 'red' | null;
  /** req-177: the slot (account) the run is bound to; absent on runs before slots or without one. */
  readonly slot?: { readonly id: string; readonly label: string };
  /** req-170: the pool's decision — the class asked for, the model that ran, its weight, why; absent on runs before the pool. */
  readonly grant?: PoolGrantRecord;
  /**
   * Why the worker declared the step incomplete (`BLOCKED:` in its final
   * message): no gate ran, nothing moved — the ticket waits for the
   * owner. Null/absent on every other end.
   */
  readonly blocked?: string | null;
  /** The worker's last error event (req-63: a rate limit shrinks the pool). */
  readonly lastError?: string | null;
  // --- token telemetry (T-0048); all optional so adopt() restores older
  // --- records — every reader treats absent as unknown.
  /** The model pin the run started with (`provider/model` or bare). */
  readonly model?: string | null;
  /** The phase the ticket sat in when the run started. */
  readonly phase?: string | null;
  /** Usage summed over the run's model calls; a null counter was never reported. */
  readonly usage?: RunUsage;
  /**
   * The input side (input + cacheRead + cacheCreation) of the LAST
   * assistant turn — the real context size, unlike the providers'
   * cumulative aggregates.
   */
  readonly lastTurnContext?: number | null;
  /** How many model calls reported usage. */
  readonly turns?: number;
  /**
   * The worker has been silent for a long while (the hang watchdog, M1b):
   * the board shows "looks stuck". Cleared by the next event; absent on
   * records written before the watchdog existed.
   */
  readonly stuck?: boolean;
  /**
   * The owner interrupted the worker's turn and has not continued it yet:
   * the board reads "Paused" with a Continue button instead of "Idle".
   * Cleared by the owner's next prompt or by handing the run back.
   */
  readonly paused?: boolean;
  /** Read/grep/glob tool calls — the exploration counter. */
  readonly readCalls?: number;
  /**
   * Input-side tokens over the turns before the first write/edit tool
   * call; the full input side when no write came; null without any usage.
   */
  readonly tokensBeforeFirstWrite?: number | null;
  /** Always 'fresh' in T-0048; the field exists for T-0049's handover modes. */
  readonly handoverMode?: HandoverMode;
  /**
   * The provider session this run resumed (T-0049) — taken from the
   * candidate record, never the init event (a forked id would lose the
   * lineage). Null on a fresh run and on a resume that fell back fresh.
   */
  readonly resumedFrom?: string | null;
  /** Who asked for this run (D-41); absent on records from before it. */
  readonly origin?: string;
  /** The last gate failure, when the machine gate stopped the run short. */
  readonly gateFailure: string | null;
}

export type RunState =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'done'
  | 'stopped'
  | 'failed'
  | /** the runner restarted while the worker lived on; unwatchable */ 'detached';

/** Which rung of the steer ladder a message took (ADR-0075). */
export type SteerRung = 'inject' | 'resume' | 'refused';

export interface RunListResponse {
  readonly runs: readonly RunInfo[];
}

export interface RunStartResponse {
  readonly ok: true;
  readonly run: RunInfo;
}

export interface RunErrorResponse {
  readonly ok: false;
  readonly error: string;
}

/** The runner's self-description on `<root>/runner.json` and `GET /health`. */
export interface RunnerDescriptor {
  readonly port: number;
  readonly token: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly version: number;
  /**
   * Build stamp of the entry script (its mtime at boot, ISO) — the
   * client's respawn signal when the file on disk has moved on.
   */
  readonly build?: string;
}

/** Which ticket-file stamps the runner performs itself (same semantics
 *  as Drey's board service: patch + one commit; ADR-0076 single-writer). */
export interface TicketEdit {
  readonly vaultPath: string;
  readonly relPath: string;
  readonly git: string;
}
