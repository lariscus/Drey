import { ticketProject } from '../../contracts/projects';
import type { BoardSnapshot, PipelinePhase, RepoRef, TicketCard } from '../../contracts/tickets';
import { personaModelGuess, personaRunAllowedOf, splitPoolEntry, type Persona } from '../../core/persona/persona';
import { personaRunSettingsOf } from '../../core/persona/persona-settings';
import { TicketsGit } from '../../core/git/tickets-git';
import { chainWorkingPhase } from './holder-plan';
import { readRepoInstructions, worktreeDiffStat } from '../telemetry/context-pack';
import { dkTargetFor } from '../lease/dk-target';
import { DEFAULT_FLEET_CAPS, type ChainConfig, type ClassRequest, type PoolGrantDecision, type RunCursor, type RunRequest } from '../protocol';
import { runCursorOf } from '../runner/run-cursor';
import { composeRunRequest } from '../runner/request';
import type { DisciplineTexts } from '../runner/discipline-texts';
import { worktreePathFor } from '../worktrees/worktree-home';
import type { BoardPersonas, TicketPersona } from './board-personas';
import { DEFAULT_MAX_RED } from './breaker';
import type { ChainBoard } from './chain-board';
import type { DispatchPrompt, PromptSource } from '../runner/prompt-source';
import type { FleetLedger } from '../runner/settled-runs';
import type { SupervisorDirectory } from '../runner/supervisor-directory';
import type { WaitNotes } from '../runner/wait-notes';

export type DispatchOutcome = 'dispatched' | 'refused' | 'skipped';

/** The capacity pool's grant for a dispatch (req-170): what was asked and what it granted. */
export interface PoolGrantFor {
  readonly request: ClassRequest;
  readonly decision: PoolGrantDecision;
}

/** One planned dispatch: the card, the column it stands in, and what the pass resolved for it. */
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
  /**
   * The discipline texts the briefs end with (req-279: the files in
   * `prompts/disciplines/`) — a provider, cached after its first call;
   * the composition root passes the file loader (or a spec a fixture).
   */
  readonly disciplines: () => Promise<DisciplineTexts>;
}

/**
 * The harness and model a persona runs: the pool's grant (req-170); without a
 * pool its pinned model (req-288), else an unmigrated record's old default,
 * else '' — a worker the assignment ring then decides.
 */
function harnessOf(persona: Persona, grant: PoolGrantFor | null): { worker: string; model: string } {
  const pinned = persona.model === null ? null : splitPoolEntry(persona.model);
  const granted = grant?.decision ?? null;
  if (granted !== null) {
    return { worker: granted.provider, model: granted.model ?? pinned?.model ?? '' };
  }
  const guess = personaModelGuess(persona);
  return { worker: guess?.provider ?? '', model: guess?.model ?? '' };
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
 * One planned dispatch (M85, E3, E8, req-257): the repos, the instruction
 * base (the persona's prompt), the chain's cursor, the ticket's text from the
 * store, the context pack (T-0048), the composed request and the start. A skip
 * is said once per ticket and reason.
 */
export class TicketDispatch {
  private disciplinesOnce: Promise<DisciplineTexts> | null = null;

  constructor(private readonly deps: TicketDispatchDeps) {}

  /** The discipline texts, loaded once (the provider is the file loader by default). */
  private disciplines(): Promise<DisciplineTexts> {
    this.disciplinesOnce ??= this.deps.disciplines();
    return this.disciplinesOnce;
  }

  async dispatch(config: ChainConfig, snap: BoardSnapshot, planned: PlannedDispatch): Promise<DispatchOutcome> {
    const { card } = planned;
    const ready = await this.ready(config, snap, planned);
    if (ready === null) {
      return 'skipped';
    }
    const composed = composeRunRequest(await this.input(config, snap, planned, ready));
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
    const prompt = target === null ? null : this.deps.prompts.promptFor(card, planned.persona);
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
    const phase = chainWorkingPhase(snap.pipeline, workingPhaseId);
    const repo = card.meta.repo === null ? null : (snap.repos.find((r) => r.name === card.meta.repo) ?? null);
    const scout = (card.meta.form ?? 'ship') === 'scout';
    if (repo === null && !scout) {
      this.deps.notes.skip(card.id, `dispatch skips ${card.id}: repo "${card.meta.repo ?? ''}" is not in repos.md`);
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

  /** The composer's input: the cursor, the context pack, the persona's pins. */
  private async input(config: ChainConfig, snap: BoardSnapshot, planned: PlannedDispatch, got: { target: Target; prompt: DispatchPrompt; text: string }): Promise<Parameters<typeof composeRunRequest>[0]> {
    const { card, workingPhaseId } = planned;
    const { target } = got;
    // req-257: a run hands on by its cursor (the column follows the holder), never by a move.
    const cursor = await this.cursorOf(config, card, { phase: target.phase, proposeFlow: snap.proposeFlow === true });
    const context = await this.context(config, card, target.repo, cursor.at);
    return {
      disciplines: await this.disciplines(),
      card,
      ticketText: got.text,
      vaultPath: config.ticketsVaultPath,
      workingPhase: target.phase,
      ...(snap.closingSignals !== undefined ? { closingSignals: snap.closingSignals } : {}),
      repo: target.repo,
      extraRepos: [...target.extraRepos],
      promptText: null,
      defaultWorker: config.defaultWorker,
      permissionMode: config.permissionMode,
      gitPath: config.git,
      workerChoice: null,
      ...context,
      origin: 'chain',
      caps: config.caps ?? DEFAULT_FLEET_CAPS,
      // req-257: the persona's `gate` decides alone (req-258).
      cursor,
      dispatchedBy: workingPhaseId,
      ...(config.store !== undefined ? { dk: dkTargetFor(config.store, snap.pipeline) } : {}),
      handover: 'auto', // the supervisor's rules decide (T-0049); the dialog is the only place a mode is chosen
      project: ticketProject(card.meta.project, snap.projects ?? []), // req-282: its purpose rides the brief
      ...this.personaPins(planned, got.prompt),
    };
  }

  /**
   * req-257: the chain entry the run works — position, the entries, the send-back used, the crew a plan run's `### Chain` may name
   * (E10-5b: and whether every plan proposes one);
   * req-78: the red-gate loop — where a green end returns, the loop's count and bound, and the red gate that sent the ticket here.
   */
  private async cursorOf(config: ChainConfig, card: TicketCard, run: { readonly phase: PipelinePhase; readonly proposeFlow: boolean }): Promise<RunCursor> {
    const chain = card.meta.chain ?? [];
    const { returnTo, redBacks } = card.meta;
    const from = returnTo !== undefined && returnTo > (card.meta.at ?? 1) ? returnTo : null;
    const redBack = from === null ? undefined : { from, persona: chain[from - 1]?.persona ?? '?', failure: this.deps.directory.lastGateFailureAt(card.id, from) };
    const redLoop = { ...(returnTo !== undefined ? { returnTo } : {}), ...(redBacks !== undefined ? { redBacks } : {}), maxRed: DEFAULT_MAX_RED, ...(redBack !== undefined ? { redBack } : {}) };
    return runCursorOf({ chain, at: card.meta.at, sentBack: card.meta.sentBack, crew: await this.deps.personas.crewGuard(config), redLoop, proposeFlow: run.proposeFlow });
  }

  /** The context pack (T-0048): the repo's instructions, the worktree's diff stat and a retry's gate failure (the run's own position's — req-78); a scout run has neither worktree nor gate. */
  private async context(config: ChainConfig, card: TicketCard, repo: RepoRef | null, position: number): Promise<{ repoInstructions: string | null; diffStat: string | null; gateFailure: string | null }> {
    const scout = (card.meta.form ?? 'ship') === 'scout';
    const repoInstructions = repo !== null && repo.path !== null ? await readRepoInstructions(repo.path, repo.instructions) : null;
    const directory = this.deps.directory;
    const gateFailure = scout ? null : directory.lastGateFailureAt(card.id, position);
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
        run: personaRunSettingsOf(persona),
        allowed: personaRunAllowedOf(persona),
      },
    };
  }
}
