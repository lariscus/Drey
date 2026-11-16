/**
 * The tickets board service (ADR-0076 milestone 83; host-agnostic since
 * ADR-0088 E2a). Detects the tickets vault, assembles snapshots from
 * files and performs every mutation through the one single-writer queue.
 * All IO arrives injected: vault/config/log/announce through
 * {@link EngineHost}, the fleet runner through {@link FleetPort} — the
 * Drey plugin supplies both over its plugin context (main/engine-host.ts),
 * the standalone engine process (E2b) over plain fs.
 */
import type { ClassName } from '../contracts/capability-class';
import { randomBytes } from 'node:crypto';
import { promises as fsp, existsSync } from 'node:fs';
import * as path from 'node:path';
import { TICKETS_ARCHIVE_DIR, TICKET_ID_PATTERN, type BoardColumn, type BoardSnapshot, type RecentDone, PipelinePhase, ProjectRef, RepoCandidate, RepoRef, ReposListing, TicketCard, TicketForm, TicketPriority, TicketTrack } from '../contracts/tickets';
import { PROJECTS_DIR, ticketProject, type ProjectRecord } from '../contracts/projects';
import { parseProjects } from '../core/projects/project-record';
import { parseChanges, parseResult, planApprovedOf, storyOf, type ChangesReply } from '../contracts/changes';
import { type RefineReply, TicketReply, AttachmentReply, type DocumentSaveReply, type TicketDocumentLocation } from '../contracts/replies';
import { documentRelPath, idOfDocumentPath } from '../store/document-paths';
import type { DkHealth } from '../store/dk-health';
import { detailFromContent } from '../store/dricket-ticket-store';
import { assembleBoard, parseRepos, parsePipeline, reposFileText, reposProse } from '../core/ticket/ticket-board';
import { newTicketFileText, parseTicketFile, patchTicketFile, patchBlockedBy, patchChain, patchClass, patchForm, patchTrack, ticketPathParts, withLogLine } from '../core/ticket/ticket-files';
import { withPlanSection } from '../core/chapters/plan-section';
import { parsePlanChain } from '../core/ticket/plan-chain';
import { applyFlowOp, type FlowOp } from '../core/pipeline/flow-edit';
import { readStoreRef, withStoreRef } from '../core/pipeline/pipeline-store';
import { DEFAULT_REPOS_PROSE } from '../core/projects/repos-file';
import { STANDARD_FLOW_ID, type FlowReply, type FlowSaveReply, type FlowStepView, type FlowTarget, type FlowScope } from '../contracts/flow';
import { patchPipelineFlow } from '../core/pipeline/pipeline-flow-patch';
import { allowedAfter, type PersonaAllowedPatch } from '../contracts/persona-allowed';
import { DEFAULT_PIPELINE_TEXT, STANDARD_FLOW_LINE } from '../core/pipeline/pipeline-states';
import { parseChainItems, renderChainEntries, unreadableEntryMessage } from '../core/pipeline/chain-list';
import { validateChain } from '../core/pipeline/chain-validate';
import { flowPersonasOf, flowStepViews, lockedOfCard, partFlowSteps } from './flow-views';
import { deletePlanPart, movePlanPart, parsePlanParts, partChainEntries, withPlanParts, type PlanPart } from '../core/plan/plan-parts';
import { blockerOf, indicesToMint, lockedIndices, matchPartTickets, partStateOf, partTicketText, releaseLogText, startLineOf, type PartTicket } from '../core/plan/plan-release';
import type { PlanPartCard, PlanPartsEdit, PlanPartsReply, PlanReleaseReply, PlanReleaseScope } from '../contracts/plan-approval';
import type { ChainEntry } from '../contracts/chain';
import { refineTicket, revisionOf } from '../core/ticket/ticket-refine';
import { archivedEntriesOf } from '../core/ticket/done-listing';
import { blockedRefusal } from '../core/ticket/blocked';
import { runTransition, type TransitionIo } from '../core/pipeline/transition';
import { openStatusItems, type StatusLine, type StatusVerb } from '../core/pipeline/status-log';
import { commentViewsOf, renderStatusComment, slugStatusKey, statusLinesOfComments, type TicketCommentView } from '../core/pipeline/status-comment';
import { LEDGER_FILE, parseLedger, settledUsageByTicket, type LedgerWrite } from '../core/pipeline/ledger';
import { estimateFrom, type EstimateKey, type RunEstimate } from '../core/plan/estimate';
import { withReviewFeedback, type ReviewComment } from '../core/ticket/review-feedback';
import { parseVerlaufEntries, type VerlaufEntry } from '../core/chapters/history-chapter';
import { mergeWorktreeChanges, diffOfOutput, isSafeRepoPath, MAX_FILE_VIEW_BYTES, type TicketDiff, type TicketFileReply, type WorktreeFile } from '../core/git/worktree-changes';
import { planWorktreeRemoval } from '../core/git/worktree-removal';
import { TicketsGit, type RepoLocation } from '../core/git/tickets-git';
import { TicketStoreError } from '../ports/ticket-store';
import { checkoutOf, createDricketStore, groupByStage, isRemoteStore, readStoreSettings, UNCONFIGURED_STORE, type StoreListing, type StoreSettings } from '../store/store-settings';
import { archivedRecordFiles, assembleBoardFromRecords, recordToBoardFile } from '../store/store-board';
import { loadDialogPrompt } from './crew-prompts';
import { columnAfter } from '../core/pipeline/board-columns';
import { withChainAndCursor } from '../store/chain-move';
import { personaMoveOf } from './persona-board-moves';
import type { PersonaBoardMove } from '../contracts/persona-board';
import { runCursorOf } from '../fleet/runner/run-cursor';
import { MISSION_ENTRY_KEY, type MissionEntry } from './mission-entry-turns';
import { ownerAcceptOf, ownerSendBackOf, type OwnerChainContext } from './chain-owner-moves';
import { chainFinished } from '../core/pipeline/chain-placement';
import { cursorAfterGreen } from '../core/pipeline/chain-red-gate';
import { setDocumentField } from '../store/document-fields';
import { ACTIVE_STAGE, EDGE_STAGES, stageOfPhase } from '../core/pipeline/lifecycle-stages';
import { crewLookupOf, holderOf } from '../core/pipeline/chain-holder';
import { lanesOf, withPersonaBoard } from '../core/persona/persona-board';
import type { TicketDetail } from '../ports/ticket-store';
import { ARCHIVED_LABEL } from '../store/legacy-bridge';
import { StoreBoardSource, type LegacyWrite } from '../store/store-board-source';
import { isLifecycleStore, parseStoreStages } from '../store/store-stages';
import { defaultStorePathOf, initLifecycleStore } from '../store/fresh-store';
import type { StorePathChange } from '../store/store-path-report';
import { storeFooterLine } from '../store/store-footer';
import { type AttachmentCommand, RefineCommand } from '../core/ticket/commands';
import { nextImprovementId, parseImprovements, renderImprovements, type FrictionLine, type ImprovementDraft, type ImprovementProposal } from '../core/persona/improvements';
import { ownerLessonLine } from '../core/persona/memory-line';
import { JOURNAL_FILE } from '../core/persona/persona-journal';
import { journalFrictions } from '../core/persona/persona-journal-file';
import type { ImprovementDecision, PersonaImprovementsReply, PersonaMemoryReply } from '../contracts/remote-protocol';
import { isMap, isScalar, parseDocument } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';
import { composeRunRequest, type PersonaDispatch } from '../fleet/runner/request';
import { loadDisciplineTexts, type DisciplineTexts } from '../fleet/runner/discipline-texts';
import { deriveWorkerModel, personaLoader, resolvePersonaForTicket } from './persona-loader';
import { personaPatchError, withModelPatch } from './persona-patch';
import { readRepoInstructions, worktreeDiffStat } from '../fleet/telemetry/context-pack';
import { cleanWorktrees, listOrphans, removeWorktree, type CleanupReport } from '../fleet/worktrees/worktree-clean';
import { unlinkShared } from '../fleet/worktrees/worktrees';
import { legacyWorktreeBase, worktreeBaseFor, worktreePathFor, WORKTREES_DIR } from '../fleet/worktrees/worktree-home';
import { FinishedWorktrees } from '../fleet/worktrees/finished-worktrees';
import { GitWorktreeRemover } from '../fleet/worktrees/git-worktree-remover';
import { removeDoneWorktrees } from './finished-ticket-worktrees';
import { reservedIgnoreEntries, withIgnoreEntries } from './reserved-ignore';
import { dkTargetFor } from '../fleet/lease/dk-target';
import { type ChainConfig, type ChainStoreConfig, FleetCaps, FleetHandoverConfig, HandoverMode, InteractiveMode, PermissionMode, RunCursor, RunDkTarget, RunInfo, FleetPools } from '../fleet/protocol';
import { type EngineHost, type EngineVaultChangeEvent, EngineVault, FleetPort } from './host';
import { handoverFromConfig, handoverOverrideKeys } from './handover-config';
import type { EffectiveCrew } from '../fleet/chain/layered-config-resolver';
import { appendMemory, describeMemoryEntries, memoryPathFor, toggleMemoryPin } from './persona-store';
import { EMPTY_PERSONA_SETTINGS, HUMAN_PERSONA_ID, humanPersona, isAgentPersona, loadPersonaSkills, personaFileText, parsePersonaFile, personaRef, personaRunAllowedOf, PERSONAS_DIR, PERSONA_ROLES, type Persona, type PersonaSkill } from '../core/persona/persona';
import { crewOrderOf, inCrewOrder, withCrewOrder } from '../core/persona/crew-order';
import { personaRunSettingsOf } from '../core/persona/persona-settings';
import { settingsAfter, type PersonaSettingsPatch } from '../contracts/persona-settings-patch';
import { CREW_FILE } from '../contracts/crew-config';
import { scanRepoFolder } from './repos-scan';

const PIPELINE_PATH = 'tickets/_meta/pipeline.md';
const REPOS_PATH = 'tickets/_meta/repos.md';
const ATTACHMENTS_DIR = 'tickets/attachments';
/** Names a shape turn's repository read never opens: git internals, dependency folders, secrets. */
const REPO_READ_DENIED = /^(\.git|node_modules|\.env.*|\.ssh|.*\.(pem|key))$/i;
/** What a snapshot of a store that is not on the lifecycle stages says (req-307: the owner creates a new store). */
export const NOT_LIFECYCLE_STORE = 'the store is not on the lifecycle stages — create a new store';
const DEFAULT_REPOS = `---
repos: {}
---
${DEFAULT_REPOS_PROSE}`;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type BoardMutationResult =
  | { readonly ok: true; readonly warning?: string; readonly moved?: number; readonly path?: string; readonly runId?: string }
  | { readonly ok: false; readonly error: string };

/** The card of one ticket id, wherever it sits on the board; null when absent. */
function findOnBoard(snap: BoardSnapshot, id: string): TicketCard | null {
  for (const column of snap.columns) {
    const found = column.tickets.find((t) => t.id === id);
    if (found !== undefined) {
      return found;
    }
  }
  return null;
}

// --- the self-improvement loop's file seams (E6, concept §4.8) ---------

function improvementsPathFor(id: string): string {
  return `${PERSONAS_DIR}/${id}/improvements.md`;
}

/** req-169: the journal the aggregation reads (friction.md is retired and migrated into it). */
function journalPathFor(id: string): string {
  return `${PERSONAS_DIR}/${id}/${JOURNAL_FILE}`;
}

/** Today's date as the owner's memory line names it. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** One memory entry is always one line, bounded (the personaLearn shape). */
function oneMemoryLine(text: string): string {
  return text.trim().replace(/\s*\n\s*/g, ' ').slice(0, 500);
}

/** The readable refusal every persona-scoped method shares. */
/** The flow editor's frame (E10-5, req-266): the chain being edited and how much of it is locked. */
interface FlowFrame {
  /** The id the reply names: the ticket's, or {@link STANDARD_FLOW_ID}. */
  readonly ticketId: string;
  /** Null for the standard flow (E10-5b): no ticket file behind it. */
  readonly vault: EngineVault | null;
  readonly card: TicketCard | null;
  readonly text: string;
  readonly title: string;
  readonly scope: FlowScope;
  /** The chain in the file — a ticket or part that names none: the standard flow it would get. */
  readonly saved: readonly ChainEntry[];
  /** The standard flow (pipeline.md `flow:`), what a reset returns to. */
  readonly standard: readonly ChainEntry[];
  /** The leading positions no edit may touch (past entries and the current one). */
  readonly locked: number;
  readonly part: PlanPart | null;
  readonly readOnly: string | null;
}

function personaMissing(id: string): string {
  return `persona "${id}" does not exist — create tickets/_meta/personas/${id}/persona.md first`;
}

/**
 * The models.default decision's rewrite of persona.md: the yaml
 * doc-mutation discipline of `patchHeaderFields` — only
 * `models.default` changes, every other key, the pool/router and any
 * comment survive the round-trip untouched.
 */
function patchPersonaDefaultModel(text: string, model: string): string {
  const { yamlText, body, hadFence } = splitFrontmatter(text);
  if (!hadFence || yamlText === null) {
    throw new Error('persona.md has no frontmatter fence');
  }
  const modelId = model.trim();
  if (modelId === '') {
    throw new Error('the default model is empty');
  }
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    throw new Error('persona.md frontmatter does not parse');
  }
  const models = doc.get('models', true);
  if (isMap(models)) {
    const existing = models.get('default', true);
    if (isScalar(existing)) {
      existing.value = modelId; // in place — the line's comment and style survive
    } else {
      models.set('default', modelId);
    }
  } else if (models === undefined) {
    doc.set('models', { default: modelId });
  } else {
    throw new Error('persona.md models is not a map');
  }
  let out = doc.toString({ flowCollectionPadding: false, lineWidth: 0 });
  if (!out.endsWith('\n')) {
    out += '\n';
  }
  return `---\n${out}---\n${body}`;
}

/** The aggregator's input slice (E6): what the desk hands the LLM route. */
export interface ImprovementInput {
  readonly friction: readonly FrictionLine[];
  readonly lastAggregation: string | null;
  readonly settledRuns: number;
  /** The persona's current prompt.md — the aggregator edits it, never replaces it blind (req-280). */
  readonly prompt?: string | null;
}

/**
 * The E7 ledger sink (concept §3.3): the runner's event writer or a test
 * fake. Fire-and-forget — a failure never reaches the board mutation.
 */
export interface LedgerEvents {
  readonly ledger: (write: LedgerWrite) => void;
}

/** The optional construction extras (E7); the default keeps every existing call site. */
export interface BoardServiceOptions {
  /** The fleet ledger writes behind the board's lifecycle events; absent = silent no-op. */
  readonly events?: LedgerEvents;
  /**
   * req-173 (R13): the vault layer — `_meta/crew.md` resolved. Present (the engine), the default
   * worker, the permission mode, the caps, the handover thresholds and the default
   * persona come from it, never from a device's config; absent (older specs), the constructor's
   * values and the config keys stand.
   */
  readonly crew?: { effective(vault: EngineVault): Promise<EffectiveCrew> };
  /** req-256: "Initialize board" seeds the default crew through it, after the pipeline and the prompts; absent = no crew is seeded. */
  readonly crewSeeder?: { seed(vault: EngineVault): Promise<unknown> };
  /** req-277: `dk` missing, older than the bundled release or no git become board issues on dricket; absent = no check. */
  readonly dkHealth?: DkHealth;
  /** req-307: the dialog protocol an interactive run follows its persona's prompt with; absent = the shipped `prompts/crew/dialog.md`. */
  readonly dialogPrompt?: () => Promise<string>;
  /** req-292: where the human persona is created, its shipped picture is copied beside it; absent = no picture. */
  readonly avatars?: { copyShipped(vault: EngineVault, id: string): Promise<string | null> };
}

/** A dricket write that met a ticket changed in the meantime (dk exit 12): nothing was written, the caller asks the user. */
/** What `dk add` writes as the description of a ticket nobody has filled yet. */
const DK_EMPTY_DESCRIPTION = '(no description)';

export class TicketChangedError extends Error {
  constructor(id: string) {
    super(`${id} changed in the meantime — nothing was written. Reload it and edit again.`);
    this.name = 'TicketChangedError';
  }
}

export class EngineBoardService {
  private queueTail: Promise<unknown> = Promise.resolve();
  private readonly gitLocations = new Map<string, RepoLocation | null>();
  /** req-185: a finished ticket's worktrees go (branch kept, dirty ones kept). */
  private get finishedWorktrees(): FinishedWorktrees {
    return new FinishedWorktrees(new GitWorktreeRemover(this.git));
  }
  private emitDebounce: ReturnType<typeof setTimeout> | null = null;
  /** Who hears the debounced board change besides the renderer (the remote, req-66). */
  private readonly changeListeners = new Set<() => void>();
  private lastChainConfig: string | null = null;
  /** The dricket-backed board: its tickets are read and written through the store, never as vault files. */
  private readonly storeBoard: StoreBoardSource;
  /** The store settings as the last snapshot or {@link refreshStore} read them; {@link UNCONFIGURED_STORE} (an empty `dkStore`) before one. */
  private store: StoreSettings = UNCONFIGURED_STORE;
  /** E14-4b: the record each board mutation read (ticket id -> record), so its write carries the rev it was made on. Refreshed by every read inside the queue. */
  private readonly records = new Map<string, TicketDetail>();
  /** The commit steps Accept started on a store (ticket id -> run id), until their run settles; see {@link settleCommitSteps}. */
  private readonly commitSteps = new Map<string, string>();
  private settling: Promise<void> = Promise.resolve();
  /** req-279: the discipline texts, loaded once (see {@link disciplines}). */
  private disciplinesOnce: Promise<DisciplineTexts> | null = null;
  /** req-307: the dialog protocol (see {@link dialogPrompt}). */
  private dialogOnce: Promise<string> | null = null;
  /** req-173: the vault layer as the last snapshot resolved it; null before one (or without `options.crew`). */
  private crew: EffectiveCrew | null = null;

  constructor(
    /** The host ports: every Drey/Electron affordance the service needs (ADR-0088, E2a). */
    private readonly host: EngineHost,
    private readonly git: TicketsGit,
    private defaultWorker: string,
    private autoPermissionMode: PermissionMode,
    private readonly gitPath: string,
    private readonly fleet: FleetPort,
    /** The fleet root — the worktrees the context pack stats live there. */
    private readonly fleetRoot: string,
    /** The instruction output caps (T-0048), resolved once at activation. */
    private caps: FleetCaps,
    /** The per-provider pools (req-63), resolved once at activation. */
    private readonly pools: FleetPools,
    /** The handover thresholds (T-0049) — refreshed from the config with
     *  every snapshot (the override keys follow the board's pins). */
    private handover: FleetHandoverConfig,
    /** The acting owner (`owner@host`) — injected by the host. */
    private readonly owner: string,
    /** The optional extras (E7 ledger writes); `{}` keeps the service event-free. */
    private readonly options: BoardServiceOptions = {},
  ) {
    this.storeBoard = new StoreBoardSource((message, level) => host.log(message, level), createDricketStore, {
      // E14-4: the store's own writes, its file watcher and the remote sync round announce a changed board.
      onChange: () => this.announceChanged(),
      // D-28: the checkout's files Drey shows, whoever changed them.
      ...(host.announceStoreChanges === undefined
        ? {}
        : { onPaths: (change: StorePathChange) => host.announceStoreChanges?.(change.checkout, change.changed, change.deleted) }),
    });
  }

  /** The board's emit, debounced — one push per burst of changes. */
  announceChanged(): void {
    if (this.emitDebounce !== null) {
      return;
    }
    this.emitDebounce = setTimeout(() => {
      this.emitDebounce = null;
      this.host.emitBoardChanged();
      for (const listener of this.changeListeners) {
        listener();
      }
    }, 200);
  }

  /** Stops the store's file watcher and sync round (the engine is shutting down). */
  dispose(): void {
    this.storeBoard.dispose();
  }

  /** After {@link dispose}: resolves when the store's background processes ended (see `StoreBoardSource.idle`). */
  idle(): Promise<void> {
    return Promise.all([this.storeBoard.idle(), this.settling]).then(() => undefined);
  }

  /** req-279: the discipline texts of the composed briefs (`prompts/disciplines/`), loaded once from the shipped files. */
  private disciplines(): Promise<DisciplineTexts> {
    this.disciplinesOnce ??= loadDisciplineTexts();
    return this.disciplinesOnce;
  }

  onChanged(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private async readOptional(vaultId: string, path: string): Promise<string | null> {
    try {
      return await this.host.read(vaultId, path);
    } catch {
      return null;
    }
  }

  /** These vault files with their texts, in the order given. */
  private readFiles(vault: EngineVault, paths: readonly string[]): Promise<{ path: string; text: string }[]> {
    return Promise.all(paths.map(async (path) => ({ path, text: await this.host.read(vault.id, path) })));
  }

  /** A registered, existing vault containing the pipeline marker file. */
  async detect(): Promise<EngineVault | null> {
    const vault = await this.probeVaults();
    // The plugin-managed flag follows detection both ways (SDK 1.32,
    // ADR-0082): while a board lives in a vault, that vault's free-form
    // git history is refused — one transition is one structured commit.
    this.host.markManaged(vault === null ? null : vault.id);
    return vault;
  }

  private async probeVaults(): Promise<EngineVault | null> {
    const vaults = await this.host.listVaults();
    const candidates = vaults.filter((v) => v.exists);
    const configured = await this.host.configGet<string>('vaultId');
    const ordered = configured === undefined ? candidates : [
      ...candidates.filter((v) => v.id === configured),
      ...candidates.filter((v) => v.id !== configured),
    ];
    for (const vault of ordered) {
      if (await this.readOptional(vault.id, PIPELINE_PATH) !== null) {
        return vault;
      }
    }
    return null;
  }

  private async locate(vaultPath: string): Promise<RepoLocation | null> {
    if (!this.gitLocations.has(vaultPath)) {
      this.gitLocations.set(vaultPath, await this.git.locate(vaultPath));
    }
    return this.gitLocations.get(vaultPath) ?? null;
  }

  /** The board from the store — every fetch rebuilds (no stored board state). */
  async snapshot(): Promise<BoardSnapshot> {
    // A settled commit step lands in Done with the next read of the board (every client re-reads on a fleet change).
    if (this.commitSteps.size > 0) {
      this.settling = this.settling.then(() => this.settleCommitSteps()).catch((error: unknown) => this.host.log(`commit step: ${messageOf(error)}`, 'warn'));
    }
    const [vault, vaults] = await Promise.all([
      this.detect(),
      this.host.listVaults(),
    ]);
    const active = vaults.find((v) => v.active) ?? null;
    if (vault === null) {
      await this.syncChainConfig(null);
      return assembleBoard({
        vaultId: null,
        vaultName: null,
        activeVaultName: active?.name ?? null,
        isGitRepo: false,
        defaultWorker: this.defaultWorker,
        pipelineText: null,
        reposText: null,
        files: [],
      });
    }
    const [pipelineText, reposText, mdFiles, location, ledgerText] = await Promise.all([
      this.readOptional(vault.id, PIPELINE_PATH),
      this.readOptional(vault.id, REPOS_PATH),
      this.host.listMarkdownFiles(vault.id),
      this.locate(vault.path),
      this.readOptional(vault.id, LEDGER_FILE),
    ]);
    await this.applyCrew(vault);
    const common = {
      vaultId: vault.id,
      vaultName: vault.name,
      activeVaultName: active?.name ?? null,
      isGitRepo: location !== null,
      defaultWorker: this.defaultWorker,
      pipelineText,
      reposText,
      // req-282: the project records beside repos.md.
      projectFiles: await this.readFiles(vault, mdFiles.filter((p) => p.startsWith(`${PROJECTS_DIR}/`))),
      // The settled runs' usage (concept §4.3): one vault-file read, the
      // pure assembly only attaches the sums to the matching cards.
      ticketUsage: settledUsageByTicket(parseLedger(ledgerText ?? '')),
    };
    // The TICKETS come from the store; the pipeline, repos and ledger stay in this vault.
    const store = await this.refreshStore(vault);
    const snapshot = await this.storeSnapshot(store, vault, common, { mdFiles });
    // The chain follows the board: a persona board points the runner at this vault (M85,
    // req-257). Cheap and idempotent — the runner re-reads the vault on every dispatch pass anyway.
    await this.refreshHandover(snapshot);
    await this.syncChainConfig(vault, snapshot.lanes !== undefined);
    // The vault's absolute path (the Settings page's header); absent without a vault.
    return { ...snapshot, vaultPath: vault.path };
  }

  /**
   * req-307: the board is the persona board of a dricket store on the lifecycle stages — nothing else.
   * A configured store on other stages is no mode any more: an empty board that says so (a new store
   * is created, nothing is migrated); an unconfigured one keeps its own error.
   */
  private async storeSnapshot(store: StoreSettings, vault: EngineVault, common: Parameters<StoreBoardSource['board']>[1], files: { readonly mdFiles: readonly string[] }): Promise<BoardSnapshot> {
    if (store.dkStore === '') {
      return this.dricketSnapshot(store, common);
    }
    if (!isLifecycleStore(await this.storeBoard.stages(store).catch(() => null))) {
      const empty = assembleBoardFromRecords({ ...common, records: [] });
      return { ...empty, isGitRepo: true, issues: [{ level: 'error', message: NOT_LIFECYCLE_STORE }, ...empty.issues] };
    }
    return this.personaBoardOf(vault, files, await this.dricketSnapshot(store, common));
  }

  /** req-270: the board of a lifecycle store is a persona board — the crew's lanes and every active card's hold. */
  private async personaBoardOf(vault: EngineVault, files: { readonly mdFiles: readonly string[] }, board: BoardSnapshot): Promise<BoardSnapshot> {
    const crew = await this.crewInOrder(vault, files.mdFiles);
    return withPersonaBoard(board, lanesOf(crew), crewLookupOf(new Map(crew.map((p) => [p.id, p.kind]))));
  }

  /** The dricket board: the store is itself a git repository, so the footer names the store, not the vault's repository state (D-9). */
  private async dricketSnapshot(store: StoreSettings, common: Parameters<StoreBoardSource['board']>[1]): Promise<BoardSnapshot> {
    const board = await this.storeBoard.board(store, common);
    const health = (await this.options.dkHealth?.issues(store.dkPath === '' ? 'dk' : store.dkPath)) ?? [];
    return { ...board, isGitRepo: true, storeLine: await storeFooterLine(store), issues: [...health, ...board.issues] };
  }

  /**
   * The read-only listing from the dricket store (E14-1, ADR-0090): `dk` is
   * shelled out to. Never throws — a missing `dk` or a misconfigured store
   * comes back as `{ ok: false, error }`. Not the board: columns here are the
   * store's stages; the board over `TicketRecord[]` is E14-2.
   */
  async storeListing(): Promise<StoreListing> {
    const settings = await readStoreSettings(this.host.configGet.bind(this.host));
    try {
      if (settings.dkStore === '') {
        return { ok: false, error: 'no dricket store configured (tickets.dk.store)' };
      }
      const store = createDricketStore(settings);
      const [records, capabilities] = await Promise.all([store.list(), store.capabilities()]);
      return { ok: true, version: capabilities.version, columns: groupByStage(records) };
    } catch (error) {
      return { ok: false, error: error instanceof TicketStoreError || error instanceof Error ? error.message : String(error) };
    }
  }

  /** req-173: the vault layer's values take the place of the constructor's (one resolve per snapshot). */
  private async applyCrew(vault: EngineVault): Promise<void> {
    const crew = (await this.options.crew?.effective(vault).catch((error: unknown) => (this.host.log(`crew.md: ${messageOf(error)}`, 'warn'), null))) ?? null;
    if (crew !== null) {
      this.crew = crew;
      this.defaultWorker = crew.defaultWorker;
      this.autoPermissionMode = crew.permissionMode;
      this.caps = crew.caps;
    }
  }

  /** req-257: the crew's persona kinds from the vault's listing — what places a chain ticket by its holder. */
  private async crewKinds(vault: EngineVault, mdFiles: readonly string[]): Promise<ReadonlyMap<string, Persona['kind']>> {
    const loader = this.personaLoaderFor(vault);
    const kinds = new Map<string, Persona['kind']>();
    for (const file of mdFiles) {
      const match = /^tickets\/_meta\/personas\/([a-z0-9][a-z0-9-]{0,63})\/persona\.md$/.exec(file);
      const persona = match === null ? null : await loader.load(match[1]!);
      if (persona !== null) {
        kinds.set(persona.id, persona.kind);
      }
    }
    return kinds;
  }

  /** The default persona: the vault layer's (req-173), else the legacy config key. */
  private defaultPersonaOf(): Promise<string | null> {
    return Promise.resolve(null); // req-257: the crew's default persona (and the legacy `personas.default`) retired — never used
  }

  /** Re-reads the handover thresholds with the board's override keys (T-0049); the vault layer's once there is one (req-173). */
  private async refreshHandover(snap: BoardSnapshot): Promise<void> {
    if (this.crew !== null) {
      this.handover = this.crew.handover;
      return;
    }
    this.handover = await handoverFromConfig(
      this.host.configGet.bind(this.host),
      handoverOverrideKeys(snap, this.defaultWorker),
    );
  }

  /**
   * Why the chain may not be switched on, or null. The chain reads its tickets from the
   * store's checkout (E14-5b), so it needs one: an explicit `tickets.dk.checkout`, or a
   * local `tickets.dk.store` directory. A remote store without a checkout would leave the
   * runner one `dk` call per ticket; that is refused.
   */
  async chainRefusal(): Promise<string | null> {
    const store = await this.refreshStore((await this.detect()) ?? undefined);
    if (store.dkStore === '') {
      return 'The chain needs the dricket store (tickets.dk.store)';
    }
    return checkoutOf(store) === null
      ? 'The chain reads the store from its checkout: set tickets.dk.checkout (a remote store has none yet)'
      : null;
  }

  /**
   * "Release leftover claims" (E14-5b (4)): a runner that was killed with a run in flight leaves its
   * `agent-<run>@<host>` claim on the ticket until the lease ends. The runner releases every agent
   * claim of this host that no live run holds - back to where the ticket sat, else one stage back.
   */
  async releaseLeftoverClaims(): Promise<{ readonly ok: true; readonly released: readonly string[]; readonly skipped: readonly { readonly id: string; readonly reason: string }[] } | { readonly ok: false; readonly error: string }> {
    const store = await this.refreshStore((await this.detect()) ?? undefined);
    try {
      if (this.fleet.releaseLeftoverClaims === undefined) {
        return { ok: false, error: 'this fleet port cannot release claims' };
      }
      return await this.fleet.releaseLeftoverClaims(await this.chainStoreOf(store));
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  /** The store the chain and the leftover release hand to the runner process. */
  private async chainStoreOf(store: StoreSettings): Promise<ChainStoreConfig> {
    const trailers = await this.host.configGet<boolean | string>('dk.trailers');
    return {
      dkPath: store.dkPath,
      dkStore: store.dkStore,
      dkDataDir: store.dkDataDir,
      dkCheckout: store.dkCheckout,
      trailers: trailers === true || trailers === 'true',
    };
  }

  /**
   * Keeps the runner's chain config in step with the board (never spawns). A persona board
   * (`personaBoard`, a lifecycle store) is configured whatever its pipeline holds: the pipeline is
   * Inbox, Prioritized and Done only, no agent column, and the chain walks by the holders (req-78
   * found it: a restarted runner was never pointed at the vault).
   */
  private async syncChainConfig(vault: { readonly path: string } | null, personaBoard = false): Promise<ChainConfig | null> {
    const store = this.store;
    if (store.dkStore === '' || checkoutOf(store) === null) {
      return null; // the dispatcher reads the store's checkout (E14-5b): without one there is nothing to point it at
    }
    const defaultPersona = await this.defaultPersonaOf();
    const chain: ChainConfig | null =
      vault !== null && personaBoard
        ? {
            ticketsVaultPath: vault.path,
            store: await this.chainStoreOf(store),
            git: this.gitPath.trim() === '' ? 'git' : this.gitPath.trim(),
            defaultWorker: this.defaultWorker,
            defaultPersona,
            permissionMode: this.autoPermissionMode,
            caps: this.caps,
            pools: this.pools,
            handover: this.handover,
          }
        : null;
    const json = chain === null ? null : JSON.stringify(chain);
    if (json === this.lastChainConfig) {
      return chain;
    }
    this.lastChainConfig = json;
    if (chain !== null) {
      // No runner reachable (the Autopilot's first switch-on starts it later): forget the sent state, so the
      // next snapshot sends the config again — it is the same text, and would otherwise never be re-sent.
      void this.fleet.configureChain(chain).then((sent) => {
        if (sent === false && this.lastChainConfig === json) {
          this.lastChainConfig = null;
        }
      });
    }
    return chain;
  }

  /** Find a card anywhere on the board. */
  private async findCard(id: string): Promise<{ vault: EngineVault; card: TicketCard; text: string } | null> {
    const vault = await this.detect();
    if (vault === null) {
      return null;
    }
    const snap = await this.snapshot();
    for (const column of snap.columns) {
      const card = column.tickets.find((t) => t.id === id);
      if (card !== undefined) {
        return { vault, card, text: await this.readCardText(card) };
      }
    }
    return null;
  }

  /**
   * A ticket that left the board's columns -- accepted into the archive (E13-21): the
   * store record that carries the `archived` label. Read-only: it opens like any ticket,
   * only its moves are off.
   */
  private async findArchived(id: string): Promise<{ vault: EngineVault; card: TicketCard; text: string } | null> {
    const vault = await this.detect();
    if (vault === null || !TICKET_ID_PATTERN.test(id)) {
      return null;
    }
    const path = `${TICKETS_ARCHIVE_DIR}/${id}.md`;
    let text: string;
    try {
      const record = await this.storeBoard.record(this.store, id);
      if (!record.labels.includes(ARCHIVED_LABEL)) {
        return null;
      }
      text = recordToBoardFile(record, 'archive').text;
    } catch {
      return null;
    }
    const parsed = parseTicketFile(text, path);
    const card: TicketCard = { id, path, phase: 'archive', meta: parsed.meta, worker: this.defaultWorker, blocked: [], blocks: [], issues: parsed.issues };
    return { vault, card, text };
  }

  /**
   * The archive's tickets of any age (E13-21 "Show older"), newest first, narrowed by
   * `query` (id or title words): the store's archived records.
   * The Work panel and Mission Control list them behind "Show older".
   */
  async archivedTickets(input: { query?: string; limit?: number } = {}): Promise<{ ok: true; tickets: readonly RecentDone[] } | { ok: false; error: string }> {
    try {
      const vault = await this.detect();
      if (vault === null) {
        return { ok: true, tickets: [] };
      }
      const store = await this.refreshStore(vault);
      const files = archivedRecordFiles(await this.storeBoard.records(store));
      return { ok: true, tickets: archivedEntriesOf(files, { query: input.query, limit: input.limit }) };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  /** One ticket's card and file text, for the remote's ticket view (req-66). */
  async readTicket(id: string): Promise<TicketReply> {
    const found = (await this.findCard(id)) ?? (await this.findArchived(id));
    if (found === null) {
      return { ok: false, error: `${id} is not on the board` };
    }
    return {
      ok: true,
      card: found.card,
      text: found.text,
      revision: revisionOf(found.text),
      comments: await this.commentsOf(this.store, id),
    };
  }

  /**
   * One ticket by id for the chat (D-7a): a card on the board, else an archived
   * ticket — an accepted ticket leaves the board (the `archived` label) and
   * `readTicket` knows no card for it. Text and comments only: an archived ticket has no card to show.
   */
  async readAnyTicket(id: string): Promise<{ readonly ok: true; readonly text: string; readonly comments?: readonly TicketCommentView[] } | { readonly ok: false; readonly error: string }> {
    const onBoard = await this.readTicket(id);
    if (onBoard.ok) {
      return { ok: true, text: onBoard.text, ...(onBoard.comments === undefined ? {} : { comments: onBoard.comments }) };
    }
    const vault = await this.detect();
    if (vault === null) {
      return onBoard;
    }
    try {
      const record = await this.storeBoard.record(this.store, id);
      return { ok: true, text: recordToBoardFile(record, record.stage).text, comments: await this.commentsOf(this.store, id) };
    } catch {
      return onBoard; // the store does not know the id either: the honest "not on the board"
    }
  }

  /** The ticket's comments read from the store's `comments/` files, oldest first (E14-6). */
  async ticketComments(id: string): Promise<readonly TicketCommentView[]> {
    return this.commentsOf(await this.refreshStore((await this.detect()) ?? undefined), id);
  }

  /** A comment-read failure is an empty thread, never a failed ticket view. */
  private async commentsOf(store: StoreSettings, id: string): Promise<readonly TicketCommentView[]> {
    try {
      return commentViewsOf(await this.storeBoard.comments(store, id));
    } catch (error) {
      this.host.log(`tickets: comments of ${id} could not be read: ${messageOf(error)}`, 'warn');
      return [];
    }
  }

  /**
   * One status event of a ticket (E14-6): a keyed comment (`dk comment`;
   * `working` is never persisted, a keyless `resolved` closes nothing). A failure
   * is a log line, never a failed mutation (the same contract as the ledger).
   */
  private async noteStatus(card: TicketCard, verb: StatusVerb, input: { key?: string | null; text?: string; detail?: string }, actor: string): Promise<void> {
    const text = renderStatusComment({ verb, ...input });
    if (text === null) {
      return;
    }
    try {
      await this.storeBoard.comment(this.store, card.id, text, actor);
    } catch (error) {
      this.host.log(`tickets: the ${verb} comment on ${card.id} could not be written: ${messageOf(error)}`, 'warn');
    }
  }

  /**
   * The E7 status read (concept §3.3): the verbs are the first lines of the
   * ticket's comments (E14-6), newest last. An absent ticket reads as no lines.
   */
  async statusOf(id: string): Promise<readonly StatusLine[]> {
    const found = await this.findCard(id);
    if (found === null) {
      return [];
    }
    try {
      return statusLinesOfComments(await this.storeBoard.comments(this.store, id));
    } catch {
      return [];
    }
  }

  /**
   * The remote's refine (req-66 R5): sections and header fields of one
   * ticket, refused when the file changed since the device read it or a
   * run owns it. One commit; a Drey tab showing the file reloads when
   * clean and meets the save-conflict merge when dirty (ADR-0060).
   */
  refineTicket(input: RefineCommand & { actor?: string }): Promise<RefineReply> {
    return this.enqueue(async () => {
      const found = await this.findCard(input.id);
      if (found === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const { card, text } = found;
      if (revisionOf(text) !== input.baseRevision) {
        return { ok: false, conflict: true, error: 'The ticket changed since you opened it. Reload it and edit again.' };
      }
      if (card.meta.run !== null) {
        return { ok: false, error: 'A run is live on this ticket. Refine it when the run has ended.' };
      }
      // The header's priority field validates against the vault's vocabulary.
      const snap = await this.snapshot();
      let refined: string;
      try {
        refined = refineTicket(text, { sections: input.sections, header: input.header }, input.actor ?? this.owner, new Date(), snap.priorities);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      try {
        await this.writeCardText(card, refined);
      } catch (error) {
        return error instanceof TicketChangedError
          ? { ok: false, conflict: true, error: error.message }
          : { ok: false, error: `write failed: ${messageOf(error)}` };
      }
      this.announceChanged();
      return { ok: true, revision: revisionOf(refined) };
    });
  }

  /**
   * The raw-text save behind the phone edit mode (concept §5.5): the
   * exception path, not the everyday one — same conflict discipline as
   * refine (baseRevision stale → conflict, never a silent overwrite),
   * same one-commit rule. The text must still parse as a ticket file,
   * so a stray keystroke can never break the parsers downstream.
   */
  saveTicket(input: { id: string; text: string; baseRevision?: string; actor?: string }): Promise<RefineReply> {
    return this.enqueue(async () => {
      const found = await this.findCard(input.id);
      if (found === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const { card, text } = found;
      if (input.baseRevision !== undefined && revisionOf(text) !== input.baseRevision) {
        return { ok: false, conflict: true, error: 'The ticket changed since you opened it. Reload it and edit again.' };
      }
      if (card.meta.run !== null) {
        return { ok: false, error: 'A run is live on this ticket. Edit it when the run has ended.' };
      }
      // The text is read with the vault's priority vocabulary, so an
      // unknown id is judged against what the board actually accepts.
      const snap = await this.snapshot();
      try {
        const parsed = parseTicketFile(input.text, card.path, snap.priorities);
        if (parsed.issues.some((issue) => issue.level === 'error')) {
          return { ok: false, error: `the text is not a valid ticket file: ${parsed.issues.find((i) => i.level === 'error')!.message}` };
        }
      } catch (error) {
        return { ok: false, error: `the text does not parse: ${messageOf(error)}` };
      }
      try {
        await this.writeCardText(card, input.text);
      } catch (error) {
        return error instanceof TicketChangedError
          ? { ok: false, conflict: true, error: error.message }
          : { ok: false, error: `write failed: ${messageOf(error)}` };
      }
      this.announceChanged();
      return { ok: true, revision: revisionOf(input.text) };
    });
  }

  /**
   * The proof card's diff (concept §5.3): the worktree branch against
   * its base, one capped unified diff. No worktree/no repo → an empty
   * diff (the card shows the Changes section alone, honestly).
   */
  /**
   * The run estimate for a (gate, persona, model) triple from the owner's
   * own history (E11-4): the `## Verlauf` lines of every ticket under
   * `tickets/`, archive included. Null below three matching runs.
   */
  async estimateOf(key: EstimateKey): Promise<RunEstimate | null> {
    const vault = await this.detect();
    if (vault === null) {
      return null;
    }
    const history: VerlaufEntry[] = [];
    for (const file of await this.host.listMarkdownFiles(vault.id)) {
      if (!file.startsWith('tickets/') || file.startsWith('tickets/_meta/')) {
        continue;
      }
      try {
        history.push(...parseVerlaufEntries(await this.host.read(vault.id, file)));
      } catch {
        // An unreadable file adds nothing to the history.
      }
    }
    return estimateFrom(history, key);
  }

  /** A ticket's file on its branch (`git show HEAD:<path>`), for the diff's "Whole file" view. */
  async ticketFile(id: string, filePath: string): Promise<TicketFileReply> {
    if (!isSafeRepoPath(filePath)) {
      return { ok: false, error: 'not a path inside the repository' };
    }
    const where = await this.diffWorktree(id);
    if (where === null) {
      return { ok: false, error: `${id} has no worktree to read from` };
    }
    try {
      const output = await this.git.run(where.worktreePath, ['show', `HEAD:${filePath}`]);
      const truncated = Buffer.byteLength(output, 'utf8') > MAX_FILE_VIEW_BYTES;
      return { ok: true, text: truncated ? output.slice(0, MAX_FILE_VIEW_BYTES) : output, truncated };
    } catch {
      return { ok: false, error: `${filePath} is not on the ticket branch` };
    }
  }

  async ticketDiff(id: string): Promise<TicketDiff> {
    const where = await this.diffWorktree(id);
    if (where === null) {
      return { files: [], truncated: false };
    }
    try {
      const output = await this.git.run(where.worktreePath, ['diff', '--unified=3', `${where.base}...HEAD`]);
      return diffOfOutput(output);
    } catch {
      return { files: [], truncated: false };
    }
  }

  /** The ticket's worktree and the base its diff runs against; null when there is none yet. */
  private async diffWorktree(id: string): Promise<{ worktreePath: string; base: string } | null> {
    const vault = await this.detect();
    if (vault === null) {
      return null;
    }
    const snap = await this.snapshot();
    let card: TicketCard | null = null;
    for (const column of snap.columns) {
      const found = column.tickets.find((t) => t.id === id);
      if (found !== undefined) {
        card = found;
        break;
      }
    }
    const repoName = card !== null && card.meta.repo !== null ? card.meta.repo : null;
    const repo = repoName === null ? null : snap.repos.find((r) => r.name === repoName) ?? null;
    if (card === null || repo === null || repo.path === null) {
      return null;
    }
    const record = this.newestRecordFor(await this.fleetRecords(), card.id);
    const worktreePath = record !== null ? record.worktreePath : worktreePathFor(vault.path, repo, card.id);
    return existsSync(worktreePath) ? { worktreePath, base: repo.branch ?? 'main' } : null;
  }

  /**
   * The Work panel's priority chip (req-75 W1): the refine rewrite of the
   * one header key, so the commit and the Log line are a refine's
   * (`tickets: <id> refined`, `refined (priority)`). No revision check —
   * the owner clicked on what the board shows; a live run refuses like
   * every refine.
   */
  setPriority(input: { id: string; priority: TicketPriority; actor?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const found = await this.findCard(input.id);
      if (found === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const { card, text } = found;
      // The vocabulary is the vault's (`priorities:` in pipeline.md) — an
      // id outside it refuses through the patcher's guard.
      const snap = await this.snapshot();
      if (card.meta.priority === input.priority) {
        return { ok: true };
      }
      if (card.meta.run !== null) {
        return { ok: false, error: 'A run is live on this ticket. Change the priority when the run has ended.' };
      }
      let refined: string;
      try {
        refined = refineTicket(text, { sections: {}, header: { priority: input.priority } }, input.actor ?? this.owner, new Date(), snap.priorities);
        await this.writeCardText(card, refined);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      this.announceChanged();
      return { ok: true };
    });
  }

  /**
   * The triage track (req-75 W1b, ADR-0087 decision 2): the row menu's
   * Track › pick — one header rewrite, one Log line, one commit
   * `tickets: <id> track <value>`. A live run refuses like every
   * header edit.
   */
  setTrack(input: { id: string; track: TicketTrack | null; actor?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const found = await this.findCard(input.id);
      if (found === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const { card, text } = found;
      if (card.meta.track === input.track) {
        return { ok: true };
      }
      if (card.meta.run !== null) {
        return { ok: false, error: 'A run is live on this ticket. Change the track when the run has ended.' };
      }
      let patched: string;
      try {
        patched = patchTrack(text, input.track, new Date(), input.actor ?? this.owner);
        await this.writeCardText(card, patched);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      this.announceChanged();
      return { ok: true };
    });
  }

  /**
   * The card's class control (req-186): one header rewrite of the ticket's
   * `class:` pin (`patchClass`), one Log line, one commit
   * `tickets: <id> class <value>`. A live run refuses like every header edit.
   */
  setClass(input: { id: string; class: ClassName | null; actor?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const found = await this.findCard(input.id);
      if (found === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const { card, text } = found;
      if ((card.meta.class ?? null) === input.class) {
        return { ok: true };
      }
      if (card.meta.run !== null) {
        return { ok: false, error: 'A run is live on this ticket. Change the class when the run has ended.' };
      }
      try {
        await this.writeCardText(card, patchClass(text, input.class, new Date(), input.actor ?? this.owner));
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      this.announceChanged();
      return { ok: true };
    });
  }

  /**
   * The ticket form (concept §5.6): the scout → ship promotion's board
   * half — one header rewrite (`patchForm`), one Log line, one commit
   * `tickets: <id> form <value>`. Setting what the file already carries
   * is a no-op success; a live run refuses like every header edit.
   */
  setForm(input: { id: string; form: TicketForm; actor?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const found = await this.findCard(input.id);
      if (found === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const { card, text } = found;
      if ((card.meta.form ?? 'ship') === input.form) {
        return { ok: true };
      }
      if (card.meta.run !== null) {
        return { ok: false, error: 'A run is live on this ticket. Change the form when the run has ended.' };
      }
      let patched: string;
      try {
        patched = patchForm(text, input.form, new Date(), input.actor ?? this.owner);
        await this.writeCardText(card, patched);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      this.announceChanged();
      return { ok: true };
    });
  }

  /**
   * The shared plan (E10-3, concept v2 §5.8): replaces the ticket's
   * `## Plan` chapter — and nothing else of the file — with the shape
   * turn's text. One commit `tickets: <id> plan`. A live run refuses; an
   * unchanged plan is a no-op success. req-266: a `### Chain` in the plan
   * becomes the ticket's `chain:` in the same write when it holds
   * (`validateChain`); one that does not leaves the chain and says why.
   */
  setPlan(input: { id: string; plan: string; actor?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const found = await this.findCard(input.id);
      if (found === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const { card, text } = found;
      if (card.meta.run !== null) {
        return { ok: false, error: 'A run is live on this ticket. Change the plan when the run has ended.' };
      }
      const planned = withPlanSection(text, input.plan);
      const chained = await this.withPlanChain(card, planned, input.actor ?? this.owner);
      const patched = chained.text;
      if (patched === text.replace(/\r\n/g, '\n')) {
        return chained.refusal === null ? { ok: true } : { ok: true, warning: chained.refusal };
      }
      try {
        await this.writeCardText(card, patched);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      this.announceChanged();
      return chained.refusal === null ? { ok: true } : { ok: true, warning: `The plan's chain was not taken: ${chained.refusal}` };
    });
  }

  /** req-266: the plan's `### Chain` applied to the ticket text when it holds and differs. */
  private async withPlanChain(card: TicketCard, text: string, actor: string): Promise<{ readonly text: string; readonly changed: boolean; readonly refusal: string | null }> {
    const plan = parsePlanChain(text);
    if (plan.kind === 'none') {
      return { text, changed: false, refusal: null };
    }
    if (plan.kind === 'unreadable') {
      return { text, changed: false, refusal: plan.error };
    }
    const current = card.meta.chain ?? [];
    const canonical = renderChainEntries(plan.entries);
    if (renderChainEntries(current).join('\n') === canonical.join('\n')) {
      return { text, changed: false, refusal: null };
    }
    const snap = await this.snapshot();
    const refusal = validateChain(plan.entries, { ...(await this.chainGuardIds()), saved: current, locked: lockedOfCard(snap, card, current) });
    return refusal === null ? { text: patchChain(text, canonical, new Date(), actor), changed: true, refusal: null } : { text, changed: false, refusal };
  }

  /**
   * A shape turn's read-only look into the ticket's repository (E10-3):
   * a file's text (cut at the view cap) or, for a path ending in `/` (or
   * empty), the directory's entries. Only the ticket's own repo, only
   * inside it; `.git`, dependency folders and secret files stay shut.
   */
  async readRepoFile(
    id: string,
    relPath: string,
  ): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string }> {
    const found = await this.findCard(id);
    if (found === null) {
      return { ok: false, error: `${id} is not on the board` };
    }
    const snap = await this.snapshot();
    const repoName = found.card.meta.repo ?? found.card.meta.repos[0] ?? null;
    const repo = repoName === null ? null : snap.repos.find((r) => r.name === repoName) ?? null;
    if (repo === null || repo.path === null) {
      return { ok: false, error: `${id} names no repository with a local path` };
    }
    const isDir = relPath === '' || relPath === '.' || relPath.endsWith('/');
    const clean = relPath === '' || relPath === '.' ? '' : relPath.replace(/\/+$/, '');
    if (clean !== '' && !isSafeRepoPath(clean)) {
      return { ok: false, error: `"${relPath}" is not a path inside the repository` };
    }
    const segments = clean === '' ? [] : clean.split('/');
    if (segments.some((s) => REPO_READ_DENIED.test(s))) {
      return { ok: false, error: `"${relPath}" is not readable` };
    }
    const abs = path.join(repo.path, ...segments);
    try {
      if (isDir) {
        const entries = await fsp.readdir(abs, { withFileTypes: true });
        const names = entries
          .filter((e) => !REPO_READ_DENIED.test(e.name))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
          .slice(0, 200);
        return { ok: true, text: names.join('\n') };
      }
      const buffer = await fsp.readFile(abs);
      if (buffer.includes(0)) {
        return { ok: false, error: `"${relPath}" is a binary file` };
      }
      const cut = buffer.length > MAX_FILE_VIEW_BYTES;
      return { ok: true, text: `${buffer.subarray(0, MAX_FILE_VIEW_BYTES).toString('utf8')}${cut ? '\n… (cut)' : ''}` };
    } catch {
      return { ok: false, error: `"${relPath}" does not exist` };
    }
  }

  /**
   * The chain (req-266): the chat's setChain execution — the whole persona
   * list, each entry in the grammar, every persona known, no position at
   * or before the cursor changed (`validateChain`); an empty list is the
   * standard flow. Then one header rewrite (`patchChain`), one Log line,
   * one commit `tickets: <id> chain <entries>`. An unchanged chain is a
   * no-op success; a live run refuses like every header edit.
   */
  setChain(input: { id: string; chain: readonly string[]; actor?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const found = await this.findCard(input.id);
      if (found === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const { card, text } = found;
      const snap = await this.snapshot();
      const parsed = parseChainItems(input.chain);
      if (!parsed.ok) {
        return { ok: false, error: unreadableEntryMessage(parsed.bad) };
      }
      const entries = parsed.entries.length === 0 ? (snap.flow ?? []) : parsed.entries;
      const current = card.meta.chain ?? [];
      const refusal = validateChain(entries, { ...(await this.chainGuardIds()), saved: current, locked: lockedOfCard(snap, card, current) });
      if (refusal !== null) {
        return { ok: false, error: refusal };
      }
      const canonical = renderChainEntries(entries);
      if (renderChainEntries(current).join('\n') === canonical.join('\n')) {
        return { ok: true };
      }
      if (card.meta.run !== null) {
        return { ok: false, error: 'A run is live on this ticket. Change the chain when the run has ended.' };
      }
      let patched: string;
      try {
        patched = patchChain(text, canonical, new Date(), input.actor ?? this.owner);
        await this.writeCardText(card, patched);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      this.announceChanged();
      return { ok: true };
    });
  }

  /**
   * The dependency list (T-0050): the chat's setBlockedBy execution — the
   * whole `blocked-by:` list is replaced (an empty list clears it, the
   * key leaves the file), one header rewrite (`patchBlockedBy`), one Log
   * line, one commit `tickets: <id> blocked-by <n ids|none>`. An
   * unchanged list is a no-op success; a live run refuses like every
   * header edit. The ids carry the ticket grammar (checked here and in
   * the patcher); whether an id resolves on the board stays the
   * dependency pass's business — an unknown id is written and simply
   * never blocks (the pass's tolerance, never a guess).
   */
  setBlockedBy(input: { id: string; blockedBy: readonly string[]; actor?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const found = await this.findCard(input.id);
      if (found === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const { card, text } = found;
      for (const id of input.blockedBy) {
        if (!TICKET_ID_PATTERN.test(id)) {
          return { ok: false, error: `blocked-by: "${id}" is not a ticket id` };
        }
      }
      const current = card.meta.blockedBy;
      if (current.length === input.blockedBy.length && input.blockedBy.every((id, i) => id === current[i])) {
        return { ok: true };
      }
      if (card.meta.run !== null) {
        return { ok: false, error: 'A run is live on this ticket. Change the blockers when the run has ended.' };
      }
      let patched: string;
      try {
        patched = patchBlockedBy(text, input.blockedBy, new Date(), input.actor ?? this.owner);
        await this.writeCardText(card, patched);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      this.announceChanged();
      return { ok: true };
    });
  }

  // --- the plan to accept (E10-4, concept v2 §5.9) ----------------------------

  /** The build queue's phase: the queue after Inbox (Prioritized on the persona board), else the first. */
  private buildPhaseOf(snap: BoardSnapshot): PipelinePhase | null {
    return snap.pipeline[1] ?? snap.pipeline[0] ?? null;
  }

  /** The tickets that name `parentId` as their parent, as the matcher reads them. */
  private childrenOf(snap: BoardSnapshot, parentId: string): PartTicket[] {
    return snap.columns.flatMap((column) =>
      column.tickets
        .filter((t) => t.meta.parent === parentId)
        .map((t) => ({ id: t.id, title: t.meta.title ?? t.id, phase: column.phase.id, running: t.meta.run !== null })),
    );
  }

  /**
   * The cards of a ticket's plan to accept: its `### Parts` with the
   * ticket each part became (by title among the tickets that name this
   * one as `parent:`), the state and the lock that follows, each part's
   * flow from the build gate on, and the personas the picker offers. A
   * read — nothing is written, nothing normalized.
   */
  async planParts(id: string): Promise<PlanPartsReply> {
    const found = await this.findCard(id);
    if (found === null) {
      return { ok: false, error: `${id} is not on the board` };
    }
    const snap = await this.snapshot();
    const build = this.buildPhaseOf(snap);
    if (build === null) {
      return { ok: false, error: snap.pipelineError ?? 'the pipeline is empty' };
    }
    const parsed = parsePlanParts(found.text);
    const matches = matchPartTickets(parsed.parts, this.childrenOf(snap, id));
    const terminal = snap.pipeline[snap.pipeline.length - 1]!.id;
    const buildAt = snap.pipeline.findIndex((p) => p.id === build.id);
    const queue = new Set(snap.pipeline.slice(0, buildAt + 1).map((p) => p.id));
    const personas = await this.listPersonas();
    const defaultPersona = await this.defaultPersonaOf();
    const parts: PlanPartCard[] = parsed.parts.map((part, index) => {
      const own = matches[index] ?? null;
      const entries = partChainEntries(part);
      return {
        index,
        title: part.title,
        reason: part.reason,
        persona: part.persona,
        chain: part.chain,
        flow: partFlowSteps(entries.length > 0 ? entries : (snap.flow ?? []), personas),
        ticket: own?.id ?? null,
        state: partStateOf(own, queue, terminal),
        phase: own?.phase ?? null,
        locked: own !== null,
        start: startLineOf(index, matches),
      };
    });
    return {
      ok: true,
      ticket: id,
      title: found.card.meta.title ?? id,
      parts,
      gate: build.id,
      defaultPersona,
      personas: personas.map((p) => ({
        id: p.id,
        title: p.title,
        role: isAgentPersona(p) ? p.role : '',
        color: p.color,
        model: isAgentPersona(p) ? (deriveWorkerModel(p).model ?? '') : '',
      })),
      warnings: parsed.warnings,
    };
  }

  /**
   * The owner's edit on the card list — a persona pick, a move, a delete —
   * written as the new `### Parts` chapter of the parent's Plan. A part
   * that is a ticket already refuses (and nothing may move above one);
   * the list never drops below two parts (that is "Keep as one ticket",
   * a decision of its own). One commit `tickets: <id> parts`.
   */
  editPlanParts(input: { id: string; edit: PlanPartsEdit; actor?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const found = await this.findCard(input.id);
      if (found === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const { card, text } = found;
      if (card.meta.run !== null) {
        return { ok: false, error: 'A run is live on this ticket. Change the parts when the run has ended.' };
      }
      const snap = await this.snapshot();
      const parts = parsePlanParts(text).parts;
      if (parts.length < 2) {
        return { ok: false, error: 'This plan has no parts to change.' };
      }
      const locked = lockedIndices(matchPartTickets(parts, this.childrenOf(snap, input.id)));
      const edit = input.edit;
      let next: readonly PlanPart[];
      if (edit.op === 'move') {
        const moved = movePlanPart(parts, edit.from, edit.to, locked);
        if (!moved.ok) {
          return { ok: false, error: moved.error };
        }
        next = moved.parts;
      } else if (edit.op === 'delete') {
        const deleted = deletePlanPart(parts, edit.index, locked);
        if (!deleted.ok) {
          return { ok: false, error: deleted.error };
        }
        if (deleted.parts.length < 2) {
          return { ok: false, error: 'A split needs two parts. Keep the plan as one ticket instead.' };
        }
        next = deleted.parts;
      } else {
        const target = parts[edit.index];
        if (target === undefined) {
          return { ok: false, error: 'no such part position' };
        }
        if (locked.has(edit.index)) {
          return { ok: false, error: `"${target.title}" is released as a ticket — its persona changes there` };
        }
        if (edit.persona !== null && !(await this.listPersonaIds()).includes(edit.persona)) {
          return { ok: false, error: personaMissing(edit.persona) };
        }
        next = parts.map((part, i) => (i === edit.index ? { ...part, persona: edit.persona } : part));
      }
      const patched = withPlanParts(text, next);
      if (patched === text.replace(/\r\n/g, '\n')) {
        return { ok: true };
      }
      try {
        await this.writeCardText(card, patched);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      this.announceChanged();
      return { ok: true };
    });
  }

  /**
   * The flow editor's frame (E10-5, req-266): which chain, how much of it
   * is locked, and whether it may change at all. The ticket scope is the
   * card's own `chain:` (a ticket without one shows the standard flow it
   * would get); the part scope is one part's `chain:` line in the parent's
   * `### Parts` (none = the standard flow), nothing locked.
   */
  private async flowFrame(target: FlowTarget): Promise<FlowFrame | { readonly error: string }> {
    if (target.id === STANDARD_FLOW_ID) {
      return this.standardFlowFrame(target);
    }
    const found = await this.findCard(target.id);
    if (found === null) {
      return { error: `${target.id} is not on the board` };
    }
    const { vault, card, text } = found;
    const snap = await this.snapshot();
    const standard = snap.flow ?? [];
    const title = card.meta.title ?? target.id;
    if (target.part === null) {
      const own = card.meta.chain ?? [];
      const saved = own.length > 0 ? own : standard;
      return {
        ticketId: target.id,
        vault,
        card,
        text,
        title,
        scope: { kind: 'ticket' },
        saved,
        standard,
        locked: lockedOfCard(snap, card, saved),
        part: null,
        readOnly: card.meta.run !== null ? 'A run is live on this ticket. Change the flow when the run has ended.' : null,
      };
    }
    const parts = parsePlanParts(text).parts;
    const part = parts[target.part];
    if (part === undefined || parts.length < 2) {
      return { error: 'no such part in this plan' };
    }
    const released = lockedIndices(matchPartTickets(parts, this.childrenOf(snap, target.id))).has(target.part);
    const own = partChainEntries(part);
    return {
      ticketId: target.id,
      vault,
      card,
      text,
      title,
      scope: { kind: 'part', index: target.part, title: part.title },
      saved: own.length > 0 ? own : standard,
      standard,
      locked: 0,
      part,
      readOnly: released ? `"${part.title}" is released as a ticket — change its flow on that ticket.` : null,
    };
  }

  /** E10-5b: the standard flow as a frame — pipeline.md's `flow:`, nothing locked, no ticket file behind it. */
  private async standardFlowFrame(target: FlowTarget): Promise<FlowFrame | { readonly error: string }> {
    if (target.part !== null) {
      return { error: 'the standard flow has no parts' };
    }
    const standard = (await this.snapshot()).flow ?? [];
    return { ticketId: STANDARD_FLOW_ID, vault: null, card: null, text: '', title: 'Default flow', scope: { kind: 'standard' }, saved: standard, standard, locked: 0, part: null, readOnly: null };
  }

  /** A flow frame's chain as the editor shows it: the positions from the current one on, with the crew. */
  private async flowReply(frame: FlowFrame, entries: readonly ChainEntry[]): Promise<FlowReply> {
    await this.ensureHumanPersona();
    const personas = await this.listPersonas();
    return {
      ok: true,
      ticket: frame.ticketId,
      title: frame.title,
      scope: frame.scope,
      chain: renderChainEntries(entries),
      saved: renderChainEntries(frame.saved),
      steps: flowStepViews(entries, frame.locked, personas, frame.readOnly !== null),
      personas: flowPersonasOf(personas),
      readOnly: frame.readOnly,
    };
  }

  /** A draft's entries, each in the grammar and the whole holding against the frame (`validateChain`). */
  private async flowEntriesOf(chain: readonly string[], frame: FlowFrame): Promise<readonly ChainEntry[] | { readonly error: string }> {
    const parsed = parseChainItems(chain);
    if (!parsed.ok) {
      return { error: unreadableEntryMessage(parsed.bad) };
    }
    const refusal = validateChain(parsed.entries, { ...(await this.chainGuardIds()), saved: frame.saved, locked: frame.locked });
    return refusal === null ? parsed.entries : { error: refusal };
  }

  /** The flow as the file holds it (E10-5). */
  async flowOf(target: FlowTarget): Promise<FlowReply> {
    const frame = await this.flowFrame(target);
    return 'error' in frame ? { ok: false, error: frame.error } : this.flowReply(frame, frame.saved);
  }

  /**
   * One edit on a draft chain (E10-5): the draft arrives, the edited draft
   * returns — nothing is written. `view` re-reads a draft (Paul's).
   */
  async flowEdit(input: FlowTarget & { chain: readonly string[]; edit: FlowOp }): Promise<FlowReply> {
    const frame = await this.flowFrame(input);
    if ('error' in frame) {
      return { ok: false, error: frame.error };
    }
    const entries = await this.flowEntriesOf(input.chain, frame);
    if ('error' in entries) {
      return { ok: false, error: entries.error };
    }
    if (frame.readOnly !== null && input.edit.op !== 'view') {
      return { ok: false, error: frame.readOnly };
    }
    const context = { ...(await this.chainGuardIds()), saved: frame.saved, locked: frame.locked, standard: frame.standard };
    const edited = applyFlowOp(entries, input.edit, context);
    if (!edited.ok) {
      return { ok: false, error: edited.error };
    }
    return this.flowReply(frame, edited.entries);
  }

  /**
   * "Save flow" (E10-5): the draft becomes the ticket's `chain:` (the
   * setChain write: one header rewrite, one Log line, one commit) or one
   * part's `chain:` in the parent's plan (one commit
   * `tickets: <id> part <n> flow`). A part that is a ticket already, a
   * live run and a chain that does not hold refuse.
   */
  async saveFlow(input: FlowTarget & { chain: readonly string[]; actor?: string }): Promise<FlowSaveReply> {
    if (input.id === STANDARD_FLOW_ID) {
      return input.part === null ? this.setStandardFlow({ chain: input.chain }) : { ok: false, error: 'the standard flow has no parts' };
    }
    if (input.part === null) {
      return this.setChain({ id: input.id, chain: input.chain, ...(input.actor === undefined ? {} : { actor: input.actor }) });
    }
    const partIndex = input.part;
    return this.enqueue(async (): Promise<FlowSaveReply> => {
      const frame = await this.flowFrame(input);
      if ('error' in frame) {
        return { ok: false, error: frame.error };
      }
      if (frame.readOnly !== null) {
        return { ok: false, error: frame.readOnly };
      }
      if (frame.vault === null || frame.card === null) {
        return { ok: false, error: 'the standard flow has no parts' };
      }
      const entries = await this.flowEntriesOf(input.chain, frame);
      if ('error' in entries) {
        return { ok: false, error: entries.error };
      }
      const canonical = renderChainEntries(entries);
      const parts = parsePlanParts(frame.text).parts;
      const next = parts.map((part, i) => (i === partIndex ? { ...part, chain: canonical } : part));
      const patched = withPlanParts(frame.text, next);
      if (patched === frame.text.replace(/\r\n/g, '\n')) {
        return { ok: true };
      }
      try {
        await this.writeCardText(frame.card, patched);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      this.announceChanged();
      return { ok: true };
    });
  }

  /**
   * E10-5b: the standard flow and the proposal switch in `_meta/pipeline.md` (the settings page's
   * default flow): `chain` replaces `flow:` (checked like every chain write; an empty list removes
   * the key — a new ticket then carries no chain), `proposeFlow` sets `propose-flow:`. Existing tickets
   * keep their own chains. One commit `tickets: default flow` / `tickets: propose flow on|off`.
   */
  setStandardFlow(input: { chain?: readonly string[]; proposeFlow?: boolean }): Promise<FlowSaveReply> {
    return this.enqueue(async (): Promise<FlowSaveReply> => {
      const vault = await this.detect();
      const text = vault === null ? null : await this.readOptional(vault.id, PIPELINE_PATH);
      if (vault === null || text === null) {
        return { ok: false, error: 'tickets/_meta/pipeline.md is missing' };
      }
      let canonical: readonly string[] | undefined;
      if (input.chain !== undefined) {
        const parsed = parseChainItems(input.chain);
        if (!parsed.ok) {
          return { ok: false, error: unreadableEntryMessage(parsed.bad) };
        }
        const refusal = parsed.entries.length === 0 ? null : validateChain(parsed.entries, { ...(await this.chainGuardIds()), saved: [], locked: 0 });
        if (refusal !== null) {
          return { ok: false, error: refusal };
        }
        canonical = renderChainEntries(parsed.entries);
      }
      let patched: string;
      try {
        patched = patchPipelineFlow(text, { ...(canonical === undefined ? {} : { flow: canonical }), ...(input.proposeFlow === undefined ? {} : { proposeFlow: input.proposeFlow }) });
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      if (patched === text.replace(/\r\n/g, '\n')) {
        return { ok: true };
      }
      try {
        await this.host.write(vault.id, PIPELINE_PATH, patched);
      } catch (error) {
        return { ok: false, error: `write failed: ${messageOf(error)}` };
      }
      const what = canonical !== undefined ? 'default flow' : `propose flow ${input.proposeFlow === true ? 'on' : 'off'}`;
      const warning = await this.commit(vault, [PIPELINE_PATH], `tickets: ${what}`);
      this.host.announceChanges(vault.id, [PIPELINE_PATH]);
      this.announceChanged();
      return { ok: true, ...(warning === null ? {} : { warning }) };
    });
  }

  /**
   * The approval (E10-4): every part of the plan that is not a ticket yet
   * — or only the first such part — becomes its own ticket in the build
   * queue: `parent:` the plan's ticket, the builder's `persona:` pin, the
   * part's own `chain:` delta, `blocked-by:` the part before it (so part
   * 2 waits until part 1 reaches the terminal phase). Everything is
   * checked first and written part by part (see {@link releaseInStore});
   * the parent gets one Log line and keeps the plan.
   */
  releasePlan(input: { id: string; scope: PlanReleaseScope; actor?: string }): Promise<PlanReleaseReply> {
    return this.enqueue(async () => {
      const found = await this.findCard(input.id);
      if (found === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const { card, text } = found;
      const snap = await this.snapshot();
      const build = this.buildPhaseOf(snap);
      if (build === null || snap.pipeline.length < 2) {
        return { ok: false, error: snap.pipelineError ?? 'the pipeline has no build queue' };
      }
      const parts = parsePlanParts(text).parts;
      if (parts.length < 2) {
        return { ok: false, error: 'This plan has no parts to release.' };
      }
      const matches = matchPartTickets(parts, this.childrenOf(snap, input.id));
      const store = this.store;
      // A released part whose ticket is still the empty stub `dk add` made (a release that
      // broke between add and put) is filled by the next approval: that is the resume.
      const stubs: number[] = [];
      for (let i = 0; i < matches.length; i += 1) {
        const match = matches[i];
        if (match !== null && match !== undefined && (await this.storeBoard.record(store, match.id)).body.includes(DK_EMPTY_DESCRIPTION)) {
          stubs.push(i);
        }
      }
      const mint = [...new Set([...stubs, ...indicesToMint(matches, input.scope)])].sort((a, b) => a - b);
      if (mint.length === 0) {
        return { ok: false, error: 'Every part is released already.' };
      }
      const personaIds = await this.listPersonaIds();
      const guardIds = await this.chainGuardIds();
      for (const index of mint) {
        const part = parts[index]!;
        if (part.persona !== null && !personaIds.includes(part.persona)) {
          return { ok: false, error: `Part ${index + 1}: ${personaMissing(part.persona)}` };
        }
        const own = partChainEntries(part);
        const refusal = own.length === 0 ? null : validateChain(own, { ...guardIds, saved: [], locked: 0 });
        if (refusal !== null) {
          return { ok: false, error: `Part ${index + 1}: ${refusal}` };
        }
      }
      return this.releaseInStore(store, { card, text }, snap, build, parts, matches, mint, input);
    });
  }

  /**
   * The approval on dricket (E14-4b): children first, parent last, resumable. Each
   * part is `dk add` (title, parent, depends — a complete linked stub) plus one
   * `put` of the part ticket; the parent's Log line is the last write. A failure
   * stops there and names what exists; approving again matches the existing
   * children by title, fills a stub left empty and mints only the rest.
   */
  private async releaseInStore(
    store: StoreSettings,
    found: { card: TicketCard; text: string },
    snap: BoardSnapshot,
    build: PipelinePhase,
    parts: readonly PlanPart[],
    matches: readonly (PartTicket | null)[],
    mint: readonly number[],
    input: { id: string; actor?: string },
  ): Promise<PlanReleaseReply> {
    const { card, text } = found;
    const ids = new Map<number, string>();
    matches.forEach((m, i) => {
      if (m !== null) {
        ids.set(i, m.id);
      }
    });
    const now = new Date();
    const actor = input.actor ?? this.owner;
    const done: string[] = [];
    try {
      for (const index of mint) {
        const part = parts[index]!;
        const blocker = blockerOf(index, ids);
        let id = ids.get(index) ?? null;
        if (id === null) {
          id = (
            await this.storeBoard.add(store, {
              title: part.title,
              priority: card.meta.priority,
              kind: 'human',
              parent: input.id,
              ...(blocker === null ? {} : { dependsOn: [blocker] }),
            })
          ).id;
          ids.set(index, id);
        }
        const body = partTicketText({
          id,
          parentId: input.id,
          parentTitle: card.meta.title ?? input.id,
          part,
          index,
          total: parts.length,
          repo: card.meta.repo,
          repos: card.meta.repos,
          priority: card.meta.priority,
          priorities: snap.priorities,
          firstPhase: snap.pipeline[0]!.id,
          phase: build.id,
          blockedBy: blocker,
          now,
          actor,
          standard: renderChainEntries(snap.flow ?? []),
        });
        await this.putRecord(store, await this.storeBoard.record(store, id), body, { phase: build.id });
        done.push(id);
      }
      await this.writeCardText(card, withLogLine(text, now, actor, releaseLogText(done)));
    } catch (error) {
      this.announceChanged();
      const so = done.length === 0 ? '' : ` Released so far: ${done.join(', ')}.`;
      return { ok: false, error: `release stopped: ${messageOf(error)}.${so} Accept again to continue — the parts that exist are kept.` };
    }
    this.announceChanged();
    return { ok: true, tickets: done };
  }

  /**
   * An image a paired device pasted or picked (req-66 R8): written under
   * the reserved `tickets/attachments/` folder, exactly one commit. No
   * Log line — the Log lives in ticket files and no ticket file is
   * touched (Capture uploads before a ticket exists); the audit is the
   * router's `remote <device>: attachment` line and the commit itself.
   */
  saveAttachment(input: AttachmentCommand & { actor?: string }): Promise<AttachmentReply> {
    return this.enqueue(async () => {
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      const dir = this.host.resolveAssetPath(vault.id, ATTACHMENTS_DIR);
      if (dir === null) {
        return { ok: false, error: 'the attachments folder is not reachable' };
      }
      await fsp.mkdir(dir, { recursive: true });
      const now = new Date();
      const p = (n: number): string => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
      let name = `img-${stamp}-${randomBytes(2).toString('hex')}.${input.ext}`;
      for (;;) {
        try {
          await fsp.writeFile(path.join(dir, name), input.bytes, { flag: 'wx' });
          break;
        } catch (error) {
          if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST') {
            name = `img-${stamp}-${randomBytes(2).toString('hex')}.${input.ext}`;
            continue;
          }
          return { ok: false, error: `write failed: ${messageOf(error)}` };
        }
      }
      const file = `${ATTACHMENTS_DIR}/${name}`;
      const warning = await this.commit(vault, [file], `tickets: attachment ${name}`);
      this.host.announceChanges(vault.id, [file]);
      return { ok: true, file, ...(warning === null ? {} : { warning }) };
    });
  }

  /** The `board` IPC route: the snapshot (the store owns its layout, there is no drift to normalize). */
  async refresh(): Promise<BoardSnapshot> {
    return this.snapshot();
  }

  /** Serialize mutations; failures never block the next one. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queueTail.catch(() => undefined).then(op);
    this.queueTail = next;
    return next;
  }

  // --- ticket documents of a dricket store in the editor (E14-4c, ADR-0090) -----

  /**
   * Where the ticket's document is: the store's checkout and the checkout-relative path
   * (`tickets/<prefix>/<shard>/<id>/ticket.md`). Null without a checkout and for a ticket
   * the store does not have.
   */
  /** The checkout the board reads (req-316): the project's pipeline names it, the default stays beside the vault. Null: remote without a checkout. */
  async storeCheckout(): Promise<{ checkout: string | null }> {
    return { checkout: checkoutOf(await this.refreshStore((await this.detect()) ?? undefined)) };
  }

  async ticketDocument(input: { id: string }): Promise<TicketDocumentLocation | null> {
    const store = await this.refreshStore((await this.detect()) ?? undefined);
    const checkout = checkoutOf(store);
    const relPath = documentRelPath(input.id);
    if (checkout === null || relPath === null) {
      return null;
    }
    try {
      await this.storeBoard.record(store, input.id);
    } catch {
      return null;
    }
    return { checkout, path: relPath };
  }

  /**
   * The editor's save of a ticket document (E14-4c): the tab's text goes back through
   * `dk put --claim --if-version <rev>` — never as a file. `rev` is the one the tab read,
   * taken from the text itself; `force` (the save-conflict merge was resolved against the
   * stored document) puts on the rev the store has now. Exit 12 is a `conflict` reply with
   * the document as stored, nothing written; dk judges the document, a refusal comes back
   * as `error` with dk's own message.
   */
  saveDocument(input: { path: string; text: string; force?: boolean }): Promise<DocumentSaveReply> {
    return this.enqueue(async () => {
      const store = await this.refreshStore((await this.detect()) ?? undefined);
      const id = idOfDocumentPath(input.path);
      if (id === null) {
        return { ok: false, error: `${input.path} is not a ticket document.` };
      }
      try {
        const current = await this.storeBoard.record(store, id);
        const expectedRev = input.force === true ? current.rev : detailFromContent(input.text).rev;
        if (expectedRev === null) {
          return { ok: false, error: 'The document has no rev: it cannot be saved. Reload the ticket.' };
        }
        const outcome = await this.storeBoard.write(store, id, input.text, { expectedRev });
        if (!outcome.ok) {
          return { ok: false, conflict: { text: outcome.conflict.current.text, rev: outcome.conflict.current.rev } };
        }
        const saved = await this.storeBoard.record(store, id);
        this.announceChanged();
        return { ok: true, text: saved.text, rev: saved.rev ?? outcome.result.rev };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    });
  }

  // --- the ticket write door (E14-4b, ADR-0090) ---------------------------------
  // A card is a store record folded into the legacy shape: the text patchers run on
  // it, and the result goes back through `dk put --claim --if-version <rev>`
  // (legacy-bridge). Exit 12 means the ticket moved on: nothing was written, the
  // user is told and re-reads.

  /** The card's file text: the store record folded into the legacy shape. */
  private async readCardText(card: TicketCard): Promise<string> {
    const record = await this.storeBoard.record(this.store, card.id);
    this.records.set(card.id, record);
    return recordToBoardFile(record, card.phase).text;
  }

  /** Writes the patched card text; a changed-in-the-meantime ticket (dk exit 12) throws {@link TicketChangedError}. */
  private async writeCardText(card: TicketCard, text: string): Promise<void> {
    const record = this.records.get(card.id) ?? (await this.storeBoard.record(this.store, card.id));
    // A header edit keeps the stage (and the column pin) the document has; only a move changes it.
    await this.putRecord(this.store, record, text, { keepStage: true });
    this.records.delete(card.id);
  }

  private async putRecord(store: StoreSettings, record: TicketDetail, legacyText: string, target: LegacyWrite): Promise<void> {
    const outcome = await this.storeBoard.writeLegacy(store, record, legacyText, target);
    if (!outcome.ok) {
      throw new TicketChangedError(record.id);
    }
  }

  /**
   * Re-reads the store settings from the config (the settings may have
   * changed since the last snapshot). With a vault, the store belongs to
   * the project (req-316): its pipeline.md names it (`store:`), the
   * default stays beside the repository, and the machine-wide `dk.store`
   * setting is the override for projects that name none — the first read
   * moves it into the pipeline, where it belongs to this project alone.
   */
  private async refreshStore(vault?: EngineVault | null): Promise<StoreSettings> {
    const settings = await readStoreSettings(this.host.configGet.bind(this.host));
    if (vault === undefined || vault === null) {
      this.store = settings;
      return settings;
    }
    const ref = readStoreRef(await this.readOptional(vault.id, PIPELINE_PATH));
    if (ref !== null) {
      this.store = { ...settings, dkStore: ref };
      return this.store;
    }
    if (settings.dkStore !== '') {
      await this.writeStoreRef(vault, settings.dkStore).catch((error: unknown) =>
        this.host.log(`the store reference migration failed: ${messageOf(error)}`, 'warn'),
      );
      this.store = settings;
      return this.store;
    }
    this.store = { ...settings, dkStore: defaultStorePathOf(vault.path) };
    return this.store;
  }

  /** Anchors `store` in the project's pipeline (req-316, once — a second call is a no-op). */
  private async writeStoreRef(vault: EngineVault, store: string): Promise<void> {
    const pipelineText = await this.readOptional(vault.id, PIPELINE_PATH);
    if (pipelineText === null || readStoreRef(pipelineText) !== null) {
      return;
    }
    try {
      await this.host.write(vault.id, PIPELINE_PATH, withStoreRef(pipelineText, store));
      await this.commit(vault, [PIPELINE_PATH], 'tickets: the store reference moves into the pipeline');
      this.host.announceChanges(vault.id, [PIPELINE_PATH]);
    } catch (error) {
      this.host.log(`anchoring the store reference failed: ${messageOf(error)}`, 'warn');
    }
  }

  /**
   * Where a run of this board claims its ticket (E14-5): the store and whether it has a
   * `blocked` stage to park in. Trailers are opt-in (`tickets.dk.trailers`).
   */
  private async runTarget(store: StoreSettings, pipeline: readonly PipelinePhase[]): Promise<RunDkTarget> {
    return dkTargetFor(await this.chainStoreOf(store), pipeline);
  }

  /** A human's claim takeover / release on a dricket ticket: `dk claim` / `dk release`, dk decides (E14-5). */
  private async setClaimInStore(
    store: StoreSettings,
    input: { id: string; mode: 'takeover' | 'release'; actor?: string },
  ): Promise<BoardMutationResult> {
    const found = await this.findCard(input.id);
    if (found === null) {
      return { ok: false, error: `${input.id} is not on the board` };
    }
    const actor = input.actor ?? this.owner;
    try {
      if (input.mode === 'takeover') {
        await this.storeBoard.claim(store, input.id, { actor, kind: 'human', size: 'S' });
      } else {
        await this.storeBoard.release(store, input.id, { actor, stage: stageOfPhase(found.card.phase) });
      }
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
    this.announceChanged();
    return { ok: true };
  }

  /**
   * The transition machine's IO over the store: one `put` is the whole move. `read` folds the record, `write` is the
   * `put` with the target stage; the archive is stage `terminal` + the `archived`
   * label, an unarchive removes it.
   */
  private dricketTransitionIo(store: StoreSettings, terminal: string): TransitionIo {
    const idOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '');
    const inArchive = (p: string): boolean => p.startsWith(`${TICKETS_ARCHIVE_DIR}/`);
    return {
      read: async (p) => {
        const record = await this.storeBoard.record(store, idOf(p));
        if (inArchive(p) && !record.labels.includes(ARCHIVED_LABEL)) {
          throw new Error(`${record.id} is not archived`);
        }
        this.records.set(record.id, record);
        return recordToBoardFile(record, ticketPathParts(p)?.phase ?? terminal).text;
      },
      write: async (p, text) => {
        const id = idOf(p);
        const phase = inArchive(p) ? terminal : ticketPathParts(p)?.phase;
        await this.putRecord(store, this.records.get(id) ?? (await this.storeBoard.record(store, id)), text, phase === undefined ? { keepStage: true } : { phase, archived: inArchive(p) });
        this.records.delete(id);
      },
      announce: () => this.announceChanged(),
    };
  }

  /** The IO of a board move over the store (the terminal phase is where an archived ticket stays). */
  private moveIo(_vault: EngineVault, snap: BoardSnapshot): TransitionIo {
    return this.dricketTransitionIo(this.store, snap.pipeline[snap.pipeline.length - 1]?.id ?? 'done');
  }

  /**
   * req-257: the chain entry an owner-started run of `card` works — the cursor and,
   * when the entry is an agent's, its persona; null for a chainless ticket.
   */
  private async chainRunOf(vault: EngineVault, snap: BoardSnapshot, card: TicketCard): Promise<{ readonly persona: string | null; readonly cursor: RunCursor } | null> {
    const chain = card.meta.chain;
    if (chain === undefined || chain.length === 0) {
      return null;
    }
    const lookup = crewLookupOf(await this.crewKinds(vault, await this.host.listMarkdownFiles(vault.id)));
    const loop = { ...(card.meta.returnTo !== undefined ? { returnTo: card.meta.returnTo } : {}), ...(card.meta.redBacks !== undefined ? { redBacks: card.meta.redBacks } : {}) }; // req-78
    const cursor = runCursorOf({ chain, at: card.meta.at, sentBack: card.meta.sentBack, crew: await this.chainGuardIds(), redLoop: loop, proposeFlow: snap.proposeFlow === true });
    const persona = lookup(chain[cursor.at - 1]!.persona);
    return { persona: persona?.kind === 'agent' ? persona.id : null, cursor };
  }

  /** req-257: what the owner's chain moves read — the terminal column and the crew's kinds. */
  private async ownerChainContext(vault: EngineVault, snap: BoardSnapshot): Promise<OwnerChainContext> {
    return {
      terminal: snap.pipeline[snap.pipeline.length - 1]?.id ?? null,
      lookup: crewLookupOf(await this.crewKinds(vault, await this.host.listMarkdownFiles(vault.id))),
    };
  }

  /** The git step of a mutation: one commit for exactly these paths. */
  private async commit(vault: EngineVault, vaultRelPaths: readonly string[], message: string): Promise<string | null> {
    const location = await this.locate(vault.path);
    if (location === null) {
      return 'the tickets vault is not a git repository — the change is not versioned';
    }
    const repoRel = vaultRelPaths.map((p) => `${location.prefix}${p}`);
    try {
      await this.git.commitPaths(location.root, repoRel, message);
      return null;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.host.log(`git commit failed: ${text}`, 'warn');
      return `git commit failed: ${text.split('\n')[0]}`;
    }
  }

  createTicket(input: {
    title: string;
    /** Who acts (req-66): `owner@<device>` from the remote; default the desk owner. */
    actor?: string;
    priority: TicketPriority;
    /** The primary work repo. */
    repo: string | null;
    /** Every work repo, primary first (req-72); absent = just the primary. */
    repos?: readonly string[];
    description: string;
    /** The owner's raw words behind a tidied create (req-75 W5c); absent
     *  for a hand-typed ticket — one more Log line when set. */
    raw?: string;
    /** req-285: the project the capture lands in; absent = none named. */
    project?: string;
  }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      const snap = await this.snapshot();
      if (snap.pipeline.length === 0) {
        return { ok: false, error: snap.pipelineError ?? 'the pipeline is empty' };
      }
      // The created file's priority must carry a word of the vault's own
      // vocabulary — an unknown id would read as the default with a
      // warning forever, so it refuses here instead.
      if (!snap.priorities.order.includes(input.priority)) {
        return {
          ok: false,
          error: `unknown priority "${input.priority}" — this board's vocabulary is ${snap.priorities.order.join(', ')}`,
        };
      }
      return this.createInStore(this.store, snap, input);
    });
  }

  /**
   * Capture on dricket (E14-4b): `dk add` allocates the number and leaves a valid
   * stub (title, priority), then ONE `put` fills the document the way a capture
   * writes it (header, Description, Log). A failure between the two leaves a
   * titled ticket in the first column, never a hole.
   */
  private async createInStore(
    store: StoreSettings,
    snap: BoardSnapshot,
    input: { title: string; actor?: string; priority: TicketPriority; repo: string | null; repos?: readonly string[]; description: string; raw?: string; project?: string },
  ): Promise<{ ok: false; error: string } | { ok: true; id: string; path: string }> {
    const firstPhase = snap.pipeline[0]!.id;
    let id: string;
    try {
      id = (await this.storeBoard.add(store, { title: input.title, priority: input.priority, kind: 'human' })).id;
      const text = newTicketFileText({
        id,
        title: input.title,
        repo: input.repo,
        ...(input.repos !== undefined ? { repos: input.repos } : {}),
        priority: input.priority,
        rank: 5000,
        firstPhase,
        now: new Date(),
        actor: input.actor ?? this.owner,
        description: input.description,
        ...(input.raw !== undefined ? { rawCapture: input.raw } : {}),
        ...(input.project !== undefined ? { project: input.project } : {}),
        chain: renderChainEntries(snap.flow ?? []),
      });
      await this.putRecord(store, await this.storeBoard.record(store, id), text, { phase: firstPhase });
    } catch (error) {
      this.announceChanged();
      return { ok: false, error: `dricket: ${messageOf(error)}` };
    }
    this.announceChanged();
    return { ok: true, id, path: `tickets/${firstPhase}/${id}.md` };
  }

  transition(input: {
    id: string;
    actor?: string;
    from: string;
    to: string;
  }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      const snap = await this.snapshot();
      const fromCol = snap.columns.find((c) => c.phase.id === input.from);
      const card = fromCol?.tickets.find((t) => t.id === input.id) ?? null;
      if (card === null) {
        return {
          ok: false,
          error: `${input.id} is not in "${input.from}" — it may have moved; refresh the board`,
        };
      }
      return this.moveCard(vault, snap, card, input.to, input.actor ?? this.owner);
    });
  }

  /**
   * The board's move, already inside the queue (shared by `transition`,
   * the Ready card's Accept and its Send back, req-75 W3): validate the
   * target and the path guard here, then run the one transition machine —
   * patch (plus the optional second Log line), one `put`, one announcement.
   */
  private async moveCard(
    vault: EngineVault,
    snap: BoardSnapshot,
    card: TicketCard,
    to: string,
    actor: string,
    extraLog?: string,
    text?: string,
  ): Promise<BoardMutationResult> {
    const from = card.phase;
    const toPhase = snap.pipeline.find((p) => p.id === to) ?? null;
    if (toPhase === null) {
      return { ok: false, error: `"${to}" is not a phase in the pipeline` };
    }
    // Prefix-aware path guard (T-0041): the card may sit in `10-inbox`
    // or `inbox` — the stripped phase id is the identity.
    const parts = ticketPathParts(card.path);
    if (parts === null || parts.phase !== from || parts.stem !== card.id) {
      return { ok: false, error: `${card.id} sits in an unexpected path (${card.path})` };
    }

    // A hand-move never touches the claim (owner ruling, 2026-10-18): a
    // stamp here would block the target column's pool, since the
    // dispatcher never takes claimed cards. Claims belong to the
    // takeover/release menu and to the fleet's own moves.
    const result = await runTransition(this.moveIo(vault, snap), {
      id: card.id,
      fromPath: card.path,
      ...(text !== undefined ? { text } : {}),
      patch: { to, from, now: new Date(), actor },
      ...(extraLog !== undefined ? { extraLog } : {}),
      toPath: `tickets/${to}/${card.id}.md`,
    });
    // The stage history is dk's (and derivable): the ledger gets no `phase` line (E14-6).
    return result;
  }

  /**
   * Archives a ticket (T-0041): the terminal stage plus the `archived` label —
   * not a column, invisible on the board. The treatment is exact: Log line
   * `archived`, NO `entered-` stamp (the Log marker is what makes it idempotent
   * and a revive detectable); claim fields ride along. Reviving is
   * {@link unarchive}.
   */
  archive(input: { id: string; actor?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      const snap = await this.snapshot();
      const card = findOnBoard(snap, input.id);
      if (card === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      return this.archiveCard(vault, snap, card, input.actor ?? this.owner);
    });
  }

  /**
   * The archive treatment itself, already inside the queue (the Ready
   * card's terminal Accept reuses it, req-75 W3) — one transition-machine
   * run: the `archived` Log line, NO `entered-` stamp (the Log marker is
   * what makes it idempotent and a revive detectable), the terminal stage
   * plus the `archived` label. Claim fields ride along.
   */
  private async archiveCard(vault: EngineVault, snap: BoardSnapshot, card: TicketCard, actor: string): Promise<BoardMutationResult> {
    const result = await runTransition(this.moveIo(vault, snap), {
      id: card.id,
      fromPath: card.path,
      patch: { to: 'archive', from: null, now: new Date(), actor, action: 'archived' },
      toPath: `${TICKETS_ARCHIVE_DIR}/${card.id}.md`,
    });
    // E7: the ledger's archived line rides the successful archive.
    if (result.ok) {
      this.options.events?.ledger({ kind: 'archived', ticket: card.id });
    }
    return result;
  }

  /**
   * "Launch this version" (req-75 W3, T-0057): start the repository's
   * program in the ticket's worktree, in a new console that outlives
   * Drey. The command is the repo's `launch:` from repos.md (owner
   * data) or the fixed dev.ps1 default — never anything from ticket
   * content.
   */
  launchVersion(input: { id: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      const snap = await this.snapshot();
      const card = findOnBoard(snap, input.id);
      if (card === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const notThere = `${input.id} has no worktree yet — nothing to launch`;
      const repo = card.meta.repo === null ? null : snap.repos.find((r) => r.name === card.meta.repo) ?? null;
      if (repo === null) {
        return { ok: false, error: notThere };
      }
      const worktreePath = worktreePathFor(vault.path, repo, card.id);
      if (!(await fsp.stat(worktreePath).then((s) => s.isDirectory()).catch(() => false))) {
        return { ok: false, error: notThere };
      }
      let command: string | null = repo.launch;
      if (command === null) {
        // The default a Drey checkout carries (req-75 W3): the packaged
        // app from a second, lock-free instance beside the one running.
        if (await fsp.stat(`${worktreePath}${path.sep}dev.ps1`).then((s) => s.isFile()).catch(() => false)) {
          command = 'powershell -NoProfile -ExecutionPolicy Bypass -File dev.ps1 -Built -Multi';
        }
      }
      if (command === null) {
        return {
          ok: false,
          error: `No launch command for "${repo.name}" — add launch: to repos.md (Settings → Tickets → Repositories)`,
        };
      }
      try {
        this.host.launchInConsole(worktreePath, command);
      } catch (error) {
        return { ok: false, error: `launch failed: ${messageOf(error)}` };
      }
      return { ok: true };
    });
  }

  /**
   * The owner's Accept: on a chain ticket the cursor's move (`chainAccept`, the sign-off's commit
   * step included); on any other ticket the ordinary move to the next column, and in the terminal
   * column the archive treatment, then the worktree goes when it is clean (a dirty one stays,
   * visibly). No second merge implementation here.
   */
  acceptTicket(input: { id: string; actor?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      const snap = await this.snapshot();
      const card = findOnBoard(snap, input.id);
      if (card === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const actor = input.actor ?? this.owner;
      const chained = await this.chainAccept(vault, snap, card, actor);
      if (chained !== null) {
        return chained;
      }
      const next = columnAfter(snap.columns, card.phase);
      if (next !== null) {
        // E10-6: finishing a manual step is an ordinary Accept; the Log says whose step it was.
        const finished = card.meta.awaiting === undefined ? undefined : `manual step finished by ${actor} (${card.meta.awaiting})`;
        const moved = await this.moveCard(vault, snap, card, next, actor, finished);
        if (moved.ok && finished !== undefined) {
          await this.noteStatus(card, 'done', { text: finished }, actor);
        }
        return moved;
      }
      const archived = await this.archiveCard(vault, snap, card, actor);
      if (!archived.ok) {
        return archived;
      }
      // E7: a terminal Accept is the ledger's merged line (the archive
      // itself already wrote the archived line).
      this.options.events?.ledger({ kind: 'merged', ticket: card.id });
      const warnings = [archived.warning];
      const worktreeWarning = await this.removeWorktreeAfterAccept(vault, snap, card);
      if (worktreeWarning !== null) {
        warnings.push(worktreeWarning);
      }
      const kept = warnings.filter((w): w is string => w !== undefined);
      return { ok: true, ...(kept.length === 0 ? {} : { warning: kept.join('; ') }) };
    });
  }

  /** req-257: Accept on a chain ticket (`chain-owner-moves.ts`); null = the ticket sits in a column of its own (Inbox, Prioritized, Done) or has no chain: the column move. */
  private async chainAccept(vault: EngineVault, snap: BoardSnapshot, card: TicketCard, actor: string): Promise<BoardMutationResult | null> {
    const decision = ownerAcceptOf(card, await this.ownerChainContext(vault, snap));
    if (decision.kind === 'none') {
      return null;
    }
    if (decision.kind === 'commit') {
      return (await this.commitActionMissing(vault, card.id)) ?? this.startCommitStep(card.id);
    }
    const terminal = snap.pipeline[snap.pipeline.length - 1]?.id ?? 'done';
    const target =
      decision.kind === 'done'
        ? { done: terminal }
        : decision.kind === 'shaped'
          ? { at: decision.at, chain: decision.entries }
          : { at: decision.at, returned: decision.returned };
    const written = await this.writeChainCursor(card, target, { line: decision.line, actor });
    const warning = written.ok && decision.kind === 'done' ? await this.removeWorktreesOfDone(card) : null;
    return warning === null || !written.ok ? written : { ...written, warning };
  }

  /**
   * req-257: one owner write of a chain ticket's cursor on the store — `x-at` moved (the stage stays
   * `active`), or the ticket to `done` — with the status line, one `put`.
   */
  private async writeChainCursor(card: TicketCard, target: { readonly at: number; readonly returned?: boolean; readonly chain?: readonly string[] } | { readonly done: string }, why: { readonly line: string; readonly actor: string; readonly text?: string }): Promise<BoardMutationResult> {
    const store = this.store;
    try {
      const record = await this.storeBoard.record(store, card.id);
      const legacy = why.text ?? recordToBoardFile(record, card.phase).text;
      const moved =
        'at' in target ? (target.chain !== undefined ? withChainAndCursor(legacy, target.chain, target.at) : (setDocumentField(legacy, 'at', String(target.at)) ?? legacy)) : legacy;
      // req-78: every owner write of the cursor uses or drops a red gate's return; only a return keeps the loop's count.
      const loopKeys = 'at' in target && target.returned === true ? ['return-to'] : ['return-to', 'red-backs'];
      const settled = loopKeys.reduce((doc, key) => setDocumentField(doc, key, null) ?? doc, moved);
      const text = setDocumentField(settled, 'awaiting', null) ?? settled; // the owner decided: no longer waiting for You
      await this.putRecord(store, record, text, 'at' in target ? { keepStage: true } : { phase: target.done });
    } catch (error) {
      return { ok: false, error: error instanceof TicketChangedError ? `${card.id} changed meanwhile — look again and retry` : messageOf(error) };
    }
    await this.noteStatus(card, 'done', { text: why.line }, why.actor);
    this.announceChanged();
    return { ok: true };
  }

  /**
   * req-257: the tickets whose cursor stands on Mission Control's persona (Pia) and that do not wait
   * for the owner yet — the entries `MissionEntryTurns` runs one ticket-scoped turn for.
   */
  async missionEntries(): Promise<readonly MissionEntry[]> {
    const vault = await this.detect();
    const store = vault === null ? null : await this.refreshStore(vault);
    if (vault === null || store === null || store.dkStore === '') {
      return []; // no store: no snapshot on every board and fleet change
    }
    const snap = await this.snapshot();
    const terminal = snap.pipeline[snap.pipeline.length - 1]?.id ?? null;
    const lookup = crewLookupOf(await this.crewKinds(vault, await this.host.listMarkdownFiles(vault.id)));
    const loader = this.personaLoaderFor(vault);
    const entries: MissionEntry[] = [];
    for (const card of snap.columns.filter((c) => !EDGE_STAGES.includes(c.phase.id) && c.phase.id !== terminal).flatMap((c) => c.tickets)) {
      const holder = holderOf({ stage: 'active', chain: card.meta.chain, at: card.meta.at, awaiting: card.meta.awaiting }, lookup);
      if (holder.kind === 'entry' && holder.work === 'mission-turn' && card.meta.claimedBy === null) {
        const title = (await loader.load(holder.persona))?.title ?? holder.persona;
        entries.push({ id: card.id, position: holder.entry.position, length: holder.entry.length, persona: title });
      }
    }
    return entries;
  }

  /** req-257: the ticket waits for the owner — `awaiting: you` and a `needs-decision` under `key` (Pia's entry after her turn). */
  waitForOwner(input: { readonly id: string; readonly key: string; readonly text: string; readonly detail: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const store = this.store;
      const card = findOnBoard(await this.snapshot(), input.id);
      if (card === null) {
        return { ok: false, error: `${input.id} is not on a dricket board` };
      }
      try {
        const record = await this.storeBoard.record(store, card.id);
        const legacy = recordToBoardFile(record, card.phase).text;
        await this.putRecord(store, record, setDocumentField(legacy, 'awaiting', HUMAN_PERSONA_ID) ?? legacy, { keepStage: true });
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      await this.noteStatus(card, 'needs-decision', { key: input.key, text: input.text, detail: input.detail }, this.owner);
      this.announceChanged();
      return { ok: true };
    });
  }

  /**
   * req-257 (owner 2026-11-12, Q1a): a confirmed card of Pia's entry session ends her entry — the cursor
   * moves on (past the last entry: `done`) and her `pia-turn` decision is resolved. Nothing when the
   * ticket has moved on meanwhile.
   */
  finishMissionEntry(input: { readonly id: string; readonly position: number }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const snap = await this.snapshot();
      const card = findOnBoard(snap, input.id);
      const chain = card?.meta.chain;
      if (card === null || chain === undefined || (card.meta.at ?? 1) !== input.position) {
        return { ok: true }; // the ticket stands elsewhere now: nothing to finish
      }
      const terminal = snap.pipeline[snap.pipeline.length - 1]?.id ?? 'done';
      const back = cursorAfterGreen(chain.length, input.position, card.meta.returnTo); // req-78: her entry may be a red gate's target
      const last = !back.returned && input.position >= chain.length;
      const written = await this.writeChainCursor(card, last ? { done: terminal } : { at: back.at, returned: back.returned }, { line: `Mission Control's entry at position ${input.position} of ${chain.length} is done — her card was confirmed`, actor: this.owner });
      if (written.ok) {
        await this.noteStatus(card, 'resolved', { key: MISSION_ENTRY_KEY }, this.owner);
        if (last) {
          await this.removeWorktreesOfDone(card);
        }
      }
      return written;
    });
  }

  /**
   * req-257: a chain ticket whose cursor stands past its last entry (an agent's run ended the chain) is
   * moved to `done` by the engine — an agent may not release into a terminal stage. Idempotent.
   */
  async settleFinishedChains(): Promise<void> {
    if (this.store.dkStore === '') {
      return; // no store, no chains
    }
    const due = await this.enqueue(async () => {
      const snap = await this.snapshot();
      const terminal = snap.pipeline[snap.pipeline.length - 1]?.id ?? null;
      const column = snap.columns.find((c) => c.phase.id === terminal);
      return (column?.tickets ?? []).filter((card) => chainFinished(card.meta.chain, card.meta.at) && card.meta.claimedBy === null);
    });
    for (const card of due) {
      await this.enqueue(async () => {
        const store = this.store;
        const record = await this.storeBoard.record(store, card.id).catch(() => null);
        if (record === null || record.stage !== ACTIVE_STAGE) {
          return;
        }
        const moved = await this.putRecord(store, record, recordToBoardFile(record, card.phase).text, { phase: card.phase }).then(
          () => true,
          (error: unknown) => {
            this.host.log(`chain: ${card.id} could not be moved to done — ${messageOf(error)}`, 'warn');
            return false;
          },
        );
        if (moved) {
          await this.removeWorktreesOfDone(card);
        }
      });
    }
  }

  /**
   * req-267 (owner 2026-11-12): the sign-off's merge is the human persona's
   * `commit` leaving action. A record that does not list it refuses the
   * Accept — a ticket never lands in Done unmerged because a key is missing.
   */
  private async commitActionMissing(vault: EngineVault, ticketId: string): Promise<BoardMutationResult | null> {
    const you = await personaLoader((rel) => this.host.read(vault.id, rel)).load(HUMAN_PERSONA_ID);
    if (you?.settings.leaving.includes('commit') === true) {
      return null;
    }
    const name = you?.title ?? 'You';
    return {
      ok: false,
      error:
        `Signing off ${ticketId} merges its branch into main, and that merge is ${name}'s "commit" leaving action — ${name}'s persona does not list it yet. ` +
        `Open the Crew tab → ${name} → Work, choose Leaving actions → Add action… → commit, then Accept again.`,
    };
  }

  /**
   * Accept at You's last entry of a repository ticket is the sign-off (req-99a, build plan Q8): You's
   * `commit` leaving action (req-267) as a MACHINE run on the target
   * repository — no worker, no model: the ticket's branch merged into the
   * integration branch and pushed (`fleet/orchestrate/commit-run.ts`). Dk never
   * lets an agent release into the terminal stage, so the run moves nothing and
   * {@link settleCommitSteps} makes the owner's move afterwards. A blocked or red end leaves the ticket where it is with
   * the reason, and Accept again starts it again (it completes at once when
   * the work is already on main).
   */
  private async startCommitStep(ticketId: string): Promise<BoardMutationResult> {
    const live = (await this.fleetRecords()).some((r) => r.ticketId === ticketId && !['done', 'stopped', 'failed'].includes(r.state));
    if (live) {
      return { ok: false, error: `${ticketId} has a live run — stop it or wait for it first` };
    }
    const started = await this.startRunInQueue(
      { origin: 'accept', ticketId, workerChoice: null, permissionMode: this.autoPermissionMode, handover: 'fresh', interactive: null },
      true,
    );
    if (!started.ok) {
      return { ok: false, error: started.error ?? `the commit step of ${ticketId} did not start` };
    }
    if (started.runId !== undefined) {
      this.commitSteps.set(ticketId, started.runId);
    }
    return { ok: true, ...(started.runId !== undefined ? { runId: started.runId } : {}) };
  }

  /**
   * The bookkeeping half of the commit step: a run that ended green books its
   * ticket into Done, as the owner who accepted. Idempotent; a run that ended
   * otherwise only leaves the list.
   * The list lives in memory: after an engine restart the owner's next
   * Accept finds the work pushed and completes.
   */
  async settleCommitSteps(): Promise<void> {
    if (this.commitSteps.size === 0) {
      return;
    }
    const runs = await this.fleetRecords();
    for (const [ticketId, runId] of [...this.commitSteps]) {
      const run = runs.find((r) => r.id === runId);
      if (run === undefined || !['done', 'stopped', 'failed'].includes(run.state)) {
        continue;
      }
      if (run.state !== 'done' || (run.blocked ?? null) !== null || run.gateResult === 'red') {
        this.commitSteps.delete(ticketId);
        continue;
      }
      // D-32: the run reads `done` before the runner releases its claim (the
      // release follows a moment later), so a green step whose ticket is still
      // in the claim stage is not settled yet — it waits for the next change
      // (fleet or board) instead of being dropped as "the owner moved it".
      const settled = await this.enqueue(async (): Promise<BoardMutationResult & { pending?: true }> => {
        const snap = await this.snapshot();
        const card = findOnBoard(snap, ticketId);
        if (card === null || card.meta.chain === undefined) {
          return { ok: true }; // the owner moved it meanwhile: nothing to book
        }
        return this.settleChainCommit(card, snap, runId);
      });
      if (settled.ok && settled.pending === true) {
        continue;
      }
      this.commitSteps.delete(ticketId);
      if (!settled.ok) {
        this.host.log(`commit step: ${ticketId} stays where it is — ${settled.error}`, 'warn');
      }
      this.announceChanged();
    }
  }

  /**
   * D-72 (found by milestone 273's e2e): a chain ticket's sign-off (req-257) is
   * the commit at You's last entry — once it landed the chain is through, and
   * the engine books the ticket into Done as the owner (dk never lets the
   * run's agent release into the terminal stage). Waits while the runner
   * still holds the claim (D-32); nothing when the ticket is in Done already.
   */
  private async settleChainCommit(card: TicketCard, snap: BoardSnapshot, runId: string): Promise<BoardMutationResult & { pending?: true }> {
    if (card.meta.claimedBy !== null) {
      return { ok: true, pending: true };
    }
    const terminal = snap.pipeline[snap.pipeline.length - 1]?.id ?? 'done';
    if (card.phase === terminal) {
      return { ok: true };
    }
    return this.writeChainCursor(card, { done: terminal }, { line: `commit step finished (run ${runId}) — the chain is through`, actor: this.owner });
  }

  /**
   * The clean-worktree removal of a terminal Accept (req-75 W3): the
   * T-0044 `worktree remove` path with `force: false` — a dirty tree
   * stays and says so; a live run keeps it untouched. Never a failed
   * accept: the ticket is already archived.
   */
  private async removeWorktreeAfterAccept(vault: EngineVault, snap: BoardSnapshot, card: TicketCard): Promise<string | null> {
    const runs = await this.fleetRecords();
    const liveRun = runs.some((r) => r.ticketId === card.id && !['done', 'stopped', 'failed'].includes(r.state));
    return removeDoneWorktrees({ finished: this.finishedWorktrees, vaultPath: vault.path, repos: snap.repos, card, liveRun });
  }

  /** req-185: a chain ticket the engine or the owner booked into Done; what was kept is a log line. */
  private async removeWorktreesOfDone(card: TicketCard): Promise<string | null> {
    const vault = await this.detect();
    const warning = vault === null ? null : await this.removeWorktreeAfterAccept(vault, await this.snapshot(), card);
    if (warning !== null) {
      this.host.log(`${card.id}: ${warning}`, 'warn');
    }
    return warning;
  }

  /**
   * The owner's "Send back…" (req-75 W3, req-257): on a chain ticket the cursor goes to the picked
   * (else the nearest earlier agent) position with the note as a comment and, for a review, the
   * line comments as feedback.
   */
  sendBack(input: {
    id: string;
    note: string;
    actor?: string;
    /** E11-3: line comments of the review; they land in the ticket's Handover as structured feedback. */
    comments?: readonly ReviewComment[];
    /** req-270: the earlier chain position the owner picked; absent = the nearest earlier agent position. */
    position?: number;
  }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      const snap = await this.snapshot();
      const card = findOnBoard(snap, input.id);
      if (card === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const chained = await this.chainSendBack(vault, snap, card, input);
      if (chained !== null) {
        return chained;
      }
      // A ticket without a chain, or one in a column of its own, has no earlier agent position (the pipeline holds only the lifecycle columns).
      return { ok: false, error: `there is no agent phase before "${card.phase}" to send ${input.id} back to` };
    });
  }

  /** req-257: the owner's Send back on a chain ticket — the cursor to the nearest earlier agent position; null = no chain position to go back to. */
  private async chainSendBack(vault: EngineVault, snap: BoardSnapshot, card: TicketCard, input: { readonly note: string; readonly actor?: string; readonly comments?: readonly ReviewComment[]; readonly position?: number }): Promise<BoardMutationResult | null> {
    const decision = ownerSendBackOf(card, await this.ownerChainContext(vault, snap), Number.isInteger(input.position) ? input.position : undefined);
    if (decision.kind === 'none') {
      return null;
    }
    if (decision.kind === 'refused') {
      return { ok: false, error: decision.error };
    }
    const actor = input.actor ?? this.owner;
    const text = input.comments !== undefined && input.comments.length > 0 ? withReviewFeedback(await this.readCardText(card), input.comments) : undefined;
    const line = `sent back to position ${decision.at} (${decision.persona}): ${input.note.trim().slice(0, 500)}`;
    const written = await this.writeChainCursor(card, { at: decision.at }, { line, actor, ...(text !== undefined ? { text } : {}) });
    if (written.ok) {
      await this.commentOn(card, `sent back: ${input.note.trim()}`, actor);
    }
    return written;
  }

  /**
   * req-270: the owner's move on a persona board (`persona-board-moves.ts`): start a ticket on a
   * persona, hand the entry at the cursor to another persona, park it — one `put` with a status line.
   */
  personaBoardMove(move: PersonaBoardMove): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const store = this.store;
      const snap = await this.snapshot();
      const lanes = snap.lanes;
      if (lanes === undefined) {
        return { ok: false, error: 'the persona board runs on a migrated dricket store' };
      }
      const card = findOnBoard(snap, move.id);
      if (card === null) {
        return { ok: false, error: `${move.id} is not on the board` };
      }
      const lookup = crewLookupOf(new Map(lanes.map((lane) => [lane.persona, lane.kind])));
      const decision = personaMoveOf({ move, card, lookup, flow: snap.flow ?? [] });
      if (decision.kind !== 'write') {
        return decision.kind === 'refused' ? { ok: false, error: decision.error } : { ok: true };
      }
      try {
        const record = await this.storeBoard.record(store, card.id);
        const legacy = recordToBoardFile(record, card.phase).text;
        const text = decision.chain === null ? legacy : withChainAndCursor(legacy, decision.chain.entries, decision.chain.at);
        await this.putRecord(store, record, text, decision.phase === null ? { keepStage: true } : { phase: decision.phase });
      } catch (error) {
        return { ok: false, error: error instanceof TicketChangedError ? `${card.id} changed meanwhile — look again and retry` : messageOf(error) };
      }
      await this.noteStatus(card, 'done', { text: decision.line }, this.owner);
      this.announceChanged();
      return { ok: true };
    });
  }

  /** A plain comment on a store ticket; a failure is a log line, the move it follows already happened. */
  private async commentOn(card: TicketCard, text: string, actor: string): Promise<void> {
    try {
      await this.storeBoard.comment(this.store, card.id, text, actor);
    } catch (error) {
      this.host.log(`tickets: the comment on ${card.id} could not be written: ${messageOf(error)}`, 'warn');
    }
  }

  /**
   * The owner's answer to a Needs-you decision (E14-6): a `resolved: <key>`
   * comment closing the key, the answer as its detail. The key defaults to the
   * ticket's only open `needs-decision`/`blocked` key.
   */
  answerNeed(input: { id: string; key?: string; text?: string; actor?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      await this.refreshStore((await this.detect()) ?? undefined);
      const found = await this.findCard(input.id);
      if (found === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      const open = openStatusItems(await this.statusOf(input.id)).filter((item) => item.key !== null);
      let key = slugStatusKey(input.key ?? '');
      if (key === null && (input.key ?? '').trim() === '') {
        key = open.length === 1 ? open[0]!.key : null;
      }
      if (key === null) {
        return { ok: false, error: open.length === 0 ? `${input.id} has no open decision to answer` : 'name the decision key to answer' };
      }
      if (!open.some((item) => item.key === key)) {
        return { ok: false, error: `${input.id} has no open decision "${key}"` };
      }
      await this.noteStatus(found.card, 'resolved', { key, ...(input.text !== undefined && input.text.trim() !== '' ? { detail: input.text } : {}) }, input.actor ?? this.owner);
      this.announceChanged();
      return { ok: true };
    });
  }

  /**
   * The Ready page's data (req-75 W3): the parsed `## Changes` section
   * and the story, read from the ticket file — no new frontmatter.
   */
  async changesOf(id: string): Promise<ChangesReply> {
    const found = await this.findCard(id);
    if (found === null) {
      return { changes: null, story: [], totals: { minutes: null, tokens: null }, planApproved: null, result: null, launchable: false };
    }
    const story = storyOf(found.text);
    return {
      changes: parseChanges(found.text),
      story: story.items,
      totals: story.totals,
      planApproved: planApprovedOf(found.text),
      result: parseResult(found.text),
      launchable: await this.launchableFor(id),
    };
  }

  /** Whether "Launch this version" can work: a worktree on disk and a command to run in it. */
  private async launchableFor(id: string): Promise<boolean> {
    try {
      const vault = await this.detect();
      if (vault === null) {
        return false;
      }
      const snap = await this.snapshot();
      const card = findOnBoard(snap, id);
      const repo = card?.meta.repo == null ? null : snap.repos.find((r) => r.name === card.meta.repo) ?? null;
      if (card === null || repo === null) {
        return false;
      }
      const worktreePath = worktreePathFor(vault.path, repo, card.id);
      if (!(await fsp.stat(worktreePath).then((s) => s.isDirectory()).catch(() => false))) {
        return false;
      }
      return (
        repo.launch !== null ||
        (await fsp.stat(`${worktreePath}${path.sep}dev.ps1`).then((s) => s.isFile()).catch(() => false))
      );
    } catch {
      return false;
    }
  }

  /**
   * Unarchives a ticket (T-0042): the move out of the archive back into a
   * phase IS the board treatment — `archive -> <phase>` stamp, Log line, one
   * `put` that drops the `archived` label. The board itself shows nothing
   * archived; the record is read directly.
   */
  unarchive(input: { id: string; to: string; actor?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      const snap = await this.snapshot();
      const toPhase = snap.pipeline.find((p) => p.id === input.to) ?? null;
      if (toPhase === null) {
        return { ok: false, error: `"${input.to}" is not a phase in the pipeline` };
      }
      return runTransition(this.moveIo(vault, snap), {
        id: input.id,
        fromPath: `${TICKETS_ARCHIVE_DIR}/${input.id}.md`,
        readError: `${input.id} is not in the archive`,
        patch: { to: input.to, from: 'archive', now: new Date(), actor: input.actor ?? this.owner },
        toPath: `tickets/${input.to}/${input.id}.md`,
      });
    });
  }

  /**
   * "Remove worktree" (T-0042, Files context command on `_worktrees/<id>`):
   * the pure planner (`planWorktreeRemoval`) decides over the board — a
   * running ticket's worktree is never touched — and `git worktree remove`
   * executes from the repo's main checkout. The vault re-reads afterwards;
   * the worktree folder lives OUTSIDE `tickets/`, so no transition commit
   * belongs to it.
   */
  async removeWorktree(folder: string): Promise<BoardMutationResult> {
    const vault = await this.detect();
    if (vault === null) {
      return { ok: false, error: 'no tickets vault detected' };
    }
    const snap = await this.snapshot();
    const plan = planWorktreeRemoval({
      folder,
      cards: snap.columns.flatMap((column) => column.tickets),
      repos: snap.repos,
    });
    if (!plan.ok) {
      return { ok: false, error: plan.error };
    }
    const worktreeAbs = this.host.resolveAssetPath(vault.id, folder);
    if (worktreeAbs === null) {
      return { ok: false, error: 'the worktree path escapes the vault' };
    }
    try {
      // The repo's `link:` junctions go first (the top-level sweep catches
      // the rest): git's worktree removal leaves them behind, and a
      // leftover folder at the path poisons the next prepare.
      const links = snap.repos.find((r) => r.path === plan.repoPath)?.link ?? [];
      await unlinkShared(worktreeAbs, links);
      await this.git.worktreeRemove(plan.repoPath, worktreeAbs);
    } catch (error) {
      return { ok: false, error: `git worktree remove failed: ${messageOf(error).split('\n')[0]}` };
    }
    this.host.announceChanges(vault.id, [], [folder]);
    this.announceChanged();
    return { ok: true };
  }

  setClaim(input: { id: string; mode: 'takeover' | 'release'; actor?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      return this.setClaimInStore(await this.refreshStore((await this.detect()) ?? undefined), input);
    });
  }

  /**
   * Starts a fleet run for one ticket (M84, ADR-0075): resolve the
   * worker through the shared request builder (ticket pin > column >
   * handover pin > repo default > configured default), read the
   * handover's prompt, and hand the runner the request. The runner owns
   * the worker process and the ticket stamps; this side refuses early
   * with the reason a human can act on.
   */
  startRun(input: {
    /** Who asks (D-41): logged, carried to the runner; a start without one is refused. */
    origin: string;
    ticketId: string;
    workerChoice: string | null;
    permissionMode: PermissionMode;
    /** The dialog's handover choice (T-0049); null = not asked — fresh. */
    handover: HandoverMode | 'auto' | null;
    /**
     * The owner drives this run as an interactive dialog (req-65):
     * the worker is held from turn one, the run never gates or moves.
     * null = a normal run.
     */
    interactive: InteractiveMode | null;
  }): Promise<{ ok: boolean; error?: string; runId?: string }> {
    if (typeof input.origin !== 'string' || input.origin.trim() === '') {
      this.host.log(`run start refused for ${input.ticketId}: it names no origin`, 'warn');
      return Promise.resolve({ ok: false, error: 'a run start must say who asks for it (origin)' });
    }
    return this.enqueue(() => this.startRunInQueue(input, false));
  }

  /** {@link startRun} inside the queue; `commitStep` is Accept's run on Ready to try (req-99a). */
  private async startRunInQueue(
    input: { origin: string; ticketId: string; workerChoice: string | null; permissionMode: PermissionMode; handover: HandoverMode | 'auto' | null; interactive: InteractiveMode | null },
    commitStep: boolean,
  ): Promise<{ ok: boolean; error?: string; runId?: string }> {
    this.host.log(`run start: ${input.ticketId} asked by ${input.origin}`);
    const store = await this.refreshStore((await this.detect()) ?? undefined);
    if (store.dkStore === '') {
      return { ok: false, error: 'no dricket store configured (tickets.dk.store)' };
    }
    const vault = await this.detect();
    if (vault === null) {
      return { ok: false, error: 'no tickets vault detected' };
    }
    const snap = await this.snapshot();
    let card: TicketCard | null = null;
    let phaseId: string | null = null;
    for (const column of snap.columns) {
      const found = column.tickets.find((t) => t.id === input.ticketId);
      if (found !== undefined) {
        card = found;
        phaseId = column.phase.id;
        break;
      }
    }
    if (card === null || phaseId === null) {
      return { ok: false, error: `${input.ticketId} is not on the board` };
    }
    const blocked = blockedRefusal(card);
    if (blocked !== null) {
      return { ok: false, error: blocked };
    }
    const workingPhase = snap.pipeline.find((p) => p.id === phaseId) ?? null;
    const repo =
      card.meta.repo === null ? null : (snap.repos.find((r) => r.name === card!.meta.repo) ?? null);
    // req-72: the ticket's further repos, resolved like the primary's —
    // an unknown name refuses the start (the board badges it already).
    const missingExtra = card.meta.repos.find((name) => name !== card.meta.repo && !snap.repos.some((r) => r.name === name));
    if (missingExtra !== undefined) {
      return { ok: false, error: `${card.id} names repo "${missingExtra}", but it is not in _meta/repos.md` };
    }
    const extraRepos = card.meta.repos
      .filter((name) => name !== card.meta.repo)
      .map((name) => snap.repos.find((r) => r.name === name)!)
      .filter((r) => r !== undefined);
    const text = await this.readCardText(card);
    // req-65: a dialog run follows the persona's prompt with the shipped interview-first protocol
    // (`prompts/crew/dialog.md`, req-307: read from the package); every other run's brief is the persona's prompt alone.
    const prompt = input.interactive !== null ? await this.dialogPrompt() : null;
    // req-257: a chain ticket's run hands on by its cursor, never by a move. The commit step moves
    // nothing itself: dk refuses an agent's release into the terminal stage (settleCommitSteps).
    const chainRun = await this.chainRunOf(vault, snap, card);
    // The context pack (T-0048): repo instructions, the worktree's diff
    // stat, and the previous run's gate failure on a retry — the file
    // reads stay here, the composer stays pure.
    let repoInstructions: string | null = null;
    let diffStat: string | null = null;
    if (repo !== null && repo.path !== null) {
      repoInstructions = await readRepoInstructions(repo.path, repo.instructions);
      diffStat = await worktreeDiffStat(
        this.git,
        worktreePathFor(vault.path, repo, card.id),
        repo.branch,
      );
    }
    const gateFailure = await this.lastGateFailure(card.id);
    // req-257: who works it — the chain entry at the cursor; a resolved persona contributes
    // worker/model/prompt/memory; an owner-picked worker in the dialog still wins.
    const loader = personaLoader((rel) => this.host.read(vault.id, rel));
    // The commit step is a machine run (req-267): no agent persona works it; the request names the human's.
    const personaResolution = await resolvePersonaForTicket(
      loader,
      commitStep ? {} : { chainPersona: chainRun?.persona ?? null },
    );
    let personaDispatch: PersonaDispatch | null = null;
    if (personaResolution.persona !== null) {
      const derived = deriveWorkerModel(personaResolution.persona);
      personaDispatch = {
        id: personaResolution.persona.id,
        role: personaResolution.persona.role,
        worker: derived.workerChoice,
        model: derived.model ?? '',
        prompt: await loader.prompt(personaResolution.persona.id),
        memory: await loader.memory(personaResolution.persona.id),
        skills: await this.personaSkillsFor(vault, personaResolution.persona),
        run: personaRunSettingsOf(personaResolution.persona),
        allowed: personaRunAllowedOf(personaResolution.persona),
      };
    }
    const composed = composeRunRequest({
      origin: input.origin,
      disciplines: await this.disciplines(),
      card,
      ticketText: text,
      vaultPath: vault.path,
      workingPhase,
      repo,
      extraRepos,
      promptText: prompt,
      defaultWorker: this.defaultWorker,
      permissionMode: input.permissionMode,
      gitPath: ((await this.host.configGet<string>('gitPath')) ?? '').trim(),
      workerChoice: input.workerChoice,
      repoInstructions,
      diffStat,
      gateFailure,
      caps: this.caps,
      project: ticketProject(card.meta.project, snap.projects ?? []), // req-282: its purpose rides the brief
      ...(personaDispatch !== null ? { persona: personaDispatch } : {}),
      ...(input.handover !== null ? { handover: input.handover } : input.interactive !== null ? { handover: 'auto' } : {}),
      ...(input.interactive !== null ? { interactive: input.interactive } : {}),
      ...(commitStep ? { commitStep: true } : {}),
      ...(chainRun !== null && !commitStep ? { cursor: chainRun.cursor } : {}),
      dk: await this.runTarget(store, snap.pipeline),
    });
    if (!composed.ok) {
      return { ok: false, error: composed.error };
    }
    for (const truncation of composed.truncations) {
      this.host.log(
        `instruction: ${card.id} ${truncation.section} truncated: true, originalSize ${truncation.originalSize}`,
      );
    }
    const outcome = await this.fleet.start(composed.request);
    if (outcome.ok) {
      this.announceChanged();
      return { ok: true, runId: outcome.run.id };
    }
    return { ok: false, error: outcome.error };
  }

  /** req-307: the interview-first dialog protocol, read once from the package. */
  private dialogPrompt(): Promise<string> {
    this.dialogOnce ??= (this.options.dialogPrompt ?? loadDialogPrompt)();
    return this.dialogOnce;
  }

  /** The texts of the skills a persona's record names (D-46); one with no text is a log line, the run goes on. */
  private async personaSkillsFor(vault: EngineVault, persona: Persona): Promise<readonly PersonaSkill[]> {
    const { skills, missing, warnings } = await loadPersonaSkills((rel) => this.readOptional(vault.id, rel), persona.id, persona.skills);
    for (const warning of warnings) {
      this.host.log(`persona ${persona.id}: ${warning}`, 'warn');
    }
    if (missing.length > 0) {
      this.host.log(`persona ${persona.id}: no text for skill ${missing.join(', ')}`, 'warn');
    }
    return skills;
  }

  // --- worktree cleanup (T-0044, ADR-0080) ---------------------------

  /** Every fleet run record (live or historical) the client can see. */
  private async fleetRecords(): Promise<readonly RunInfo[]> {
    return this.fleet.runs();
  }

  /**
   * The newest record for a ticket that names a worktree, or null.
   * Historical records settle on disk, so this survives a down runner.
   */
  private newestRecordFor(runs: readonly RunInfo[], ticketId: string): RunInfo | null {
    const found = runs
      .filter((r) => r.ticketId === ticketId && r.worktreePath.trim() !== '')
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return found[0] ?? null;
  }

  /**
   * The Changes-so-far box (req-75 W4a): the ticket's worktree diffed
   * against its base ref — committed (`<base>...HEAD`) and uncommitted
   * (the working tree vs `HEAD`) — as one file list, capped by the pure
   * half. Empty when there is no worktree to diff (no repo, no checkout,
   * nothing prepared yet).
   */
  async worktreeChangesOf(id: string): Promise<readonly WorktreeFile[]> {
    const vault = await this.detect();
    if (vault === null) {
      return [];
    }
    const snap = await this.snapshot();
    let card: TicketCard | null = null;
    for (const column of snap.columns) {
      const found = column.tickets.find((t) => t.id === id);
      if (found !== undefined) {
        card = found;
        break;
      }
    }
    const repoName = card !== null && card.meta.repo !== null ? card.meta.repo : null;
    const repo = repoName === null ? null : snap.repos.find((r) => r.name === repoName) ?? null;
    if (card === null || repo === null || repo.path === null) {
      return [];
    }
    const record = this.newestRecordFor(await this.fleetRecords(), card.id);
    const worktreePath = record !== null ? record.worktreePath : worktreePathFor(vault.path, repo, card.id);
    if (!existsSync(worktreePath)) {
      return [];
    }
    const base = repo.branch ?? 'main';
    try {
      const committed = await Promise.all([
        this.git.run(worktreePath, ['diff', '--numstat', `${base}...HEAD`]),
        this.git.run(worktreePath, ['diff', '--name-status', `${base}...HEAD`]),
      ]);
      const working = await Promise.all([
        this.git.run(worktreePath, ['diff', '--numstat', 'HEAD']),
        this.git.run(worktreePath, ['diff', '--name-status', 'HEAD']),
      ]);
      return mergeWorktreeChanges([
        { numstat: committed[0]!, nameStatus: committed[1]! },
        { numstat: working[0]!, nameStatus: working[1]! },
      ]);
    } catch {
      return [];
    }
  }

  /**
   * Liveness is the ticket's `run:` stamp ∪ non-terminal fleet records
   * (ADR-0080): never fleet status alone — `readHistory` marks a
   * still-live run `stopped` when the runner is down, and the stamps
   * are the persisted truth. A `detached` worker may still be running:
   * it counts as live.
   */
  private async liveWorktreePaths(vault: EngineVault, snap: BoardSnapshot): Promise<string[]> {
    const runs = await this.fleetRecords();
    const live = new Set<string>();
    for (const run of runs) {
      if (!['done', 'stopped', 'failed'].includes(run.state) && run.worktreePath.trim() !== '') {
        live.add(run.worktreePath);
      }
    }
    for (const column of snap.columns) {
      for (const card of column.tickets) {
        if (card.meta.run === null) {
          continue;
        }
        const record = this.newestRecordFor(runs, card.id);
        const repo =
          card.meta.repo === null ? null : snap.repos.find((r) => r.name === card.meta.repo) ?? null;
        if (repo !== null && repo.path !== null) {
          // The record's path first (it may predate the home rule);
          // the computed path covers a stamp without a record.
          live.add(record !== null ? record.worktreePath : worktreePathFor(vault.path, repo, card.id));
        }
      }
    }
    return [...live];
  }

  /**
   * The card menu's "Remove worktree" (T-0044): `git worktree remove`
   * through `worktree-clean`, the branch stays (it carries the work).
   * A dirty tree refuses unless `force` (the renderer's armed second
   * click); a live run refuses outright. The Log line + one commit are
   * the board's own single-writer treatment.
   */
  removeWorktreeForTicket(input: { id: string; force: boolean }): Promise<
    | { readonly ok: true; readonly warning?: string }
    | { readonly ok: false; readonly error: string; readonly dirty?: boolean; readonly status?: string }
  > {
    return this.enqueue(async () => {
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      const snap = await this.snapshot();
      let card: TicketCard | null = null;
      for (const column of snap.columns) {
        const found = column.tickets.find((t) => t.id === input.id);
        if (found !== undefined) {
          card = found;
          break;
        }
      }
      if (card === null) {
        return { ok: false, error: `${input.id} is not on the board` };
      }
      if (card.meta.repo === null) {
        return { ok: false, error: `${card.id} names no repository — there is no worktree` };
      }
      const repo = snap.repos.find((r) => r.name === card.meta.repo) ?? null;
      if (repo === null || repo.path === null) {
        return { ok: false, error: `"${card.meta.repo}" has no local path in _meta/repos.md` };
      }
      const runs = await this.fleetRecords();
      const liveRecord = runs.some(
        (r) => r.ticketId === card.id && !['done', 'stopped', 'failed'].includes(r.state),
      );
      if (card.meta.run !== null || liveRecord) {
        return { ok: false, error: `${card.id} has a live run — stop it before removing its worktree` };
      }
      const record = this.newestRecordFor(runs, card.id);
      const worktreePath = record !== null ? record.worktreePath : worktreePathFor(vault.path, repo, card.id);

      const outcome = await removeWorktree(this.git, repo.path, worktreePath, { force: input.force, links: repo.link });
      if (!outcome.ok) {
        if (outcome.dirty === true) {
          return {
            ok: false,
            error: `the worktree is dirty — confirm to remove it anyway`,
            dirty: true,
            status: outcome.status,
          };
        }
        return { ok: false, error: outcome.error };
      }

      // req-72: the further repos' worktrees follow (same branch, same
      // rules) — a dirty extra counts as force-consented with the primary,
      // a failure is a warning, never a failed action.
      const warnings: string[] = [];
      for (const name of card.meta.repos) {
        if (name === repo.name) {
          continue;
        }
        const extra = snap.repos.find((r) => r.name === name);
        if (extra === undefined || extra.path === null) {
          continue;
        }
        const extraOutcome = await removeWorktree(this.git, extra.path, worktreePathFor(vault.path, extra, card.id), {
          force: input.force,
          links: extra.link,
        });
        if (!extraOutcome.ok) {
          warnings.push(
            `${extra.name}: ${extraOutcome.dirty === true ? 'the worktree is dirty — not removed' : extraOutcome.error}`,
          );
        }
      }

      // The owner's button: one action-only Log line.
      const text = await this.readCardText(card);
      let warning: string | null = warnings.length > 0 ? `extra worktrees: ${warnings.join('; ')}` : null;
      try {
        const patched = patchTicketFile(text, {
          to: card.phase,
          from: null,
          now: new Date(),
          actor: this.owner,
          action: `worktree removed (${worktreePath})`,
        });
        await this.writeCardText(card, patched);
      } catch (error) {
        warning = `the worktree was removed, but the Log line failed: ${messageOf(error)}`;
      }
      this.announceChanged();
      return { ok: true, ...(warning === null ? {} : { warning }) };
    });
  }

  /**
   * The "Clean up worktrees" control (T-0044): every fleet worktree
   * whose ticket has no live run is removed (real git, dirty trees
   * kept and reported), then every mapped repo gets one
   * `git worktree prune`. Plugin-side by design (ADR-0080): the plugin
   * holds repos.md, the run history and the stamps, and cleanup usually
   * happens with the runner down.
   */
  async worktreeCleanup(): Promise<{ ok: boolean; report?: CleanupReport; error?: string }> {
    const vault = await this.detect();
    if (vault === null) {
      return { ok: false, error: 'no tickets vault detected' };
    }
    const snap = await this.snapshot();
    const protectedPaths = await this.liveWorktreePaths(vault, snap);
    const report = await cleanWorktrees(this.git, {
      repos: snap.repos,
      vaultPath: vault.path,
      fleetRoot: this.fleetRoot,
      protectedPaths,
    });
    this.host.log(
      `worktree cleanup: ${report.removed.length} removed, ${report.keptDirty.length} kept dirty` +
        `, ${report.leftovers.length} leftover folder(s) swept` +
        (report.failed.length > 0 ? `, ${report.failed.length} failed` : '') +
        `, pruned ${report.prunedRepos.length} repo(s)`,
    );
    return { ok: true, report };
  }

  /**
   * The boot sweep (T-0044, ADR-0080): the legacy-base migration (every
   * boot until the legacy root is empty — live runs keep theirs until
   * they settle, clean trees go, dirty ones stay and are reported),
   * the .gitignore ensure, and the orphan listing for the status note.
   */
  worktreeBootSweep(): Promise<void> {
    return this.enqueue(async () => {
      const vault = await this.detect();
      if (vault === null) {
        return;
      }
      await this.ensureWorktreesIgnored(vault);
      const snap = await this.snapshot();
      const protectedPaths = await this.liveWorktreePaths(vault, snap);
      const report = await cleanWorktrees(this.git, {
        repos: snap.repos,
        vaultPath: vault.path,
        fleetRoot: this.fleetRoot,
        protectedPaths,
        legacyOnly: true,
      });
      const runs = await this.fleetRecords();
      const bases = snap.repos.filter((r) => r.path !== null).map((r) => worktreeBaseFor(vault.path, r));
      const known = [
        ...runs.map((r) => r.worktreePath).filter((p) => p.trim() !== ''),
        ...protectedPaths,
      ];
      const orphans = await listOrphans(bases, known);
      const leftovers = await fsp
        .readdir(legacyWorktreeBase(this.fleetRoot), { withFileTypes: true })
        .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name))
        .catch(() => [] as string[]);
      if (
        report.removed.length > 0 ||
        report.keptDirty.length > 0 ||
        report.failed.length > 0 ||
        report.leftovers.length > 0 ||
        orphans.length > 0 ||
        leftovers.length > 0
      ) {
        this.host.log(
          `worktree boot sweep: migrated ${report.removed.length}, kept dirty ${report.keptDirty.length}` +
            `, swept ${report.leftovers.length}` +
            `, orphans ${orphans.length}, legacy leftovers ${leftovers.length}` +
            (report.failed.length > 0 ? `, failed ${report.failed.length}` : ''),
        );
      }
    });
  }

  /** The status note under the board (T-0044): where worktrees live,
   *  which folders are orphans, what still sits in the legacy root. */
  async worktreesStatus(): Promise<{
    base: string | null;
    orphans: readonly string[];
    legacyLeftovers: readonly string[];
  }> {
    const vault = await this.detect();
    if (vault === null) {
      return { base: null, orphans: [], legacyLeftovers: [] };
    }
    const snap = await this.snapshot();
    const runs = await this.fleetRecords();
    const bases = snap.repos.filter((r) => r.path !== null).map((r) => worktreeBaseFor(vault.path, r));
    const known = runs.map((r) => r.worktreePath).filter((p) => p.trim() !== '');
    const orphans = await listOrphans(bases, known);
    const legacyLeftovers = await fsp
      .readdir(legacyWorktreeBase(this.fleetRoot), { withFileTypes: true })
      .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name))
      .catch(() => [] as string[]);
    return {
      // The default base — a repo with a `worktrees:` override has its own.
      base: path.join(vault.path, WORKTREES_DIR),
      orphans,
      legacyLeftovers,
    };
  }

  /**
   * The repo's .gitignore covers the worktrees base and the ticket copies'
   * `_workcopy/` (ADR-0080, req-183: ensured, not documented — drifts on
   * new boards otherwise). One commit when it changes; never fails the caller.
   */
  private async ensureWorktreesIgnored(vault: EngineVault): Promise<void> {
    const location = await this.locate(vault.path);
    if (location === null) {
      return; // not a git repo — nothing to ignore in
    }
    const gitignore = path.join(location.root, '.gitignore');
    const current = await fsp.readFile(gitignore, 'utf8').catch(() => null);
    const next = withIgnoreEntries(current, reservedIgnoreEntries(location.prefix));
    if (next === null) {
      return;
    }
    try {
      await fsp.writeFile(gitignore, next, 'utf8');
      await this.git.commitPaths(location.root, ['.gitignore'], 'tickets: ignore the worktrees base and the working copies');
    } catch (error) {
      this.host.log(`ignoring the worktrees base failed: ${messageOf(error)}`, 'warn');
    }
  }

  /**
   * The ticket's most recent failed run's gate failure, or null (T-0048):
   * what a retry's instruction carries. The runs snapshot is the truth —
   * live from the runner, history from disk when it is down.
   */
  private async lastGateFailure(ticketId: string): Promise<string | null> {
    const runs = await this.fleet.runs().catch(() => [] as readonly RunInfo[]);
    const failed = runs
      .filter((r) => r.ticketId === ticketId && r.state === 'failed' && r.gateFailure !== null)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    return failed?.gateFailure ?? null;
  }

  // --- personas (ADR-0088, E3) ----------------------------------------

  /** The loader over the detected vault's host reads — one seam for every persona read. */
  private personaLoaderFor(vault: EngineVault) {
    return personaLoader((rel) => this.host.read(vault.id, rel));
  }

  /**
   * The persona directory listing (E3): every
   * `tickets/_meta/personas/<id>/persona.md` parsed through the loader,
   * sorted by id; [] when no personas live in the vault.
   */
  async listPersonas(): Promise<readonly Persona[]> {
    const vault = await this.detect();
    return vault === null ? [] : this.crewInOrder(vault, await this.host.listMarkdownFiles(vault.id));
  }

  /** Every persona of the vault's listing in the crew's order (req-258's `order:`). */
  private async crewInOrder(vault: EngineVault, files: readonly string[]): Promise<readonly Persona[]> {
    const loader = this.personaLoaderFor(vault);
    const ids: string[] = [];
    for (const file of files) {
      const match = /^tickets\/_meta\/personas\/([a-z0-9][a-z0-9-]{0,63})\/persona\.md$/.exec(file);
      if (match !== null) {
        ids.push(match[1]!);
      }
    }
    ids.sort();
    const personas: Persona[] = [];
    for (const id of ids) {
      const persona = await loader.load(id);
      if (persona !== null) {
        personas.push(persona);
      }
    }
    // req-258: the crew's order is `order:` in crew.md; a persona it does not name follows in pipeline order.
    const crewText = await this.host.read(vault.id, CREW_FILE).catch(() => null);
    return inCrewOrder(personas, crewOrderOf(crewText));
  }

  /** The persona directory's ids (the improvement loop's sweep list). */
  async listPersonaIds(): Promise<readonly string[]> {
    const personas = await this.listPersonas();
    return personas.map((p) => p.id);
  }

  /**
   * req-266: who a chain entry may name — the crew, and the human persona even before its file exists;
   * req-269: which of them take no mode (every persona that is not an agent — Mission Control's).
   */
  private async chainGuardIds(): Promise<{ readonly personas: readonly string[]; readonly modeless: readonly string[] }> {
    const personas = await this.listPersonas();
    const ids = personas.map((p) => p.id);
    return { personas: ids.includes(HUMAN_PERSONA_ID) ? ids : [...ids, HUMAN_PERSONA_ID], modeless: personas.filter((p) => !isAgentPersona(p)).map((p) => p.id) };
  }

  /**
   * The fleet ledger's raw text (`tickets/_meta/ledger.jsonl`); null
   * without a vault or a ledger — the aggregation happens at the callers
   * (the port's persona day costs), the service only reads the vault file.
   */
  async ledgerText(): Promise<string | null> {
    const vault = await this.detect();
    if (vault === null) {
      return null;
    }
    return this.readOptional(vault.id, LEDGER_FILE);
  }

  /**
   * The confirmed memory entry (E3 acceptance): one owner-confirmed
   * lesson appended to the persona's memory.md — the same store the
   * fleet's settle path writes through. Refuses unknown persona ids;
   * exactly one commit `personas: <id> memory +1` (a commit failure is
   * the usual warning, never a lost entry).
   */
  personaLearn(input: { id: string; entry: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      let id: string;
      try {
        id = personaRef(input.id);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      const loader = this.personaLoaderFor(vault);
      if ((await loader.load(id)) === null) {
        return { ok: false, error: `persona "${id}" does not exist — create tickets/_meta/personas/${id}/persona.md first` };
      }
      // One line, always: flatten what the dialog sent, bounded — the owner's line form (req-169).
      const entry = oneMemoryLine(input.entry) === '' ? '' : ownerLessonLine(today(), oneMemoryLine(input.entry));
      if (entry === '') {
        return { ok: false, error: 'a memory entry is one non-empty line' };
      }
      const path = memoryPathFor(id);
      try {
        await appendMemory(
          (rel) => this.host.read(vault.id, rel),
          (rel, text) => this.host.write(vault.id, rel, text),
          id,
          entry,
        );
      } catch (error) {
        return { ok: false, error: `memory write failed: ${messageOf(error)}` };
      }
      const warning = await this.commit(vault, [path], `personas: ${id} memory +1`);
      this.host.announceChanges(vault.id, [path]);
      this.announceChanged();
      return { ok: true, ...(warning === null ? {} : { warning }) };
    });
  }

  // --- persona memory read/pin, setup patch (U4, concept §4.4); the 1:1 is PersonaSessionService (req-168) ---

  /** The persona as the vault holds it (req-168: the 1:1 service reads it here); null when absent. */
  loadPersona(vault: EngineVault, id: string): Promise<Persona | null> {
    return this.personaLoaderFor(vault).load(id);
  }

  /**
   * The persona memory's read (U4, concept §4.4): the curated entries in
   * file order, each with its pin state — the same lines the context
   * pack's `## Memory` slice picks from, so an index here is the index
   * everywhere.
   */
  async personaMemory(personaId: string): Promise<PersonaMemoryReply> {
    let id: string;
    try {
      id = personaRef(personaId);
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
    const vault = await this.detect();
    if (vault === null) {
      return { ok: false, error: 'no tickets vault detected' };
    }
    if ((await this.personaLoaderFor(vault).load(id)) === null) {
      return { ok: false, error: personaMissing(id) };
    }
    const text = await this.readOptional(vault.id, memoryPathFor(id));
    return { ok: true, entries: describeMemoryEntries(text ?? '') };
  }

  /**
   * One owner-taught memory entry (U4): appended through the persona
   * store's path (the one writer), flattened to one line, one commit
   * `personas: <id> memory entry`.
   */
  personaMemoryAppend(input: { id: string; text: string }): Promise<PersonaMemoryReply> {
    return this.enqueue(async () => {
      let id: string;
      try {
        id = personaRef(input.id);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      if ((await this.personaLoaderFor(vault).load(id)) === null) {
        return { ok: false, error: personaMissing(id) };
      }
      const entry = oneMemoryLine(input.text) === '' ? '' : ownerLessonLine(today(), oneMemoryLine(input.text));
      if (entry === '') {
        return { ok: false, error: 'a memory entry is one non-empty line' };
      }
      const path = memoryPathFor(id);
      try {
        await appendMemory(
          (rel) => this.host.read(vault.id, rel),
          (rel, text) => this.host.write(vault.id, rel, text),
          id,
          entry,
        );
      } catch (error) {
        return { ok: false, error: `memory write failed: ${messageOf(error)}` };
      }
      const warning = await this.commit(vault, [path], `personas: ${id} memory entry`);
      this.host.announceChanges(vault.id, [path]);
      this.announceChanged();
      const text = await this.readOptional(vault.id, path);
      return { ok: true, entries: describeMemoryEntries(text ?? ''), ...(warning === null ? {} : { warning }) };
    });
  }

  /**
   * The pin toggle (U4, concept §4.4 — "gepflegtes Asset"): the entry at
   * `index` (its position in {@link personaMemory}'s list) gains or loses
   * its trailing ` [pinned]` marker, one commit
   * `personas: <id> memory pinned|unpinned`. An out-of-range index
   * refuses with a readable error — never a silent no-op.
   */
  personaMemoryPin(input: { id: string; index: number; pinned: boolean }): Promise<PersonaMemoryReply> {
    return this.enqueue(async () => {
      let id: string;
      try {
        id = personaRef(input.id);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      if ((await this.personaLoaderFor(vault).load(id)) === null) {
        return { ok: false, error: personaMissing(id) };
      }
      if (!Number.isInteger(input.index) || input.index < 0) {
        return { ok: false, error: "the index is the entry's position in the GET list (0-based)" };
      }
      const path = memoryPathFor(id);
      const text = await this.readOptional(vault.id, path);
      if (text === null || text.trim() === '') {
        return { ok: false, error: `persona "${id}" has no memory entries yet` };
      }
      const updated = toggleMemoryPin(text, input.index, input.pinned);
      if (updated === null) {
        return { ok: false, error: `no memory entry at index ${input.index}` };
      }
      try {
        await this.host.write(vault.id, path, updated);
      } catch (error) {
        return { ok: false, error: `write failed: ${messageOf(error)}` };
      }
      const warning = await this.commit(vault, [path], `personas: ${id} memory ${input.pinned ? 'pinned' : 'unpinned'}`);
      this.host.announceChanges(vault.id, [path]);
      this.announceChanged();
      return { ok: true, entries: describeMemoryEntries(updated), ...(warning === null ? {} : { warning }) };
    });
  }

  /**
   * The persona setup's PATCH (U4, concept §4.5 — the mirror to check,
   * the chat stays the primary way): only the sent keys are written onto
   * the parsed persona, the file rebuilt over `personaFileText` (the
   * owner's prose below the fence rides along), `prompt` additionally to
   * prompt.md — exactly one commit `personas: <id> updated` for both.
   */
  personaPatch(input: {
    id: string;
    title?: string;
    role?: string;
    class?: string;
    model?: string | null;
    color?: string;
    skills?: readonly string[];
    prompt?: string;
    summary?: string;
    budget?: number | null;
    allowed?: PersonaAllowedPatch;
    settings?: PersonaSettingsPatch;
    chatModel?: string | null;
  }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      let id: string;
      try {
        id = personaRef(input.id);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      if ((await this.personaLoaderFor(vault).load(id)) === null) {
        return { ok: false, error: personaMissing(id) };
      }
      const refusal = personaPatchError(input);
      if (refusal !== null) {
        return { ok: false, error: refusal };
      }
      const sent = (key: string): boolean =>
        input[key as keyof typeof input] !== undefined;
      if (!['title', 'role', 'class', 'model', 'color', 'skills', 'prompt', 'summary', 'budget', 'allowed', 'settings', 'chatModel'].some(sent)) {
        return { ok: true }; // nothing to change
      }
      const personaPath = `${PERSONAS_DIR}/${id}/persona.md`;
      const current = await this.host.read(vault.id, personaPath);
      const { body, hadFence } = splitFrontmatter(current);
      const persona = parsePersonaFile(id, current);
      const next: Persona = {
        ...withModelPatch(persona, input),
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.role !== undefined ? { role: input.role as Persona['role'] } : {}),
        ...(input.color !== undefined ? { color: input.color.trim() } : {}),
        ...(input.skills !== undefined ? { skills: input.skills.map((s) => s.trim()) } : {}),
        ...(input.summary !== undefined ? { summary: input.summary.replace(/\s+/g, ' ').trim() } : {}),
        ...(input.budget !== undefined ? { budget: input.budget } : {}),
        ...(input.allowed !== undefined ? { allowed: allowedAfter(persona.allowed, input.allowed) } : {}),
        ...(input.settings !== undefined ? { settings: settingsAfter(persona.settings, input.settings) } : {}),
        // req-293: Mission Control's persona's chat model; blank = the assistant's own (the line leaves the file).
        ...(input.chatModel !== undefined ? { chatModel: (input.chatModel ?? '').trim() === '' ? null : (input.chatModel ?? '').trim() } : {}),
      };
      const patched = personaFileText(next, hadFence ? body : undefined);
      const touched = [personaPath];
      try {
        await this.host.write(vault.id, personaPath, patched);
        if (input.prompt !== undefined) {
          const promptPath = `${PERSONAS_DIR}/${id}/prompt.md`;
          await this.host.write(vault.id, promptPath, input.prompt);
          touched.push(promptPath);
        }
      } catch (error) {
        return { ok: false, error: `write failed: ${messageOf(error)}` };
      }
      const warning = await this.commit(vault, touched, `personas: ${id} updated`);
      this.host.announceChanges(vault.id, touched);
      this.announceChanged();
      return { ok: true, ...(warning === null ? {} : { warning }) };
    });
  }

  /**
   * The owner's own persona (E10-6): `personas/you`, kind `human`, next to
   * Paul, Ben, Ralf and Tessa. Created once when absent (idempotent - an
   * existing file is the owner's and stays as written); its title is the
   * config `personas.humanName` ('You' by default) and is editable like
   * any persona's. One commit `tickets: you persona`. A failure logs.
   * Called where the persona is first shown (the Team list, the flow editor) -
   * never on a plain board refresh, so a vault nobody opens it in stays untouched.
   */
  /** The configured display name of the human persona (`personas.humanName`), 'You' when unset or blank. */
  private async humanNameOfConfig(): Promise<string> {
    return (((await this.host.configGet<string>('personas.humanName')) ?? '').trim()) || 'You';
  }

  /**
   * Renames the human persona (Settings -> Tickets -> Team, "Your name"): the persona file's
   * title is what every surface shows (column pins, Team, the flow editor, the phone), so the
   * rename is one `personaPatch`; a missing persona is created first. Blank = back to "You".
   * The caller stores the same name in config `personas.humanName` so new boards start with it.
   */
  async setHumanName(name: string): Promise<BoardMutationResult> {
    const title = name.trim() === '' ? 'You' : name.trim();
    await this.ensureHumanPersona();
    return this.personaPatch({ id: HUMAN_PERSONA_ID, title });
  }

  /** req-292: the human persona's shipped picture, copied where the persona is created; the paths written (none when a picture is there). */
  private async humanAvatar(vault: EngineVault): Promise<string[]> {
    const written = await this.options.avatars?.copyShipped(vault, HUMAN_PERSONA_ID).catch((error: unknown) => {
      this.host.log(`human persona picture failed: ${messageOf(error)}`, 'warn');
      return null;
    });
    return written === null || written === undefined ? [] : [written];
  }

  ensureHumanPersona(): Promise<void> {
    return this.enqueue(async () => {
      try {
        const vault = await this.detect();
        if (vault === null) {
          return;
        }
        const personaPath = `${PERSONAS_DIR}/${HUMAN_PERSONA_ID}/persona.md`;
        if ((await this.readOptional(vault.id, personaPath)) !== null) {
          return;
        }
        await this.host.write(vault.id, personaPath, personaFileText(humanPersona(await this.humanNameOfConfig())));
        const paths = [personaPath, ...(await this.humanAvatar(vault))];
        await this.commit(vault, paths, 'tickets: you persona');
        this.host.announceChanges(vault.id, paths);
        this.announceChanged();
      } catch (error) {
        this.host.log(`human persona setup failed: ${messageOf(error)}`, 'warn');
      }
    });
  }

  // --- the self-improvement loop (E6, concept §4.8) ---------------------

  /**
   * The E6 improvements card's data (concept §4.8): the persona's
   * improvements.md parsed tolerant-reader style, plus the open count
   * (the 1:1's work) and the friction count (findings still waiting for
   * an aggregation). A read — outside the single-writer queue; the
   * persona must exist, everything else tolerates absence.
   */
  async personaImprovements(personaId: string): Promise<PersonaImprovementsReply> {
    let id: string;
    try {
      id = personaRef(personaId);
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
    const vault = await this.detect();
    if (vault === null) {
      return { ok: false, error: 'no tickets vault detected' };
    }
    const persona = await this.personaLoaderFor(vault).load(id);
    if (persona === null) {
      return { ok: false, error: `persona "${id}" does not exist — create tickets/_meta/personas/${id}/persona.md first` };
    }
    const [improvementsText, journalText] = await Promise.all([
      this.readOptional(vault.id, improvementsPathFor(id)),
      this.readOptional(vault.id, journalPathFor(id)),
    ]);
    const improvements = parseImprovements(improvementsText ?? '');
    const proposals = improvements.proposals;
    return {
      ok: true,
      persona,
      proposals,
      openCount: proposals.filter((p) => p.state === 'open').length,
      frictionCount: journalFrictions(journalText ?? '', improvements.lastAggregation).length,
    };
  }

  /**
   * The aggregation's input (E6): the persona's raw friction findings,
   * the last aggregation stamp, and how many of this persona's fleet
   * records started since then (0 when never aggregated). A read —
   * tolerant everywhere, so an unknown persona or a missing vault reads
   * as an empty input rather than an error.
   */
  async improvementInput(personaId: string): Promise<ImprovementInput> {
    let id: string;
    try {
      id = personaRef(personaId);
    } catch {
      return { friction: [], lastAggregation: null, settledRuns: 0 };
    }
    const vault = await this.detect();
    if (vault === null) {
      return { friction: [], lastAggregation: null, settledRuns: 0 };
    }
    const [improvementsText, journalText, runs, prompt] = await Promise.all([
      this.readOptional(vault.id, improvementsPathFor(id)),
      this.readOptional(vault.id, journalPathFor(id)),
      this.fleetRecords().catch(() => [] as readonly RunInfo[]),
      this.readOptional(vault.id, `${PERSONAS_DIR}/${id}/prompt.md`),
    ]);
    const lastAggregation = parseImprovements(improvementsText ?? '').lastAggregation;
    const settledRuns =
      lastAggregation === null
        ? 0
        : runs.filter((run) => (run.persona ?? null) === id && run.startedAt > lastAggregation).length;
    return { friction: journalFrictions(journalText ?? '', lastAggregation), lastAggregation, settledRuns, prompt };
  }

  /**
   * The aggregation's write (E6): the validated drafts become open
   * proposals — ids minted from the file (`imp-<n>`, never reused), one
   * strict re-render, lastAggregation stamped (req-169: the journal is
   * never truncated; the stamp is where the next input starts). Exactly one commit `personas: <id> improvements +<n>`,
   * then the announcement.
   */
  applyAggregation(input: { id: string; drafts: readonly ImprovementDraft[]; now?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      let id: string;
      try {
        id = personaRef(input.id);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      if ((await this.personaLoaderFor(vault).load(id)) === null) {
        return { ok: false, error: `persona "${id}" does not exist — create tickets/_meta/personas/${id}/persona.md first` };
      }
      if (input.drafts.length === 0) {
        return { ok: true }; // nothing to aggregate — the files stay exactly as they are
      }
      const at = input.now ?? new Date().toISOString();
      const improvementsPath = improvementsPathFor(id);
      const existingText = (await this.readOptional(vault.id, improvementsPath)) ?? '';
      const file = parseImprovements(existingText);
      // The mint scans the raw text: even a hand-broken proposal's id is
      // never reused. The queue serializes, so the running max suffices.
      let next = Number(nextImprovementId(existingText).slice('imp-'.length));
      const added: ImprovementProposal[] = input.drafts.map((draft) => ({
        id: `imp-${next++}`,
        state: 'open',
        target: draft.target,
        title: draft.title,
        evidence: [...draft.evidence],
        content: draft.content,
        lesson: draft.lesson,
        at,
        decidedAt: null,
      }));
      // req-169: the journal stays whole — the new aggregation stamp is the cut the next input reads from.
      const touched = [improvementsPath];
      try {
        await this.host.write(vault.id, improvementsPath, renderImprovements(id, { lastAggregation: at, proposals: [...file.proposals, ...added] }));
      } catch (error) {
        return { ok: false, error: `write failed: ${messageOf(error)}` };
      }
      const warning = await this.commit(vault, touched, `personas: ${id} improvements +${added.length}`);
      this.host.announceChanges(vault.id, touched);
      this.announceChanged();
      return { ok: true, ...(warning === null ? {} : { warning }) };
    });
  }

  /**
   * The 1:1's decision (E6): an open proposal is accepted (the target
   * applies — prompt.md rewritten, models.default patched through the
   * yaml doc-mutation, memory appended as one line) or dismissed; a
   * non-null lesson lands in memory.md either way. Unknown or already
   * decided proposals refuse with a readable error; exactly one commit
   * `personas: <id> improvement <accepted|dismissed> (<proposalId>)`.
   */
  decideImprovement(input: { id: string; proposalId: string; decision: ImprovementDecision; now?: string }): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      let id: string;
      try {
        id = personaRef(input.id);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      if ((await this.personaLoaderFor(vault).load(id)) === null) {
        return { ok: false, error: `persona "${id}" does not exist — create tickets/_meta/personas/${id}/persona.md first` };
      }
      const improvementsPath = improvementsPathFor(id);
      const file = parseImprovements((await this.readOptional(vault.id, improvementsPath)) ?? '');
      const proposal = file.proposals.find((p) => p.id === input.proposalId) ?? null;
      if (proposal === null) {
        return { ok: false, error: `${input.proposalId} is not one of ${id}'s improvement proposals` };
      }
      if (proposal.state !== 'open') {
        return { ok: false, error: `${input.proposalId} is already ${proposal.state}` };
      }
      const at = input.now ?? new Date().toISOString();
      const touched = new Set<string>([improvementsPath]);
      const appendLesson = async (line: string): Promise<string | null> => {
        try {
          // The owner decided it: the owner's line form (req-169).
          await appendMemory(
            (rel) => this.host.read(vault.id, rel),
            (rel, text) => this.host.write(vault.id, rel, text),
            id,
            ownerLessonLine(at.slice(0, 10), oneMemoryLine(line)),
          );
          touched.add(memoryPathFor(id));
          return null;
        } catch (error) {
          return `memory write failed: ${messageOf(error)}`;
        }
      };
      if (input.decision === 'accepted') {
        try {
          if (proposal.target === 'prompt.md') {
            const promptPath = `${PERSONAS_DIR}/${id}/prompt.md`;
            await this.host.write(vault.id, promptPath, proposal.content);
            touched.add(promptPath);
          } else if (proposal.target === 'models.default') {
            const personaPath = `${PERSONAS_DIR}/${id}/persona.md`;
            const patched = patchPersonaDefaultModel(await this.host.read(vault.id, personaPath), proposal.content);
            await this.host.write(vault.id, personaPath, patched);
            touched.add(personaPath);
          } else {
            const failure = await appendLesson(proposal.content);
            if (failure !== null) {
              return { ok: false, error: failure };
            }
          }
        } catch (error) {
          return { ok: false, error: `write failed: ${messageOf(error)}` };
        }
      }
      if (proposal.lesson !== null) {
        const failure = await appendLesson(proposal.lesson);
        if (failure !== null) {
          return { ok: false, error: failure };
        }
      }
      const decided: ImprovementProposal = { ...proposal, state: input.decision, decidedAt: at };
      const paths = [...touched];
      try {
        await this.host.write(
          vault.id,
          improvementsPath,
          renderImprovements(id, { lastAggregation: file.lastAggregation, proposals: file.proposals.map((p) => (p.id === decided.id ? decided : p)) }),
        );
      } catch (error) {
        return { ok: false, error: `write failed: ${messageOf(error)}` };
      }
      const warning = await this.commit(vault, paths, `personas: ${id} improvement ${input.decision} (${proposal.id})`);
      this.host.announceChanges(vault.id, paths);
      this.announceChanged();
      return { ok: true, ...(warning === null ? {} : { warning }) };
    });
  }

  /** req-283: the project records alone (`_meta/projects/*.md`) — the vault MCP reads them at every call, the free session at its start. */
  async projectRecords(): Promise<readonly ProjectRecord[]> {
    const vault = await this.detect();
    if (vault === null) {
      return [];
    }
    const files = (await this.host.listMarkdownFiles(vault.id)).filter((p) => p.startsWith(`${PROJECTS_DIR}/`));
    return parseProjects(await this.readFiles(vault, files)).projects;
  }

  /**
   * The repositories settings listing (req-72): `_meta/repos.md`'s
   * entries exactly as they parse, the file's path for display.
   */
  async listRepos(): Promise<ReposListing> {
    const vault = await this.detect();
    if (vault === null) {
      return { file: null, repos: [], error: null };
    }
    const text = await this.readOptional(vault.id, REPOS_PATH);
    const parse = parseRepos(text);
    return {
      file: this.host.resolveAssetPath(vault.id, REPOS_PATH),
      repos: parse.repos,
      error: parse.error,
    };
  }

  /**
   * Writes `repos.md` from the settings page's entries (req-72): the
   * frontmatter regenerated, the owner's prose kept, one commit.
   */
  saveRepos(repos: readonly RepoRef[]): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const vault = await this.detect();
      if (vault === null) {
        return { ok: false, error: 'no tickets vault detected' };
      }
      const names = new Set<string>();
      for (const repo of repos) {
        if (repo.name.trim() === '') {
          return { ok: false, error: 'a repository needs a name' };
        }
        if (names.has(repo.name)) {
          return { ok: false, error: `two repositories named "${repo.name}"` };
        }
        names.add(repo.name);
        if (repo.url.trim() === '') {
          return { ok: false, error: `"${repo.name}" needs a url` };
        }
      }
      const before = await this.readOptional(vault.id, REPOS_PATH);
      const text = reposFileText(repos, reposProse(before));
      if (before === text) {
        return { ok: true };
      }
      try {
        await this.host.write(vault.id, REPOS_PATH, text);
      } catch (error) {
        return { ok: false, error: `write failed: ${messageOf(error)}` };
      }
      const warning = await this.commit(vault, [REPOS_PATH], 'tickets: repos.md update');
      this.host.announceChanges(vault.id, [REPOS_PATH]);
      this.announceChanged();
      return { ok: true, ...(warning === null ? {} : { warning }) };
    });
  }

  /** The native directory picker behind "Add from folder" (req-72) — the host's native dialog. */
  async pickFolder(): Promise<{ ok: boolean; path?: string }> {
    const chosen = await this.host.pickFolder('Folder with repositories');
    return chosen === null ? { ok: true } : { ok: true, path: chosen };
  }

  /** Probes a folder for git repositories (req-72) — the "Add from folder" seeds. */
  async scanRepos(folder: string): Promise<{ ok: true; candidates: readonly RepoCandidate[] } | { ok: false; error: string }> {
    try {
      const outcome = await scanRepoFolder(folder, (cwd, args) => this.git.run(cwd, args));
      return { ok: true, candidates: outcome.candidates };
    } catch (error) {
      return { ok: false, error: `the scan failed: ${messageOf(error)}` };
    }
  }

  /**
   * Every registered vault that carries a board (req-72): the projects —
   * one tickets repository each. The active one is what `detect()` picks:
   * the configured vault when it has a board, else the first that does.
   */
  async listProjects(): Promise<readonly ProjectRef[]> {
    const vaults = (await this.host.listVaults()).filter((v) => v.exists);
    const configured = await this.host.configGet<string>('vaultId');
    const ordered =
      configured === undefined
        ? vaults
        : [...vaults.filter((v) => v.id === configured), ...vaults.filter((v) => v.id !== configured)];
    const projects: ProjectRef[] = [];
    let activeSeen = false;
    for (const vault of ordered) {
      if ((await this.readOptional(vault.id, PIPELINE_PATH)) === null) {
        continue;
      }
      const active = !activeSeen;
      activeSeen = true;
      projects.push({ id: vault.id, name: vault.name, path: vault.path, active });
    }
    return projects;
  }

  /** Makes another project's board the active one (req-72); one config key. */
  async switchProject(id: string): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const vault = (await this.host.listVaults()).find((v) => v.id === id && v.exists);
      if (vault === undefined) {
        return { ok: false, error: 'no such vault' };
      }
      if ((await this.readOptional(id, PIPELINE_PATH)) === null) {
        return { ok: false, error: `"${vault.name}" holds no tickets board — tickets/_meta/pipeline.md is missing` };
      }
      await this.host.configSet('vaultId', id);
      this.announceChanged();
      return { ok: true };
    });
  }

  /** Opens the tickets folder in the OS file manager. */
  async openTicketsFolder(): Promise<BoardMutationResult> {
    const vault = await this.detect();
    if (vault === null) {
      return { ok: false, error: 'no tickets vault detected' };
    }
    const dir = this.host.resolveAssetPath(vault.id, 'tickets');
    if (dir === null) {
      return { ok: false, error: 'the folder is outside the vault' };
    }
    await fsp.mkdir(dir, { recursive: true }).catch(() => undefined);
    const failure = await this.host.revealPath(dir);
    return failure === '' ? { ok: true } : { ok: false, error: failure };
  }

  /**
   * E14-9b item 6: with no store configured, one is created beside the meta
   * vault — the engine's start calls this for an existing board, "Initialize
   * board" for a fresh one. Idempotent: the project's own reference (its
   * pipeline's `store:`), the machine-wide override, and a leftover store of
   * a half first start are adopted; a foreign directory is named.
   */
  async ensureFreshStore(): Promise<{ ok: true; store: string } | { ok: false; error: string }> {
    const vault = await this.detect();
    if (vault === null) {
      return { ok: false, error: 'no tickets board to create a store for' };
    }
    try {
      const store = await this.createStoreBeside(vault);
      this.announceChanged();
      return { ok: true, store };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  /**
   * Creates the store beside `vault` and anchors it in the project's
   * pipeline (`store:`, req-316). Whatever the resolved reference names is
   * adopted when it exists (the project's own store, a leftover of a half
   * first start); a remote reference is the project's own from the start;
   * a missing local store is created here — never a foreign one.
   */
  /**
   * Creates the store beside `vault` and anchors it in the project's
   * pipeline (`store:`, req-316). Whatever the resolved reference names is
   * adopted when it exists (the project's own store, a leftover of a half
   * first start); a remote reference is the project's own from the start;
   * a missing local store is created here — never a foreign one.
   */
  private async createStoreBeside(vault: EngineVault): Promise<string> {
    const settings = await this.refreshStore(vault);
    const dir = settings.dkStore;
    if (dir === '' || isRemoteStore(dir)) {
      return dir;
    }
    const existing = await fsp.readFile(path.join(dir, 'dricket.toml'), 'utf8').catch(() => null);
    if (existing !== null) {
      if (!isLifecycleStore(parseStoreStages(existing))) {
        throw new Error(`${dir} exists and is not a store on the lifecycle stages — set "store:" in the pipeline`);
      }
      return dir;
    }
    await initLifecycleStore(dir, { dkPath: settings.dkPath, git: (cwd, args) => this.git.run(cwd, args) });
    await this.writeStoreRef(vault, dir);
    return dir;
  }

  initialize(vaultId: string | null): Promise<BoardMutationResult> {
    return this.enqueue(async () => {
      const vaults = await this.host.listVaults();
      const target =
        vaults.find((v) => v.id === vaultId && v.exists) ??
        vaults.find((v) => v.active && v.exists) ??
        null;
      if (target === null) {
        return { ok: false, error: 'no vault to initialize the board in' };
      }
      if (await this.readOptional(target.id, PIPELINE_PATH) !== null) {
        return { ok: false, error: `vault "${target.name}" already has a tickets board` };
      }
      const humanPersonaPath = `${PERSONAS_DIR}/${HUMAN_PERSONA_ID}/persona.md`;
      try {
        // req-316: the fresh pipeline anchors the project's own store beside
        // the repository — the machine-wide `dk.store` never leaks in here.
        await this.host.write(target.id, PIPELINE_PATH, withStoreRef(DEFAULT_PIPELINE_TEXT, defaultStorePathOf(target.path)));
        await this.host.write(target.id, REPOS_PATH, DEFAULT_REPOS);
        await this.host.write(target.id, humanPersonaPath, personaFileText(humanPersona(await this.humanNameOfConfig())));
      } catch (error) {
        return { ok: false, error: `write failed: ${messageOf(error)}` };
      }
      const humanPaths = [humanPersonaPath, ...(await this.humanAvatar(target))];
      // The worktrees base is ignored from day one (ADR-0080: ensured,
      // not documented — one own commit when it changes something).
      await this.ensureWorktreesIgnored(target);
      const warning = await this.commit(
        target,
        [PIPELINE_PATH, REPOS_PATH, ...humanPaths],
        'tickets: initialize board',
      );
      this.host.announceChanges(target.id, [PIPELINE_PATH, REPOS_PATH, ...humanPaths]);
      // E14-9b item 6: "Initialize board" runs on dricket — the store beside the vault
      // comes with the board; its failure does not keep the board from initializing.
      let storeWarning: string | null = null;
      try {
        await this.createStoreBeside(target);
      } catch (error) {
        storeWarning = `the tickets store could not be created: ${messageOf(error)}`;
      }
      this.announceChanged();
      const notes = [warning, storeWarning].filter((part) => part !== null);
      // req-256: Paul, Ben, Ralf and Tessa follow the pipeline, in a commit of their own (never throws).
      await this.options.crewSeeder?.seed(target);
      return { ok: true, ...(notes.length === 0 ? {} : { warning: notes.join(' ') }) };
    });
  }

  onVaultEvent(event: EngineVaultChangeEvent): void {
    // A registry round may have moved the tickets vault itself.
    if (event.vaultId === undefined && event.kind === 'refresh') {
      this.gitLocations.clear();
    }
    this.announceChanged();
  }
}
