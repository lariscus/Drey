import type { PersonaMessage } from '../contracts/persona-session';
import { isHumanPersona, loadPersonaSkills, PERSONAS_DIR, type Persona } from '../core/persona/persona';
import { expandShippedFragments } from '../core/config/prompt-file';
import { BRIEF_RUNS, composeOneOnOneBrief, type BriefRun } from '../fleet/session/one-on-one-brief';
import { NO_TOOLS, type OneOnOneToolSeam } from '../fleet/session/one-on-one-toolset';
import type { RunInfo, WorkerProviderId } from '../fleet/protocol';
import { isTicketRun } from '../fleet/protocol-session';
import type { EngineHost, EngineVault } from './host';

export interface PersonaSessionContextDeps {
  readonly host: EngineHost;
  readonly runs: () => Promise<readonly RunInfo[]>;
  /** The crew's records, read fresh — the mission persona's brief carries the owner's instructions from them (req-315). */
  readonly personas?: () => Promise<readonly Persona[]>;
  /** The tools attached to a 1:1 (req-217: the service's vault MCP); absent = none. */
  readonly tools?: OneOnOneToolSeam;
}

/** The persona's latest ticket runs, newest first — never its 1:1s or free sessions. */
export function latestRunsOf(runs: readonly RunInfo[], persona: string): readonly BriefRun[] {
  return runs
    .filter((r) => r.persona === persona && isTicketRun(r))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, BRIEF_RUNS)
    .map((r) => ({ ticketId: r.ticketId, state: r.state, costUsd: r.costUsd, gateFailure: r.gateFailure, model: r.grant?.model ?? r.model ?? null }));
}

/**
 * The context of a persona's 1:1 (req-168, R2) read from the tickets vault
 * and the run records: `persona.md`, `prompt.md`, the skills, `memory.md`
 * when it exists (read, never written here), the conversation so far and
 * the latest runs — composed into the one brief the session gets with the
 * owner's first line.
 */
export class PersonaSessionContext {
  constructor(private readonly deps: PersonaSessionContextDeps) {}

  /** `provider`: the harness the session runs on (req-288: it follows from the model); null = none known. */
  async brief(vault: EngineVault, persona: Persona, conversation: readonly PersonaMessage[], provider: WorkerProviderId | null = null): Promise<string> {
    const read = (rel: string): Promise<string | null> => this.deps.host.read(vault.id, rel).catch(() => null);
    const folder = `tickets/_meta/personas/${persona.id}`;
    const [prompt, memory, skills, runs, owner] = await Promise.all([
      read(`${folder}/prompt.md`),
      read(`${folder}/memory.md`),
      loadPersonaSkills(read, persona.id, persona.skills),
      this.deps.runs().catch(() => [] as readonly RunInfo[]),
      this.ownerOf(vault, persona),
    ]);
    return composeOneOnOneBrief({
      id: persona.id,
      title: persona.title,
      // req-294: Mission Control's persona carries no crew role ("custom"); her 1:1 names what she is.
      role: persona.kind === 'mission' ? 'Mission Control persona' : persona.role,
      prompt: await expandShippedFragments(prompt ?? ''),
      skills: skills.skills.map((s) => ({ name: s.name, text: s.text })),
      memory,
      runs: latestRunsOf(runs, persona.id),
      conversation: conversation.map((m) => ({ role: m.role, text: m.text })),
      tools: (this.deps.tools ?? NO_TOOLS).attached({ persona: persona.id, provider }),
      workingDirectory: vault.path,
      ...(owner === null ? {} : { owner }),
    });
  }

  /**
   * req-315: the owner's own instructions for Mission Control's persona's brief — the human persona's `prompt.md`,
   * found by `kind: human` (never by name); null for every other persona's brief, or when the owner wrote none.
   */
  private async ownerOf(vault: EngineVault, persona: Persona): Promise<{ readonly title: string; readonly prompt: string } | null> {
    if (this.deps.personas === undefined || persona.kind !== 'mission') {
      return null;
    }
    const human = await this.deps
      .personas()
      .then((personas) => personas.find((candidate) => isHumanPersona(candidate)))
      .catch(() => undefined);
    if (human === undefined) {
      return null;
    }
    const prompt = ((await this.deps.host.read(vault.id, `${PERSONAS_DIR}/${human.id}/prompt.md`).catch(() => '')) ?? '').replace(/\r\n/g, '\n').trim();
    return prompt === '' ? null : { title: human.title, prompt };
  }
}
