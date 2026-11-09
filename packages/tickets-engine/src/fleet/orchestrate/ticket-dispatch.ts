import type { BoardSnapshot, PipelinePhase, RepoRef, TicketCard } from '../../contracts/tickets';
import { splitPoolEntry } from '../../core/persona';
import { TicketsGit } from '../../core/tickets-git';
import { isAutoPhase, nextPhaseIdOf } from '../chain';
import { readRepoInstructions, worktreeDiffStat } from '../context-pack';
import { dkTargetFor } from '../dk-target';
import { DEFAULT_FLEET_CAPS, type ChainConfig, type ClassRequest, type PoolGrantDecision, type RunRequest } from '../protocol';
import { composeRunRequest } from '../request';
import { worktreePathFor } from '../worktree-home';
import type { BoardPersonas, TicketPersona } from './board-personas';
import type { ChainBoard } from './chain-board';
import type { DispatchPrompt, PromptSource } from './prompt-source';
import type { FleetLedger } from './settled-runs';
import type { SupervisorDirectory } from './supervisor-directory';
import type { WaitNotes } from './wait-notes';

export type DispatchOutcome = 'dispatched' | 'refused' | 'skipped';

/** The capacity pool's grant for a dispatch (req-170): what was asked and what it granted. */
export interface PoolGrantFor {
  readonly request: ClassRequest;
  readonly decision: PoolGrantDecision;
}

/** One planned dispatch: the card, the column it works in, and what the pass resolved for it. */
export interface PlannedDispatch {
  readonly card: TicketCard;
  readonly workingPhaseId: string;
  readonly persona: TicketPersona | null;
  /** req-170: the pool's grant; null without a pool (or on a ring dispatch). */
  readonly grant: PoolGrantFor | null;
}

export interface TicketDispatchDeps {
  readonly board: ChainBoard;
  readonly directory: SupervisorDirectory;
  readonly personas: BoardPersonas;
  readonly prompts: PromptSource;
  readonly notes: WaitNotes;
  readonly log: (message: string) => void;
  readonly events?: FleetLedger;
}

/** The harness and model a persona runs: the pool's grant (req-170), else the persona's default. */
function harnessOf(persona: { readonly worker: string; readonly models: { readonly default: string } }, grant: PoolGrantFor | null): { worker: string; model: string } {
  const fallback = splitPoolEntry(persona.models.default);
  const granted = grant?.decision ?? null;
  if (granted === null) {
    return { worker: fallback.provider ?? persona.worker, model: fallback.model };
  }
  return { worker: granted.provider, model: granted.model ?? fallback.model };
}

/** The request's pool fields: the class asked for, why, what the ledgers need, and (req-178) the needs and the routing's decision. */
function poolParts(grant: PoolGrantFor | null): Pick<RunRequest, 'poolClass' | 'poolWhy' | 'ledger' | 'poolNeeds' | 'poolRoute'> {
  if (grant === null) {
    return {};
  }
  const { request, decision } = grant;
  return {
    ...(request.class !== null ? { poolClass: request.class } : {}),
    poolWhy: request.why,
    ledger: request.ledger,
    ...(request.needs !== undefined && request.needs !== null ? { poolNeeds: request.needs } : {}),
    ...(decision.route !== undefined ? { poolRoute: decision.route } : {}),
  };
}

/** What the repo side of a dispatch resolved to. */
interface Target {
  readonly phase: PipelinePhase;
  readonly repo: RepoRef | null;
  readonly extraRepos: readonly RepoRef[];
}

/**
 * One planned dispatch (M85, E3, E8, E10-6): the repos, the instruction
 * base, the manual step after the gate, the ticket's text from the store,
 * the context pack (T-0048), the composed request and the start. A skip is
 * said once per ticket and reason.
 */
export class TicketDispatch {
  constructor(private readonly deps: TicketDispatchDeps) {}

  async dispatch(config: ChainConfig, snap: BoardSnapshot, planned: PlannedDispatch): Promise<DispatchOutcome> {
    const { card } = planned;
    const ready = await this.ready(config, snap, planned);
    if (ready === null) {
      return 'skipped';
    }
    const parkFor = await this.deps.personas.manualParkFor(config, snap, card, planned.workingPhaseId);
    const composed = composeRunRequest(await this.input(config, snap, planned, { ...ready, parkFor }));
    if (!composed.ok) {
      this.deps.notes.skip(card.id, `dispatch skips ${card.id}: ${composed.error}`);
      return 'skipped';
    }
    for (const truncation of composed.truncations) {
      this.deps.log(`instruction: ${card.id} ${truncation.section} truncated: true, originalSize ${truncation.originalSize}`);
    }
    return this.start(planned, { ...composed.request, ...poolParts(planned.grant) }, composed.persona);
  }

  /** The target, the instruction base and the ticket's text; null (said once) when one of them is missing. */
  private async ready(config: ChainConfig, snap: BoardSnapshot, planned: PlannedDispatch): Promise<{ target: Target; prompt: DispatchPrompt; text: string } | null> {
    const { card } = planned;
    const target = this.target(snap, card, planned.workingPhaseId);
    const prompt = target === null ? null : await this.deps.prompts.promptFor(config, card, target.phase, planned.persona);
    if (target === null || prompt === null) {
      return null;
    }
    const text = await this.deps.board.cardText(config, card);
    if (text === null) {
      this.deps.notes.skip(card.id, `dispatch skips ${card.id}: the ticket could not be read from the store`);
      return null;
    }
    return { target, prompt, text };
  }

  private async start(planned: PlannedDispatch, request: RunRequest, persona: string | null): Promise<DispatchOutcome> {
    const { card, workingPhaseId, grant } = planned;
    const outcome = await this.deps.directory.start(request, { persona });
    if (!outcome.ok) {
      this.deps.notes.skip(card.id, `dispatch refused ${card.id}: ${outcome.error}`);
      return 'refused';
    }
    const choice = grant !== null ? ` — ${grant.decision.reason}` : '';
    const model = request.model !== null ? `/${request.model}` : '';
    const who = `${persona !== null ? `, persona ${persona}` : ''}${request.form === 'scout' ? ', scout' : ''}`;
    this.deps.log(`dispatched ${card.id} (${workingPhaseId} pool, ${request.provider}${model}${who}) as ${outcome.run.id}${choice}`);
    this.deps.events?.ledger({ kind: 'dispatched', ticket: card.id, persona, model: request.model });
    this.deps.notes.clear(card.id);
    return 'dispatched';
  }

  /** The working phase and the repos; a scout ticket may name none (E8), a named one must resolve — a typo is a skip, never a guess. */
  private target(snap: BoardSnapshot, card: TicketCard, workingPhaseId: string): Target | null {
    const phase = snap.pipeline.find((p) => p.id === workingPhaseId) ?? null;
    const repo = card.meta.repo === null ? null : (snap.repos.find((r) => r.name === card.meta.repo) ?? null);
    const scout = (card.meta.form ?? 'ship') === 'scout';
    if (phase === null || (repo === null && !scout)) {
      this.deps.notes.skip(card.id, `dispatch skips ${card.id}: ${repo === null ? `repo "${card.meta.repo ?? ''}" is not in repos.md` : 'unknown working phase'}`);
      return null;
    }
    const extraRepos = this.extraRepos(snap, card, repo);
    return extraRepos === null ? null : { phase, repo, extraRepos };
  }

  /** req-72: the ticket's further repos, resolved like the primary's — an unknown name skips the dispatch. */
  private extraRepos(snap: BoardSnapshot, card: TicketCard, repo: RepoRef | null): readonly RepoRef[] | null {
    const extras: RepoRef[] = [];
    for (const name of card.meta.repos.filter((n) => repo === null || n !== repo.name)) {
      const extra = snap.repos.find((r) => r.name === name) ?? null;
      if (extra === null) {
        this.deps.notes.skip(card.id, `dispatch skips ${card.id}: repo "${name}" is not in repos.md`);
        return null;
      }
      extras.push(extra);
    }
    return extras;
  }

  /** The composer's input: the move or the park after the gate, the context pack, the persona's pins. */
  private async input(config: ChainConfig, snap: BoardSnapshot, planned: PlannedDispatch, got: { target: Target; prompt: DispatchPrompt; text: string; parkFor: string | null }): Promise<Parameters<typeof composeRunRequest>[0]> {
    const { card, workingPhaseId } = planned;
    const { target, parkFor } = got;
    // E10-6: a manual step after this gate parks the ticket on a green gate — it moves only as far as the working column.
    const nextPhaseId = parkFor !== null ? (card.phase !== workingPhaseId ? workingPhaseId : null) : nextPhaseIdOf(snap.columns, workingPhaseId);
    const context = await this.context(config, card, target.repo, workingPhaseId);
    return {
      card,
      ticketText: got.text,
      vaultPath: config.ticketsVaultPath,
      workingPhase: target.phase,
      nextPhaseId,
      nextPhaseDir: nextPhaseId, // a store has no phase folders: the stage is the phase id
      pushRemote: snap.pushRemote,
      ...(snap.closingSignals !== undefined ? { closingSignals: snap.closingSignals } : {}),
      nextPhaseClaims: nextPhaseId !== null && snap.pipeline.find((p) => p.id === nextPhaseId)?.claim === true,
      repo: target.repo,
      extraRepos: [...target.extraRepos],
      promptText: got.prompt.promptText,
      defaultWorker: config.defaultWorker,
      permissionMode: config.permissionMode,
      gitPath: config.git,
      workerChoice: null,
      ...context,
      origin: 'chain',
      caps: config.caps ?? DEFAULT_FLEET_CAPS,
      // The pipeline's first worker column takes in fresh tickets: it gates structurally (the plan WRITES the criteria).
      structuralGateAllowed: snap.pipeline.find((p) => isAutoPhase(p))?.id === workingPhaseId,
      dispatchedBy: workingPhaseId,
      parkFor,
      ...(config.store !== undefined ? { dk: dkTargetFor(config.store, snap.pipeline, workingPhaseId) } : {}),
      handover: 'auto', // the supervisor's rules decide (T-0049); the dialog is the only place a mode is chosen
      ...this.personaPins(planned, got.prompt),
    };
  }

  /** The context pack (T-0048): the repo's instructions, the worktree's diff stat and a retry's gate failure; a scout run has neither worktree nor gate. */
  private async context(config: ChainConfig, card: TicketCard, repo: RepoRef | null, workingPhaseId: string): Promise<{ repoInstructions: string | null; diffStat: string | null; gateFailure: string | null }> {
    const scout = (card.meta.form ?? 'ship') === 'scout';
    const repoInstructions = repo !== null && repo.path !== null ? await readRepoInstructions(repo.path, repo.instructions) : null;
    const gateFailure = scout ? null : this.deps.directory.lastGateFailure(card.id, workingPhaseId);
    const diffStat =
      scout || repo === null || repo.path === null ? null : await worktreeDiffStat(new TicketsGit(() => config.git), worktreePathFor(config.ticketsVaultPath, repo, card.id), repo.branch);
    if (!scout && gateFailure !== null && diffStat === null) {
      this.deps.log(`instruction: ${card.id} diff stat unavailable (no worktree yet)`); // a retry expects to continue existing work
    }
    return { repoInstructions, diffStat, gateFailure };
  }

  /** E3: a loaded persona's harness/model pins (beating the ring), its instruction base and memory slice. */
  private personaPins(planned: PlannedDispatch, prompt: DispatchPrompt): { persona?: NonNullable<Parameters<typeof composeRunRequest>[0]['persona']> } {
    const entry = planned.persona;
    const persona = entry?.persona ?? null;
    if (persona === null) {
      return {};
    }
    return {
      persona: {
        id: persona.id,
        role: persona.role,
        ...harnessOf(persona, planned.grant),
        prompt: prompt.personaPrompt,
        memory: entry?.memory ?? '',
        skills: entry?.skills ?? [],
      },
    };
  }
}
