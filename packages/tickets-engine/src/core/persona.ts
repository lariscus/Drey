import { parseDocument } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';
import { EMPTY_PERSONA_SETTINGS, personaSettingsLines, personaSettingsOf, type PersonaSettings } from './persona-settings';

/**
 * Personas (ADR-0088, E3 — the concept's §4): a named agent is role +
 * behaviour + model + memory in one, stored as a directory per persona in
 * the tickets repo:
 *
 *   tickets/_meta/personas/
 *     paul/
 *       persona.md   # frontmatter: title, role, worker, models, color, skills, budget
 *       prompt.md    # the persona prompt (longform, editable, versioned)
 *       memory.md    # curated memory (the write/read paths are E3)
 *       avatar.png   # optional
 *
 * The resolution ladder collapses the old five-level assignment ring
 * (ticket pin > column > handover > repo > default) into three:
 *
 *   Ticket-Pin (`persona:` im Frontmatter)
 *     → Phasen-Persona (`persona:` in pipeline.md)
 *       → Default-Persona (engine config `personas.default`)
 *
 * A persona's `models.default` + `models.pool` replace the separate
 * `worker:`/`model:`/`prompt:` keys — the model is configuration, not
 * identity (concept §4.6). The old column keys stay readable while the
 * migration rewrites them onto personas, then they are deprecated.
 */

export type PersonaRole = 'planner' | 'builder' | 'reviewer' | 'tester' | 'custom';

export const PERSONA_ROLES: readonly PersonaRole[] = ['planner', 'builder', 'reviewer', 'tester', 'custom'];

export interface PersonaModels {
  /** What runs when the model table cannot decide (an estimate, a machine without a table). */
  readonly default: string;
  /**
   * The models the persona may run, strongest first (req-170): the pool
   * grants the first one of the requested class with room. Every entry
   * must be a row of the model table (Settings → Models).
   */
  readonly pool: readonly string[];
}

/** The harness permission mode a persona's runs may take (`allowed: run-commands:`, req-171); absent = the crew setting decides. */
export type PersonaRunCommands = 'accept-edits' | 'bypass';

export const PERSONA_RUN_COMMANDS: readonly PersonaRunCommands[] = ['accept-edits', 'bypass'];

/** What a persona may do beyond its runs (`allowed:`, R11; req-142 adds the rest). */
export interface PersonaAllowed {
  /** `spend-above-allowance: true` — it runs on past a ticket's allowance instead of waiting for the owner (req-170). */
  readonly spendAboveAllowance: boolean;
  /**
   * `run-commands: accept-edits | bypass` (req-171, the page's "Run commands
   * in the worktree"): recorded, not yet enforced — the runner takes the
   * crew's `permissionMode` (req-142's remainder).
   */
  readonly runCommands?: PersonaRunCommands;
  /** `network: true` (req-171, "Reach the network"): recorded, not yet enforced (req-142's remainder). */
  readonly network?: boolean;
  /**
   * `write-notes: true` (req-282, concept §3): the persona may change notes
   * where its ticket's project grants Write — the yes/no that stays on the
   * persona once the vaults moved to the project. The vault MCP reads it
   * from req-283 on; until then `write-vaults` below still governs writes.
   */
  readonly writeNotes?: boolean;
  /**
   * `write-vaults: [<vault id>, …]` — the registered vaults its runs may
   * change through Drey Service's vault MCP (req-167, R5); absent or empty =
   * it reads every vault and writes none.
   */
  readonly writeVaults?: readonly string[];
}

/**
 * What a persona is (E10-6): an `agent` (the fleet runs it), the `human`
 * — the owner as a team member — or `mission`, Mission Control's own
 * persona (req-269, Pia): her `prompt.md` is composed into every Mission
 * Control turn, and an entry she holds is a Mission Control turn, never a
 * session. A gate assigned to the human persona parks the ticket instead
 * of dispatching a run; neither the human nor the mission persona counts
 * toward capacity, budget or the worker pool — "is a worker" is
 * `kind === 'agent'` ({@link isAgentPersona}).
 */
export type PersonaKind = 'agent' | 'human' | 'mission';

export const PERSONA_KINDS: readonly PersonaKind[] = ['agent', 'human', 'mission'];

/** The directory id of the owner's own persona (`personas/you`). */
export const HUMAN_PERSONA_ID = 'you';

/** The directory id of Mission Control's persona as shipped (`personas/pia`, req-269). */
export const MISSION_PERSONA_ID = 'pia';

export interface Persona {
  /** The directory id (the folder name under `_meta/personas/`). */
  readonly id: string;
  /** `agent` (default, absent in the file) or `human` (E10-6). */
  readonly kind: PersonaKind;
  readonly title: string;
  readonly role: PersonaRole;
  /** The CLI harness (`claude-code` | `opencode` | `kimi` | `api`). */
  readonly worker: string;
  readonly models: PersonaModels;
  /** UI color (`#rrggbb`), chips and avatars. */
  readonly color: string;
  /** `summary:` — the one line for the crew list (req-144, R11); '' = none (the cards then draw the role). */
  readonly summary: string;
  /** Skill files this persona carries, by name; {@link loadPersonaSkills} says where a name is looked for. */
  readonly skills: readonly string[];
  /**
   * The persona's daily budget in USD (`budget:`, concept §4.3 — the
   * Team view shows the day's costs against it); null = no budget set.
   */
  readonly budget: number | null;
  /** `allowed:` — what it may do beyond its runs; absent in the file = nothing beyond. */
  readonly allowed: PersonaAllowed;
  /** The run settings (req-258): class floor, needs, ceilings, gate, own pool, leaving actions, read-only. */
  readonly settings: PersonaSettings;
  /**
   * req-293: `model:` of Mission Control's persona — the model of her chat
   * turns on the assistant's connection; absent or null = the assistant's
   * own model. Read and written for the mission persona only.
   */
  readonly chatModel?: string | null;
}

export const PERSONAS_DIR = 'tickets/_meta/personas';

/**
 * Personas in pipeline order (fidelity ruling O12): `PERSONA_ROLES` is the crew's
 * order, plan to test, then custom ones, and the human last; within a role by id.
 * Since req-258 the crew's order is `order:` in crew.md (`inCrewOrder`); this
 * order only places the personas the list does not name.
 */
export function inPipelineOrder<P extends Pick<Persona, 'id' | 'role' | 'kind'>>(personas: readonly P[]): P[] {
  const rank = (persona: P): number => (persona.kind === 'human' ? PERSONA_ROLES.length : persona.kind === 'mission' ? -1 : PERSONA_ROLES.indexOf(persona.role));
  return [...personas].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function personaRef(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    throw new Error(`a persona id is lowercase letters, digits and dashes — got "${id}"`);
  }
  return id;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** `kind:` — `human` or `mission`; anything else (absent included) is an agent. */
function kindOf(value: unknown): PersonaKind {
  const kind = asString(value);
  return kind === 'human' || kind === 'mission' ? kind : 'agent';
}

function asStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
}

/** `models:` — the default and the pool (the default alone when the pool is empty). */
function modelsOf(raw: unknown): PersonaModels {
  const map = (raw ?? {}) as Record<string, unknown>;
  const defaultModel = asString(map['default']) ?? 'opus';
  const pool = asStringList(map['pool']);
  return { default: defaultModel, pool: pool.length > 0 ? pool : [defaultModel] };
}

/** `budget:` is USD per day; tolerant — absent, non-numeric or negative reads as null. */
function budgetOf(raw: unknown): number | null {
  const amount = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN;
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** `allowed:` — `spend-above-allowance: true` (req-170), `write-vaults:` (req-167), `run-commands:` and `network:` (req-171), `write-notes: true` (req-282). */
function allowedOf(raw: unknown): PersonaAllowed {
  const map = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const vaults = asStringList(typeof map['write-vaults'] === 'string' ? [map['write-vaults']] : map['write-vaults']);
  const commands = asString(map['run-commands']);
  return {
    spendAboveAllowance: map['spend-above-allowance'] === true,
    ...(commands !== null && (PERSONA_RUN_COMMANDS as readonly string[]).includes(commands) ? { runCommands: commands as PersonaRunCommands } : {}),
    ...(map['network'] === true ? { network: true } : {}),
    ...(map['write-notes'] === true ? { writeNotes: true } : {}),
    ...(vaults.length > 0 ? { writeVaults: [...new Set(vaults)] } : {}),
  };
}

/** The `allowed:` block's lines, written only for what is set. */
function allowedLines(allowed: PersonaAllowed): string[] {
  const vaults = allowed.writeVaults ?? [];
  const lines = [
    ...(allowed.spendAboveAllowance ? ['  spend-above-allowance: true'] : []),
    ...(allowed.runCommands !== undefined ? [`  run-commands: ${allowed.runCommands}`] : []),
    ...(allowed.network === true ? ['  network: true'] : []),
    ...(allowed.writeNotes === true ? ['  write-notes: true'] : []),
    ...(vaults.length > 0 ? [`  write-vaults: [${vaults.join(', ')}]`] : []),
  ];
  return lines.length > 0 ? ['allowed:', ...lines] : [];
}

/** `worker:` and `models:` — a mission persona has neither (she speaks over the chat bridge, req-269). */
function modelLines(persona: Persona): string[] {
  return [`worker: ${persona.worker}`, 'models:', `  default: ${persona.models.default}`, `  pool: [${persona.models.pool.join(', ')}]`];
}

/** req-293: Mission Control's persona's `model:` — a double-quoted scalar (a model id may hold a colon); none = the assistant's model. */
function chatModelLines(model: string | null | undefined): string[] {
  const id = (model ?? '').trim();
  return id === '' ? [] : [`model: ${JSON.stringify(id)}`];
}

/** The one line is a double-quoted YAML scalar (JSON's escapes are YAML's), so a colon or a quote in it never breaks the fence. */
function summaryLines(summary: string): string[] {
  const text = summary.replace(/\s+/g, ' ').trim();
  return text === '' ? [] : [`summary: ${JSON.stringify(text)}`];
}

/** Parse one persona file; tolerant like the ticket reader — what parses
 *  reads, the rest falls back to defaults and is reported by the caller's
 *  own validation if it cares. */
export function parsePersonaFile(id: string, text: string): Persona {
  personaRef(id);
  const { yamlText, hadFence } = splitFrontmatter(text);
  const js = hadFence && yamlText !== null ? (parseDocument(yamlText).toJS() as Record<string, unknown> | null) : null;
  const get = (key: string): unknown => (js === null || typeof js !== 'object' ? undefined : js[key]);
  const roleRaw = asString(get('role')) ?? 'custom';
  return {
    id,
    kind: kindOf(get('kind')),
    title: asString(get('title')) ?? id,
    role: (PERSONA_ROLES as readonly string[]).includes(roleRaw) ? (roleRaw as PersonaRole) : 'custom',
    worker: asString(get('worker')) ?? 'opencode',
    models: modelsOf(get('models')),
    color: asString(get('color')) ?? '#a78bfa',
    summary: (asString(get('summary')) ?? '').replace(/\s+/g, ' '),
    skills: asStringList(get('skills')),
    budget: budgetOf(get('budget')),
    allowed: allowedOf(get('allowed')),
    settings: personaSettingsOf(get),
    ...(kindOf(get('kind')) === 'mission' ? { chatModel: asString(get('model')) ?? null } : {}),
  };
}

/** True for the owner's own persona (E10-6) — no run, no model, no budget. */
export function isHumanPersona(persona: Pick<Persona, 'kind'> | null | undefined): boolean {
  return persona?.kind === 'human';
}

/** True for Mission Control's persona (req-269): her prompt speaks in Mission Control — no run, no model, no budget. */
export function isMissionPersona(persona: Pick<Persona, 'kind'> | null | undefined): boolean {
  return persona?.kind === 'mission';
}

/** True for a persona the fleet runs — the one test for "is a worker" (req-269). */
export function isAgentPersona(persona: Pick<Persona, 'kind'> | null | undefined): boolean {
  return persona?.kind === 'agent';
}

/**
 * A fresh human persona: the owner as a team member; the model fields are inert placeholders.
 * It carries the `commit` leaving action (req-267): the owner's sign-off merges the ticket.
 */
export function humanPersona(title: string, id: string = HUMAN_PERSONA_ID): Persona {
  return {
    id,
    kind: 'human',
    title,
    role: 'custom',
    worker: 'opencode',
    models: { default: 'opus', pool: ['opus'] },
    color: '#38bdf8',
    summary: '',
    skills: [],
    budget: null,
    allowed: { spendAboveAllowance: false },
    settings: { ...EMPTY_PERSONA_SETTINGS, leaving: ['commit'] },
  };
}

/**
 * The canonical persona file text (stable key order, byte-stable round
 * trips): the frontmatter and nothing else — "who Ben is" lives at the top
 * of `prompt.md` (R11, req-171: one prose, not two). `body` is only the
 * safety valve of a patch over a file whose prose has not migrated yet
 * (`PersonaProseMigrator` moves it): it rides along instead of being lost.
 */
export function personaFileText(persona: Persona, body?: string): string {
  personaRef(persona.id);
  const lines = [
    '---',
    `title: ${persona.title}`,
    ...(persona.kind === 'agent' ? [] : [`kind: ${persona.kind}`]),
    `role: ${persona.role}`,
    ...summaryLines(persona.summary),
    ...(persona.kind === 'mission' ? chatModelLines(persona.chatModel) : modelLines(persona)),
    `color: '${persona.color}'`,
    `skills: [${persona.skills.join(', ')}]`,
    ...(persona.budget !== null ? [`budget: ${persona.budget}`] : []),
    ...personaSettingsLines(persona.settings),
    ...allowedLines(persona.allowed),
    '---',
    '',
    ...(body !== undefined && body.trim() !== '' ? [body.trimStart().trimEnd(), ''] : []),
  ];
  return lines.join('\n');
}

/**
 * Who works a ticket and why (req-257, the persona board): on a lifecycle
 * store the chain's entry at the cursor (`chain`); on the phase board (the
 * files backend, a store not migrated) the column's `persona:` (`phase`).
 * The ticket pin `x-persona` and the crew's `default-persona` were retired
 * with the ladder's other levels (owner 2026-11-11: no role fallback, no
 * persona -> no run, `decisions.md`).
 */
export interface PersonaResolution {
  readonly persona: string | null;
  readonly source: 'chain' | 'phase' | 'none';
}

/** The phase board's resolution: the column's persona, else none. */
export function resolvePersona(input: { readonly phasePersona: string | null }): PersonaResolution {
  if (input.phasePersona !== null && input.phasePersona.trim() !== '') {
    return { persona: input.phasePersona.trim(), source: 'phase' };
  }
  return { persona: null, source: 'none' };
}

export { splitPoolEntry } from './pool-entry';
export { EMPTY_PERSONA_SETTINGS, type PersonaSettings } from './persona-settings';

export { loadPersonaSkills, type LoadedSkills, type PersonaSkill } from './skill-load';
