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
   * `write-vaults: [<vault id>, …]` — the registered vaults its runs may
   * change through Drey Service's vault MCP (req-167, R5); absent or empty =
   * it reads every vault and writes none.
   */
  readonly writeVaults?: readonly string[];
}

/**
 * What a persona is (E10-6): an `agent` (the fleet runs it) or the `human`
 * — the owner as a team member. A gate assigned to the human persona
 * parks the ticket instead of dispatching a run; the human never counts
 * toward capacity, budget or the worker pool.
 */
export type PersonaKind = 'agent' | 'human';

export const PERSONA_KINDS: readonly PersonaKind[] = ['agent', 'human'];

/** The directory id of the owner's own persona (`personas/you`). */
export const HUMAN_PERSONA_ID = 'you';

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
}

export const PERSONAS_DIR = 'tickets/_meta/personas';

/**
 * Personas in pipeline order (fidelity ruling O12): `PERSONA_ROLES` is the crew's
 * order, plan to test, then custom ones, and the human last; within a role by id.
 * Since req-258 the crew's order is `order:` in crew.md (`inCrewOrder`); this
 * order only places the personas the list does not name.
 */
export function inPipelineOrder<P extends Pick<Persona, 'id' | 'role' | 'kind'>>(personas: readonly P[]): P[] {
  const rank = (persona: P): number => (persona.kind === 'human' ? PERSONA_ROLES.length : PERSONA_ROLES.indexOf(persona.role));
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

/** `allowed:` — `spend-above-allowance: true` (req-170), `write-vaults:` (req-167), `run-commands:` and `network:` (req-171). */
function allowedOf(raw: unknown): PersonaAllowed {
  const map = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const vaults = asStringList(typeof map['write-vaults'] === 'string' ? [map['write-vaults']] : map['write-vaults']);
  const commands = asString(map['run-commands']);
  return {
    spendAboveAllowance: map['spend-above-allowance'] === true,
    ...(commands !== null && (PERSONA_RUN_COMMANDS as readonly string[]).includes(commands) ? { runCommands: commands as PersonaRunCommands } : {}),
    ...(map['network'] === true ? { network: true } : {}),
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
    ...(vaults.length > 0 ? [`  write-vaults: [${vaults.join(', ')}]`] : []),
  ];
  return lines.length > 0 ? ['allowed:', ...lines] : [];
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
    kind: asString(get('kind')) === 'human' ? 'human' : 'agent',
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
  };
}

/** True for the owner's own persona (E10-6) — no run, no model, no budget. */
export function isHumanPersona(persona: Pick<Persona, 'kind'> | null | undefined): boolean {
  return persona?.kind === 'human';
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
    ...(persona.kind === 'human' ? ['kind: human'] : []),
    `role: ${persona.role}`,
    ...summaryLines(persona.summary),
    `worker: ${persona.worker}`,
    'models:',
    `  default: ${persona.models.default}`,
    `  pool: [${persona.models.pool.join(', ')}]`,
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
 * THE ladder (concept §4.2): ticket pin > phase persona > engine default.
 * Returns the winning persona id and which level decided — the Verlauf
 * and the cost attribution need the provenance as much as the id.
 */
export interface PersonaResolution {
  readonly persona: string | null;
  readonly source: 'ticket' | 'phase' | 'default' | 'none';
}

export function resolvePersona(input: {
  readonly ticketPersona: string | null;
  readonly phasePersona: string | null;
  readonly defaultPersona: string | null;
}): PersonaResolution {
  if (input.ticketPersona !== null && input.ticketPersona.trim() !== '') {
    return { persona: input.ticketPersona.trim(), source: 'ticket' };
  }
  if (input.phasePersona !== null && input.phasePersona.trim() !== '') {
    return { persona: input.phasePersona.trim(), source: 'phase' };
  }
  if (input.defaultPersona !== null && input.defaultPersona.trim() !== '') {
    return { persona: input.defaultPersona.trim(), source: 'default' };
  }
  return { persona: null, source: 'none' };
}

export { splitPoolEntry } from './pool-entry';
export { EMPTY_PERSONA_SETTINGS, type PersonaSettings } from './persona-settings';

/**
 * The migration reader (concept §4.2): one pipeline column's legacy
 * `worker:`/`model:`/`prompt:` keys become a persona candidate. The
 * caller (the dispatcher) persists the generated personas and rewrites
 * the pipeline; this function stays pure.
 */
export interface PersonaMigration {
  /** The suggested persona id (the prompt ref, slugified, deduped by the caller). */
  readonly id: string;
  readonly title: string;
  readonly worker: string;
  readonly model: string | null;
  /** The prompt file content: the column's `prompt:` ref content lives in _meta/prompts. */
  readonly promptRef: string | null;
}

export function personaMigrationFor(input: {
  readonly phaseId: string;
  readonly worker: string | null;
  readonly model: string | null;
  readonly prompt: string | null;
}): PersonaMigration | null {
  if (input.worker === null && input.model === null && input.prompt === null) {
    return null;
  }
  const id = input.prompt?.trim() !== '' && input.prompt !== null
    ? input.prompt!.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
    : `${input.phaseId}-default`;
  return {
    id: id === '' ? `${input.phaseId}-default` : id,
    title: id.replace(/-/g, ' '),
    worker: input.worker ?? 'opencode',
    model: input.model ?? null,
    promptRef: input.prompt,
  };
}

export { loadPersonaSkills, type LoadedSkills, type PersonaSkill } from './skill-load';
