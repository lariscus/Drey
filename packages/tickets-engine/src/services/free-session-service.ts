import type { FreeSessionAsk, FreeSessionStartReply, SessionOptionsReply } from '../contracts/free-session';
import type { RepoRef } from '../contracts/repo-ref';
import { loadPersonaSkills, personaRef, type Persona } from '../core/persona';
import { expandShippedFragments } from '../core/prompt-file';
import { parseWorkerValue } from '../fleet/assignment';
import { composeFreeSessionBrief } from '../fleet/free-session-brief';
import { FreeSessionRequestBuilder } from '../fleet/free-session-request';
import type { CapabilityClass, ModelsReply, RunInfo, RunRequest, WorkerProviderId } from '../fleet/protocol';
import { isTicketRun } from '../fleet/protocol-session';
import { normalizedPath, SessionDirectoryRule } from '../fleet/session/session-directory-rule';
import type { CrewConfigService } from './crew-config-service';
import type { EngineHost, EngineVault } from './host';

/** The board as a free session needs it. */
export interface FreeSessionBoard {
  detect(): Promise<EngineVault | null>;
  listPersonas(): Promise<readonly Persona[]>;
  listRepos(): Promise<{ readonly repos: readonly RepoRef[] }>;
}

/** The runner as a free session needs it. */
export interface FreeSessionFleet {
  runs(): Promise<readonly RunInfo[]>;
  start(request: RunRequest): Promise<{ readonly ok: true; readonly run: RunInfo } | { readonly ok: false; readonly error: string }>;
  send(runId: string, text: string): Promise<{ readonly ok: boolean; readonly error?: string }>;
  models?(): Promise<ModelsReply | null>;
}

export interface FreeSessionServiceDeps {
  readonly board: FreeSessionBoard;
  readonly fleet: FreeSessionFleet;
  readonly crew: Pick<CrewConfigService, 'effective'>;
  readonly host: Pick<EngineHost, 'read'>;
  /** True = a folder, false = something else, null = nothing there (the Node adapter stats). */
  readonly isDirectory: (path: string) => Promise<boolean | null>;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

const LIVE = new Set(['starting', 'running', 'stopping']);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The free session (req-173, R12): the owner's "New session… persona,
 * folder, class" from the service window or the Crew tab, or Pia's card
 * once accepted. The directory is checked, the layers resolved (session
 * over vault over default), the request built and started through the
 * runner — the same pool, the persona's and the provider's ledgers, no
 * ticket allowance — and the owner's first line, when there is one, sent
 * with the brief. Released after idle like a 1:1.
 */
export class FreeSessionService {
  private readonly builder = new FreeSessionRequestBuilder();
  private readonly rule = new SessionDirectoryRule();

  constructor(private readonly deps: FreeSessionServiceDeps) {}

  async start(ask: FreeSessionAsk, origin: string): Promise<FreeSessionStartReply> {
    try {
      return await this.startChecked(ask, origin);
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  /** What the form offers: the personas that have a harness, the classes, the tickets vault and the repos' folders. */
  async options(): Promise<SessionOptionsReply> {
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return { ok: false, error: 'no tickets vault detected' };
    }
    const [personas, repos, crew, models] = await Promise.all([
      this.deps.board.listPersonas(),
      this.deps.board.listRepos().catch(() => ({ repos: [] as readonly RepoRef[] })),
      this.deps.crew.effective(vault),
      this.models(),
    ]);
    const classes = [...new Set((models?.models ?? []).map((row) => row.class))].sort();
    return {
      ok: true,
      personas: personas.filter((p) => p.kind !== 'human' && parseWorkerValue(p.worker) !== null).map((p) => ({ id: p.id, title: p.title, worker: p.worker })),
      classes,
      ticketsVault: vault.path,
      repos: repos.repos.filter((r) => r.path !== null).map((r) => ({ name: r.name, path: r.path! })),
      permissionMode: crew.permissionMode,
      defaultPersona: crew.defaultPersona,
    };
  }

  /** The block below Pia's board digest (req-173): the personas and folders a startSession card may name. */
  async promptContext(): Promise<string | null> {
    const options = await this.options().catch(() => null);
    if (options === null || !options.ok || options.personas.length === 0) {
      return null;
    }
    const personas = options.personas.map((p) => `${p.id} (${p.worker})`).join(', ');
    const folders = [`${options.ticketsVault} (the tickets repository)`, ...options.repos.map((r) => `${r.path} (${r.name})`)].join('; ');
    return `## Sessions you may propose\n\npersonas: ${personas}\nfolders: ${folders}`;
  }

  private async startChecked(ask: FreeSessionAsk, origin: string): Promise<FreeSessionStartReply> {
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return { ok: false, error: 'no tickets vault detected' };
    }
    const id = personaRef(ask.persona.trim());
    const persona = (await this.deps.board.listPersonas()).find((p) => p.id === id) ?? null;
    if (persona === null || persona.kind === 'human') {
      return { ok: false, error: `persona "${id}" not found` };
    }
    const runs = await this.deps.fleet.runs();
    const verdict = this.rule.check(ask.directory, {
      isDirectory: await this.deps.isDirectory(ask.directory.trim()),
      ticketsVault: vault.path,
      liveWorktrees: runs.filter((r) => isTicketRun(r) && LIVE.has(r.state)).map((r) => r.worktreePath),
    });
    if (!verdict.ok) {
      return verdict;
    }
    const request = await this.requestOf({ vault, persona, ask, origin, directory: verdict.directory, ticketsVault: verdict.ticketsVault });
    if (!request.ok) {
      return request;
    }
    const started = await this.deps.fleet.start(request.request);
    if (!started.ok) {
      return started;
    }
    this.deps.log(`free session ${started.run.id}: ${persona.id} in ${verdict.directory} (${request.request.permissionMode}), asked by ${origin}`);
    await this.sendFirst(started.run.id, ask.firstLine);
    return { ok: true, runId: started.run.id };
  }

  private async requestOf(at: { vault: EngineVault; persona: Persona; ask: FreeSessionAsk; origin: string; directory: string; ticketsVault: boolean }): Promise<{ ok: true; request: RunRequest } | { ok: false; error: string }> {
    const { vault, persona, ask } = at;
    const [crew, classOf, repos] = await Promise.all([this.deps.crew.effective(vault), this.classLookup(), this.deps.board.listRepos().catch(() => ({ repos: [] as readonly RepoRef[] }))]);
    const overrides = {
      ...(ask.permissionMode !== undefined ? { permissionMode: ask.permissionMode } : {}),
      ...(ask.model !== undefined ? { model: ask.model } : {}),
      ...(ask.poolClass !== undefined && ask.poolClass !== null ? { poolClass: ask.poolClass } : {}),
    };
    const permissionMode = overrides.permissionMode ?? crew.permissionMode;
    const instruction = await this.brief(vault, persona, { directory: at.directory, permissionMode, ticketsVault: at.ticketsVault });
    const repo = repos.repos.find((r) => r.path !== null && (normalizedPath(at.directory) + '/').startsWith(normalizedPath(r.path) + '/'));
    return this.builder.build({ persona, ticketsVaultPath: vault.path, directory: at.directory, instruction, origin: at.origin, crew, overrides, classOf, ...(repo?.profile !== undefined ? { profile: repo.profile } : {}) });
  }

  private async brief(vault: EngineVault, persona: Persona, where: { directory: string; permissionMode: RunRequest['permissionMode']; ticketsVault: boolean }): Promise<string> {
    const read = (rel: string): Promise<string | null> => this.deps.host.read(vault.id, rel).catch(() => null);
    const [prompt, skills] = await Promise.all([read(`tickets/_meta/personas/${persona.id}/prompt.md`), loadPersonaSkills(read, persona.id, persona.skills)]);
    return composeFreeSessionBrief({
      title: persona.title,
      role: persona.role,
      prompt: await expandShippedFragments(prompt ?? ''),
      skills: skills.skills.map((s) => ({ name: s.name, text: s.text })),
      workingDirectory: where.directory,
      permissionMode: where.permissionMode,
      ticketsVault: where.ticketsVault,
    });
  }

  private async sendFirst(runId: string, firstLine: string | undefined): Promise<void> {
    const text = firstLine?.trim() ?? '';
    if (text === '') {
      return;
    }
    const sent = await this.deps.fleet.send(runId, text).catch((error: unknown) => ({ ok: false, error: messageOf(error) }));
    if (!sent.ok) {
      this.deps.log(`free session ${runId}: the first line did not reach the worker — ${sent.error ?? 'refused'}`, 'warn');
    }
  }

  private async models(): Promise<ModelsReply | null> {
    return (await this.deps.fleet.models?.().catch(() => null)) ?? null;
  }

  /** The model table's class of a model (the runner's `GET /models`); no table = no class asked. */
  private async classLookup(): Promise<(provider: WorkerProviderId, model: string | null) => CapabilityClass | null> {
    const models = await this.models();
    return (provider, model) => models?.models.find((row) => row.provider === provider && row.model === model)?.class ?? null;
  }
}
