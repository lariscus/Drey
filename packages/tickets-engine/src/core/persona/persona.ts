import { parseDocument } from 'yaml';
import { splitFrontmatter } from '../../../../../shared/frontmatter';
import { classNameOf, type ClassName } from '../../contracts/capability-class';
import { splitPoolEntry } from '../config/pool-entry';
import { EMPTY_PERSONA_SETTINGS, personaSettingsLines, personaSettingsOf, type PersonaSettings } from './persona-settings';

/**
 * Personas (ADR-0088, E3 — the concept's §4): a named agent is role +
 * behaviour + model + memory in one, stored as a directory per persona in
 * the tickets repo:
 *
 *   tickets/_meta/personas/
 *     paul/
 *       persona.md   # frontmatter: title, role, class, model, color, skills, budget
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
 * Since Persona v3 (req-288) a persona names a capability **class** and may
 * pin one **model** of it; the harness follows from the model's row in the
 * model table. The v2 keys `worker:`, `models:` (default + pool) and
 * `min-class:` are read as {@link PersonaLegacyModels} only, for the one-time
 * migration (`PersonaModelMigrator`), and never written again.
 */

export type PersonaRole = 'planner' | 'builder' | 'reviewer' | 'tester' | 'custom';

export const PERSONA_ROLES: readonly PersonaRole[] = ['planner', 'builder', 'reviewer', 'tester', 'custom'];

/** The v2 `models:` block (req-170): the default model and the pool, strongest first. Read for the migration only (req-288). */
export interface PersonaModels {
  readonly default: string;
  readonly pool: readonly string[];
}

/**
 * The v2 model keys of an unmigrated record (req-288): `worker:`, `models:`
 * and the class floor `min-class:`. Present only while a record names no
 * `class:`; a write of such a record keeps them, so nothing is lost before
 * the migration runs, and the migration replaces them with `class:` and an
 * optional `model:`.
 */
export interface PersonaLegacyModels {
  readonly worker: string;
  readonly models: PersonaModels;
  readonly minClass: ClassName | null;
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
   * in the worktree"): the harness permission mode of the persona's runs and
   * free sessions — it beats the crew's `permissionMode` (req-142); a review
   * stays read-only, a free session's own choice beats it. Absent = the crew's.
   */
  readonly runCommands?: PersonaRunCommands;
  /**
   * `network: true` (req-171, "Reach the network"): absent = the persona's
   * workers run with the network switched off as far as each harness can
   * enforce it (req-142, ADR-0099) — Claude Code's web tools, Copilot CLI's
   * URL approval; on native Windows no harness confines a shell command.
   */
  readonly network?: boolean;
  /**
   * `write-notes: true` (req-282, concept §3): the persona may change notes
   * where its ticket's project grants Write — the yes/no that stays on the
   * persona once the vaults moved to the project. The vault MCP reads it
   * at every call (req-283): a write needs the project's Write, this switch
   * and a run that is not read-only.
   */
  readonly writeNotes?: boolean;
  /**
   * The retired `write-vaults: [<vault id>, …]` (req-167; device ids): read
   * only so the first project's migration can carry it into the project and
   * the engine's start can drop it (req-283) — no right comes from it, and
   * it is never written back.
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
  /**
   * `class:` (req-288) — the capability class its runs ask the pool for (a
   * name of the owner's list in Settings → Models); a ticket's `class:` or
   * size may raise a run above it, never below. null = the record names
   * none (the human, Mission Control's persona, an unmigrated v2 record).
   */
  readonly class: ClassName | null;
  /**
   * `model:` of an agent (req-288) — the one model of its class it is pinned
   * to, as a pool entry (`<provider>/<model>`; the harness from the prefix,
   * else from the model's table row); null = the next free model of the class.
   */
  readonly model: string | null;
  /** The v2 keys of a record not migrated yet (req-288); absent once it names a `class:`. */
  readonly legacy?: PersonaLegacyModels;
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
  /** The run settings (req-258): needs, ceilings, gate, own pool, leaving actions, read-only (the class floor folded into `class`, req-288). */
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

/** The v2 keys of an agent record that names no `class:` but still carries one of them; null otherwise. */
function legacyOf(get: (key: string) => unknown): PersonaLegacyModels | null {
  if (get('worker') === undefined && get('models') === undefined && get('min-class') === undefined) {
    return null;
  }
  return { worker: asString(get('worker')) ?? 'opencode', models: modelsOf(get('models')), minClass: classNameOf(get('min-class')) };
}

/** An agent's `class:` and `model:` (req-288), or the v2 keys it still carries. */
function agentModelOf(get: (key: string) => unknown): Pick<Persona, 'class' | 'model' | 'legacy'> {
  const named = classNameOf(get('class'));
  if (named !== null) {
    return { class: named, model: asString(get('model')) };
  }
  const legacy = legacyOf(get);
  return { class: null, model: null, ...(legacy !== null ? { legacy } : {}) };
}

/** `budget:` is USD per day; tolerant — absent, non-numeric or negative reads as null. */
function budgetOf(raw: unknown): number | null {
  const amount = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN;
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** `allowed:` — `spend-above-allowance: true` (req-170), `run-commands:` and `network:` (req-171), `write-notes: true` (req-282); the retired `write-vaults:` (req-167) for the migration only. */
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

/** The `allowed:` block's lines, written only for what is set; the retired `write-vaults` never (req-283). */
function allowedLines(allowed: PersonaAllowed): string[] {
  const lines = [
    ...(allowed.spendAboveAllowance ? ['  spend-above-allowance: true'] : []),
    ...(allowed.runCommands !== undefined ? [`  run-commands: ${allowed.runCommands}`] : []),
    ...(allowed.network === true ? ['  network: true'] : []),
    ...(allowed.writeNotes === true ? ['  write-notes: true'] : []),
  ];
  return lines.length > 0 ? ['allowed:', ...lines] : [];
}

/**
 * An agent's `class:` and pinned `model:` (req-288; the model a double-quoted
 * scalar, an id may hold a colon); a record that names no class keeps its v2
 * keys until the migration replaces them. The human and Mission Control's
 * persona carry no class.
 */
function modelLines(persona: Persona): string[] {
  if (persona.class !== null) {
    const pinned = (persona.model ?? '').trim();
    return [`class: ${persona.class}`, ...(pinned !== '' ? [`model: ${JSON.stringify(pinned)}`] : [])];
  }
  const legacy = persona.legacy;
  if (legacy === undefined) {
    return [];
  }
  return [
    `worker: ${legacy.worker}`,
    'models:',
    `  default: ${legacy.models.default}`,
    `  pool: [${legacy.models.pool.join(', ')}]`,
    ...(legacy.minClass !== null ? [`min-class: ${legacy.minClass}`] : []),
  ];
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
  const kind = kindOf(get('kind'));
  return {
    id,
    kind,
    title: asString(get('title')) ?? id,
    role: (PERSONA_ROLES as readonly string[]).includes(roleRaw) ? (roleRaw as PersonaRole) : 'custom',
    ...(kind === 'agent' ? agentModelOf(get) : { class: null, model: null }),
    color: asString(get('color')) ?? '#a78bfa',
    summary: (asString(get('summary')) ?? '').replace(/\s+/g, ' '),
    skills: asStringList(get('skills')),
    budget: budgetOf(get('budget')),
    allowed: allowedOf(get('allowed')),
    settings: personaSettingsOf(get),
    ...(kind === 'mission' ? { chatModel: asString(get('model')) ?? null } : {}),
  };
}

/**
 * The model a persona's figures read before the pool decides (a token count,
 * an estimate, a start outside the chain): its pinned model, else an
 * unmigrated record's old default on its worker; null = its class decides at
 * dispatch (req-288).
 */
export function personaModelGuess(persona: Pick<Persona, 'model' | 'legacy'>): { readonly provider: string | null; readonly model: string } | null {
  if (persona.model !== null && persona.model.trim() !== '') {
    return splitPoolEntry(persona.model);
  }
  if (persona.legacy === undefined) {
    return null;
  }
  const entry = splitPoolEntry(persona.legacy.models.default);
  return { provider: entry.provider ?? persona.legacy.worker, model: entry.model };
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
    class: null,
    model: null,
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
 * Who works a ticket and why (req-257, the persona board): the chain's
 * entry at the cursor (`chain`). No persona -> no run
 * (owner 2026-11-11: no role fallback, `decisions.md`).
 */
export interface PersonaResolution {
  readonly persona: string | null;
  readonly source: 'chain' | 'none';
}

export { splitPoolEntry } from '../config/pool-entry';
export { EMPTY_PERSONA_SETTINGS, type PersonaSettings } from './persona-settings';

export { loadPersonaSkills, type LoadedSkills, type PersonaSkill } from '../skills/skill-load';

/** req-142: what one run takes from a persona's `allowed:` — the permission mode beating the crew's (absent = the crew's) and the network switch. */
export interface PersonaRunAllowed {
  readonly runCommands?: PersonaRunCommands;
  readonly network: boolean;
}

export function personaRunAllowedOf(persona: { readonly allowed: PersonaAllowed }): PersonaRunAllowed {
  const { runCommands, network } = persona.allowed;
  return { ...(runCommands !== undefined ? { runCommands } : {}), network: network === true };
}

/** The request's `network` key (req-142): `false` only when a persona forbids it; absent = unrestricted, as before. */
export function networkFieldOf(allowed: PersonaRunAllowed | null | undefined): { readonly network?: false } {
  return allowed !== null && allowed !== undefined && !allowed.network ? { network: false } : {};
}
