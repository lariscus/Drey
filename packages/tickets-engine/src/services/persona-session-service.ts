import type { PersonaMessage, PersonaProposalCommand, PersonaProposalDecision, PersonaThreadReply } from '../contracts/persona-session';
import { personaRef, type Persona } from '../core/persona';
import { parseWorkerValue } from '../fleet/assignment';
import { OneOnOneRequestBuilder } from '../fleet/one-on-one-request';
import type { CapabilityClass, ModelsReply, RunInfo, RunRequest, WorkerProviderId } from '../fleet/protocol';
import type { ApiTurnRunner } from './api-persona-turn';
import type { EngineVault } from './host';
import type { PersonaSessionContext } from './persona-session-context';
import type { OpenSession, PersonaSessionFiles } from './persona-session-files';
import { liveOneOnOneOf, sessionStateOf } from './persona-session-state';
import type { PersonaTurnWatcher, TurnOutcome } from './persona-turn-watcher';

/** The board as the 1:1 needs it: the vault, the personas, and the one write a card may make. */
export interface PersonaSessionBoard {
  detect(): Promise<EngineVault | null>;
  loadPersona(vault: EngineVault, id: string): Promise<Persona | null>;
  personaPatch(input: { readonly id: string; readonly prompt?: string; readonly skills?: readonly string[] }): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
}

/** The runner as the 1:1 needs it. */
export interface PersonaSessionFleet {
  runs(): Promise<readonly RunInfo[]>;
  start(request: RunRequest): Promise<{ readonly ok: true; readonly run: RunInfo } | { readonly ok: false; readonly error: string }>;
  send(runId: string, text: string): Promise<{ readonly ok: boolean; readonly error?: string }>;
  models?(): Promise<ModelsReply | null>;
}

export interface PersonaSessionServiceDeps {
  readonly board: PersonaSessionBoard;
  readonly fleet: PersonaSessionFleet;
  readonly files: PersonaSessionFiles;
  readonly context: PersonaSessionContext;
  readonly watcher: PersonaTurnWatcher;
  readonly bridge: ApiTurnRunner;
  /** The 1:1 changed on its own (a session started, an answer landed, a turn failed): clients read this session file again. */
  readonly onChanged: (file: string) => void;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

type Found = { readonly vault: EngineVault; readonly persona: Persona } | { readonly error: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The persona 1:1 (req-168, ADR-0093): the owner's line lands in the
 * persona's chat session file (one commit), goes to the persona's held
 * session — started quiet from the pool when none is held — or, for an
 * `api` persona, to the chat bridge; the answer lands in the file when the
 * turn ends (one commit) and the clients are told. A card's acceptance is
 * the only way a proposal reaches the persona's files.
 */
export class PersonaSessionService {
  private readonly answering = new Set<string>();
  private readonly failures = new Map<string, string>();
  private readonly work = new Set<Promise<void>>();
  private readonly builder = new OneOnOneRequestBuilder();

  constructor(private readonly deps: PersonaSessionServiceDeps) {}

  /** The conversation, its cards and the session's state; no file is created by a read. */
  async thread(personaId: string): Promise<PersonaThreadReply> {
    const found = await this.find(personaId);
    if ('error' in found) {
      return { ok: false, error: found.error };
    }
    return this.reply(found, await this.deps.files.current(found.vault, found.persona.id));
  }

  /** One owner line: written and committed now, answered in the background. */
  async send(personaId: string, text: string): Promise<PersonaThreadReply> {
    if (text.trim() === '') {
      return { ok: false, error: 'the message is empty' };
    }
    const found = await this.find(personaId);
    if ('error' in found) {
      return { ok: false, error: found.error };
    }
    const id = found.persona.id;
    if (this.answering.has(id)) {
      return { ok: false, error: `${found.persona.title} is still answering — wait for the answer` };
    }
    const before = await this.deps.files.open(found.vault, found.persona);
    const open = await this.deps.files.appendOwner(found.vault, before, text.trim());
    this.answering.add(id);
    this.failures.delete(id);
    this.track(this.answer(found, open, before.session.messages, text.trim()));
    return this.reply(found, open);
  }

  /** Accepts or dismisses one card; an accepted one is adopted through the persona patch. */
  async decide(personaId: string, proposalId: string, decision: PersonaProposalDecision): Promise<PersonaThreadReply> {
    const found = await this.find(personaId);
    if ('error' in found) {
      return { ok: false, error: found.error };
    }
    const open = await this.deps.files.current(found.vault, found.persona.id);
    const card = open?.session.proposals.find((p) => p.id === proposalId) ?? null;
    if (open === null || card === null || card.state !== 'pending') {
      return { ok: false, error: `no open proposal ${proposalId}` };
    }
    let outcome: string | null = null;
    if (decision === 'confirm') {
      const adopted = await this.adopt(found.persona, card.command);
      if (!adopted.ok) {
        return { ok: false, error: adopted.error };
      }
      outcome = adopted.outcome;
    }
    const decided = await this.deps.files.decide(found.vault, open, { id: proposalId, state: decision === 'confirm' ? 'confirmed' : 'dismissed', outcome });
    return this.reply(found, decided ?? open);
  }

  /** Resolves once no answer is on its way (docs/testing-flakes.md). */
  async idle(): Promise<void> {
    while (this.work.size > 0) {
      await Promise.all([...this.work]);
    }
  }

  private async adopt(persona: Persona, command: PersonaProposalCommand): Promise<{ ok: true; outcome: string } | { ok: false; error: string }> {
    const patch = command.kind === 'prompt' ? { id: persona.id, prompt: command.text } : { id: persona.id, skills: [...new Set([...persona.skills, command.skill])] };
    const result = await this.deps.board.personaPatch(patch);
    if (!result.ok) {
      return result;
    }
    return { ok: true, outcome: command.kind === 'prompt' ? 'prompt.md written' : `skill ${command.skill} added` };
  }

  private async answer(found: { vault: EngineVault; persona: Persona }, open: OpenSession, earlier: readonly PersonaMessage[], text: string): Promise<void> {
    const id = found.persona.id;
    let outcome: TurnOutcome;
    try {
      outcome = parseWorkerValue(found.persona.worker) === null ? await this.bridgeTurn(found, earlier, text) : await this.sessionTurn(found, open, earlier, text);
    } catch (error) {
      outcome = { ok: false, error: messageOf(error) };
    }
    try {
      if (outcome.ok) {
        await this.deps.files.appendAnswer(found.vault, open.file, outcome.text);
      } else {
        this.failures.set(id, outcome.error);
        this.deps.log(`1:1 with ${id}: ${outcome.error}`, 'warn');
      }
    } finally {
      this.answering.delete(id);
      this.deps.onChanged(open.file);
    }
  }

  /** An `api` persona: one bridge call with the brief as the system prompt. */
  private async bridgeTurn(found: { vault: EngineVault; persona: Persona }, earlier: readonly PersonaMessage[], text: string): Promise<TurnOutcome> {
    const system = await this.deps.context.brief(found.vault, found.persona, []);
    return this.deps.bridge({ system, history: earlier.map((m) => ({ role: m.role, text: m.text })), text });
  }

  /** A runner persona: the held session, else a fresh quiet one from the pool; the line sent; the turn awaited. */
  private async sessionTurn(found: { vault: EngineVault; persona: Persona }, open: OpenSession, earlier: readonly PersonaMessage[], text: string): Promise<TurnOutcome> {
    const live = liveOneOnOneOf(await this.deps.fleet.runs(), found.persona.id);
    const runId = live?.id ?? (await this.startSession(found, open, earlier));
    if (typeof runId !== 'string') {
      return runId;
    }
    this.deps.onChanged(open.file);
    const sent = await this.deps.fleet.send(runId, text);
    if (!sent.ok) {
      return { ok: false, error: sent.error ?? 'the session took no message' };
    }
    return this.deps.watcher.wait(runId);
  }

  private async startSession(found: { vault: EngineVault; persona: Persona }, open: OpenSession, earlier: readonly PersonaMessage[]): Promise<string | TurnOutcome> {
    const instruction = await this.deps.context.brief(found.vault, found.persona, earlier);
    const classOf = await this.classLookup();
    const built = this.builder.build({ persona: found.persona, ticketsVaultPath: found.vault.path, chatFile: open.file, instruction, origin: 'drey:1:1', classOf });
    if (!built.ok) {
      return { ok: false, error: built.error };
    }
    const started = await this.deps.fleet.start(built.request);
    return started.ok ? started.run.id : { ok: false, error: started.error };
  }

  /** The model table's class of a model, from the runner's `GET /models`; no table = no class asked. */
  private async classLookup(): Promise<(provider: WorkerProviderId, model: string | null) => CapabilityClass | null> {
    const models = (await this.deps.fleet.models?.().catch(() => null)) ?? null;
    return (provider, model) => models?.models.find((row) => row.provider === provider && row.model === model)?.class ?? null;
  }

  private async find(personaId: string): Promise<Found> {
    let id: string;
    try {
      id = personaRef(personaId);
    } catch (error) {
      return { error: messageOf(error) };
    }
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return { error: 'no tickets vault detected' };
    }
    const persona = await this.deps.board.loadPersona(vault, id);
    return persona === null ? { error: `persona "${id}" not found` } : { vault, persona };
  }

  private async reply(found: { persona: Persona }, open: OpenSession | null): Promise<PersonaThreadReply> {
    const id = found.persona.id;
    const runs = await this.deps.fleet.runs().catch(() => [] as readonly RunInfo[]);
    const state = sessionStateOf({ runs, persona: id, bridge: parseWorkerValue(found.persona.worker) === null, answering: this.answering.has(id) });
    const failure = this.failures.get(id);
    return {
      ok: true,
      messages: open?.session.messages ?? [],
      proposals: open?.session.proposals ?? [],
      ...(open !== null ? { file: open.file } : {}),
      ...state,
      ...(failure !== undefined ? { failure } : {}),
    };
  }

  private track(promise: Promise<void>): void {
    const tracked = promise.catch((error: unknown) => this.deps.log(`1:1 answer failed: ${messageOf(error)}`, 'warn')).finally(() => this.work.delete(tracked));
    this.work.add(tracked);
  }
}
