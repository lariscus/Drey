/**
 * Pure board assembly (ADR-0076): parses the `_meta` configuration,
 * orders columns (derived order — the order.md pins went with the kanban
 * board, req-75), and folds parsed
 * tickets into a snapshot shape. No IO — `index.ts` feeds it files and
 * paths, the specs feed it fixtures. Everything here is deterministic:
 * the same files always produce the same board (no stored state).
 */
import { isCollection, isMap, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';
import {
  DEFAULT_PRIORITY_CONFIG,
  parseHandover,
  parsePriorityConfig,
  priorityWeight,
  phaseWithoutPoolKeys,
  resolveCardWorker,
  TICKETS_ARCHIVE_DIR,
  type BoardColumn,
  type BoardSnapshot,
  type PipelinePhase,
  type PriorityConfig,
  type RecentDone,
  type TicketCard,
  type TicketIssue,
  type TicketPriority,
  type TicketUsage,
} from '../contracts/tickets';
import { checkpointPhaseIds } from '../fleet/chain';
import { withTerminalTickets } from './normalize';
import { READY_STATE } from './pipeline-states';
import { runDependencyPass } from './blocked';
import { parseRepos } from './repos-file';
import { parseTicketFile, ticketPathParts } from './ticket-files';
import { pipelinePhaseOf } from './pipeline-phase';

const PHASE_ID = /^[a-z][a-z0-9-]*$/;

// --- pipeline.md -----------------------------------------------------------

export interface PipelineParse {
  readonly phases: readonly PipelinePhase[];
  /** The optional top-level `push:` remote (T-0041); null = never push. */
  readonly pushRemote: string | null;
  /** The vault's priority vocabulary (`priorities:`); the default list when absent or unreadable. */
  readonly priorities: PriorityConfig;
  readonly error: string | null;
  /** Noise findings the parse forgave (a non-string `push:`). */
  readonly issues: readonly TicketIssue[];
}

export function parsePipeline(text: string): PipelineParse {
  const { yamlText, hadFence } = splitFrontmatter(text);
  if (!hadFence || yamlText === null) {
    return { phases: [], pushRemote: null, priorities: DEFAULT_PRIORITY_CONFIG, error: 'pipeline.md has no frontmatter fence', issues: [] };
  }
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    return { phases: [], pushRemote: null, priorities: DEFAULT_PRIORITY_CONFIG, error: `pipeline.md does not parse: ${doc.errors[0]!.message}`, issues: [] };
  }
  const parsed = doc.toJS() as unknown;
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
  const rawPhases = root['phases'];
  if (!Array.isArray(rawPhases) || rawPhases.length === 0) {
    return { phases: [], pushRemote: null, priorities: DEFAULT_PRIORITY_CONFIG, error: 'pipeline.md needs a non-empty phases list', issues: [] };
  }

  const issues: TicketIssue[] = [];
  const priorityParse = parsePriorityConfig(root['priorities']);
  issues.push(...priorityParse.issues);
  const priorities = priorityParse.config;
  const rawPush = root['push'];
  let pushRemote: string | null = null;
  if (rawPush !== undefined && rawPush !== null) {
    if (typeof rawPush === 'string' && rawPush.trim() !== '') {
      pushRemote = rawPush.trim();
    } else {
      // A remote NAME belongs here (git config owns URLs); anything else is forgiven visibly.
      issues.push({ level: 'noise', message: 'pipeline.md: push must be a remote name string — ignored' });
    }
  }

  const phases: PipelinePhase[] = [];
  const seen = new Set<string>();
  for (const entry of rawPhases) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { phases: [], pushRemote: null, priorities: DEFAULT_PRIORITY_CONFIG, error: 'every pipeline phase must be a mapping', issues };
    }
    const map = entry as Record<string, unknown>;
    const id = typeof map['id'] === 'string' ? map['id'] : '';
    if (!PHASE_ID.test(id)) {
      return { phases: [], pushRemote: null, priorities: DEFAULT_PRIORITY_CONFIG, error: `phase id "${id}" must match ${PHASE_ID.source}`, issues };
    }
    if (seen.has(id)) {
      return { phases: [], pushRemote: null, priorities: DEFAULT_PRIORITY_CONFIG, error: `duplicate phase id "${id}"`, issues };
    }
    seen.add(id);
    phases.push(pipelinePhaseOf(map, id, issues));
  }
  return { phases, pushRemote, priorities, error: null, issues };
}

// --- pipeline.md patching (the settings dialog's writer, M85) ----------------

export interface PhasePoolPatch {
  /** `opencode`, `claude-code` or `kimi` sets the worker (and the `agent` handover);
   *  null clears it — the column becomes a manual step and loses its pool. */
  readonly worker?: string | null;
  /** The model pin; an empty string or null clears it. */
  readonly model?: string | null;
  /** The prompt ref override; an empty string or null clears it. */
  readonly prompt?: string | null;
  /** The phase chip colour (`color:`, T-0084) — `#rrggbb`; an empty string
   *  or null removes the key (the default palette applies). Never removed
   *  by a worker clear. */
  readonly color?: string | null;
  /**
   * The phase's persona (`persona: paul`, ADR-0088 E3) — an empty string
   *  or null removes the key. Setting a persona REPLACES the column-level
   *  agent configuration: the legacy `worker:`/`workers:`/`model:`/
   *  `prompt:` keys go (they are the persona's job now); the `handover:`
   *  stays as it is, so an `agent …` column keeps draining itself. The
   *  old column keys stay readable until the board service's migration
   *  rewrites them onto personas.
   */
  readonly persona?: string | null;
}

/**
 * The one patcher for a phase's pool keys in `_meta/pipeline.md` — the
 * settings dialog writes through here, so a hand-formatted file keeps
 * its layout, comments and unknown keys (the same document-mutation
 * discipline as the ticket patcher). Setting a worker writes the
 * matching `agent <prompt-ref>` handover; clearing it writes `manual`.
 * Throws on an unparseable pipeline or an unknown phase — the caller
 * refuses, it never guesses.
 */
export function patchPipelinePhase(text: string, phaseId: string, patch: PhasePoolPatch): string {
  const { yamlText, body, hadFence } = splitFrontmatter(text);
  if (!hadFence || yamlText === null) {
    throw new Error('pipeline.md has no frontmatter fence');
  }
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    throw new Error('pipeline.md does not parse');
  }
  const phases = doc.get('phases', true);
  if (!isCollection(phases)) {
    throw new Error('pipeline.md needs a phases list');
  }
  let entry: YAMLMap | null = null;
  for (const item of (phases as YAMLSeq).items) {
    const value = isMap(item) ? item : null;
    if (value !== null && value.get('id') === phaseId) {
      entry = value;
      break;
    }
  }
  if (entry === null) {
    throw new Error(`pipeline.md has no phase "${phaseId}"`);
  }

  const removeKey = (key: string): void => {
    if (entry!.has(key)) {
      entry!.delete(key);
    }
  };

  if (patch.worker !== undefined) {
    const worker = patch.worker?.trim() ?? '';
    if (worker === '') {
      // A manual step: the pool and its keys go with the worker.
      removeKey('worker');
      removeKey('model');
      removeKey('workers');
      removeKey('prompt');
      entry.set('handover', 'manual');
    } else {
      entry.set('worker', worker);
      const handover = parseHandover(String(entry.get('handover') ?? ''));
      const promptFromPatch =
        patch.prompt !== undefined && patch.prompt !== null && patch.prompt.trim() !== ''
          ? patch.prompt.trim()
          : null;
      const promptFromKey =
        typeof entry.get('prompt') === 'string' && (entry.get('prompt') as string).trim() !== ''
          ? (entry.get('prompt') as string).trim()
          : null;
      const ref = promptFromPatch ?? promptFromKey ?? handover.promptRef ?? `${phaseId}-default`;
      entry.set('handover', `agent ${ref}`);
    }
  }
  if (patch.model !== undefined) {
    const model = patch.model?.trim() ?? '';
    if (model === '') {
      removeKey('model');
    } else {
      entry.set('model', model);
    }
  }
  if (patch.prompt !== undefined) {
    const prompt = patch.prompt?.trim() ?? '';
    if (prompt === '') {
      removeKey('prompt');
    } else {
      entry.set('prompt', prompt);
    }
  }
  if (patch.color !== undefined) {
    const color = patch.color?.trim() ?? '';
    if (color === '') {
      removeKey('color');
    } else {
      entry.set('color', color);
    }
  }
  if (patch.persona !== undefined) {
    const persona = patch.persona?.trim() ?? '';
    if (persona === '') {
      removeKey('persona');
    } else {
      entry.set('persona', persona);
      // The persona owns the column's agent configuration — the legacy
      // keys would only shadow it (the handover stays: an `agent …`
      // column keeps draining itself, now through the persona).
      removeKey('worker');
      removeKey('workers');
      removeKey('model');
      removeKey('prompt');
    }
  }

  let yaml = doc.toString({ flowCollectionPadding: false, lineWidth: 0 });
  if (!yaml.endsWith('\n')) {
    yaml += '\n';
  }
  return `---\n${yaml}---\n${body}`;
}

/**
 * Rewrites the order of pipeline.md's phases (req-50, the settings page's
 * sortable columns). `order` must name every phase exactly once, and the
 * first (capture target) and last (terminal) phase keep their places.
 * Each entry moves whole — keys, comments and the prose body stay.
 */
export function reorderPipelinePhases(text: string, order: readonly string[]): string {
  const { yamlText, body, hadFence } = splitFrontmatter(text);
  if (!hadFence || yamlText === null) {
    throw new Error('pipeline.md has no frontmatter fence');
  }
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    throw new Error('pipeline.md does not parse');
  }
  const phases = doc.get('phases', true);
  if (!isCollection(phases)) {
    throw new Error('pipeline.md needs a phases list');
  }
  const items = (phases as YAMLSeq).items;
  const idOf = (item: unknown): string | null => {
    const id = isMap(item) ? item.get('id') : null;
    return typeof id === 'string' ? id : null;
  };
  const current = items.map(idOf);
  if (
    order.length !== current.length ||
    new Set(order).size !== order.length ||
    current.some((id) => id === null || !order.includes(id))
  ) {
    throw new Error('the new order must name every pipeline phase exactly once');
  }
  if (order[0] !== current[0] || order[order.length - 1] !== current[current.length - 1]) {
    throw new Error('the first and the last phase keep their places');
  }
  (phases as YAMLSeq).items = order.map((id) => items[current.indexOf(id)]!);
  let yaml = doc.toString({ flowCollectionPadding: false, lineWidth: 0 });
  if (!yaml.endsWith('\n')) {
    yaml += '\n';
  }
  return `---\n${yaml}---\n${body}`;
}

// --- phase add / rename / remove (the settings page's column editor) ----------

/**
 * A phase id from a human title: lower-case, every run of characters
 * outside `[a-z0-9]` becomes one `-`, a leading digit gets a `p-` prefix
 * (an id starts with a letter), and a clash with `taken` takes the first
 * free `-2`, `-3`, … suffix. Empty input falls back to `phase`.
 */
export function phaseIdFromTitle(title: string, taken: readonly string[]): string {
  let base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base === '') {
    base = 'phase';
  }
  if (!/^[a-z]/.test(base)) {
    base = `p-${base}`;
  }
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) {
    id = `${base}-${n}`;
  }
  return id;
}

/** Parses pipeline.md into its document and phase list, or throws the one refusal. */
function openPipelineDoc(text: string): { doc: Document; phases: YAMLSeq; body: string } {
  const { yamlText, body, hadFence } = splitFrontmatter(text);
  if (!hadFence || yamlText === null) {
    throw new Error('pipeline.md has no frontmatter fence');
  }
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    throw new Error('pipeline.md does not parse');
  }
  const phases = doc.get('phases', true);
  if (!isCollection(phases)) {
    throw new Error('pipeline.md needs a phases list');
  }
  return { doc, phases: phases as YAMLSeq, body };
}

function closePipelineDoc(doc: Document, body: string): string {
  let yaml = doc.toString({ flowCollectionPadding: false, lineWidth: 0 });
  if (!yaml.endsWith('\n')) {
    yaml += '\n';
  }
  return `---\n${yaml}---\n${body}`;
}

function phaseIdOfItem(item: unknown): string | null {
  const id = isMap(item) ? item.get('id') : null;
  return typeof id === 'string' ? id : null;
}

/** The title of a phase never carries a line break or a YAML-hostile edge. */
function cleanTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (clean === '') {
    throw new Error('a phase needs a name');
  }
  return clean;
}

/**
 * Adds a manual phase. It lands right after `afterId` (default: just
 * before the terminal phase) — never before the capture target or after
 * the terminal one. Returns the new text and the id the phase got.
 */
export function addPipelinePhase(
  text: string,
  input: { readonly title: string; readonly afterId?: string | null },
): { readonly text: string; readonly id: string } {
  const { doc, phases, body } = openPipelineDoc(text);
  const ids = phases.items.map(phaseIdOfItem);
  const title = cleanTitle(input.title);
  const id = phaseIdFromTitle(title, ids.filter((x): x is string => x !== null));
  let at = ids.length - 1; // before the terminal phase
  if (input.afterId !== undefined && input.afterId !== null) {
    const after = ids.indexOf(input.afterId);
    if (after < 0) {
      throw new Error(`pipeline.md has no phase "${input.afterId}"`);
    }
    if (after === ids.length - 1) {
      throw new Error('nothing comes after the terminal phase');
    }
    at = after + 1;
  }
  phases.items.splice(at, 0, doc.createNode({ id, title, handover: 'manual' }, { flow: true }));
  return { text: closePipelineDoc(doc, body), id };
}

/**
 * Renames a phase: only its `title`. The id — and with it the phase
 * folder, every ticket's place and every `handover` / prompt reference —
 * stays, so a rename touches no ticket.
 */
export function renamePipelinePhase(text: string, phaseId: string, title: string): string {
  const { doc, phases, body } = openPipelineDoc(text);
  const entry = phases.items.find((item) => phaseIdOfItem(item) === phaseId);
  if (entry === undefined || !isMap(entry)) {
    throw new Error(`pipeline.md has no phase "${phaseId}"`);
  }
  entry.set('title', cleanTitle(title));
  return closePipelineDoc(doc, body);
}

/** Removes a phase entry; the capture target and the terminal phase are kept. */
export function removePipelinePhase(text: string, phaseId: string): string {
  const { doc, phases, body } = openPipelineDoc(text);
  const ids = phases.items.map(phaseIdOfItem);
  const at = ids.indexOf(phaseId);
  if (at < 0) {
    throw new Error(`pipeline.md has no phase "${phaseId}"`);
  }
  if (at === 0 || at === ids.length - 1) {
    throw new Error('the first and the last phase stay');
  }
  phases.items.splice(at, 1);
  return closePipelineDoc(doc, body);
}

// --- repos.md: core/repos-file.ts (req-177) ----------------------------------

export { parseRepos, reposFileText, reposProse, type ReposParse } from './repos-file';

// --- ordering ----------------------------------------------------------------

/** The comparison projection of a ticket for derived ordering. */
export interface OrderKey {
  readonly id: string;
  readonly priority: TicketPriority;
  readonly rank: number;
  /** The `entered-<phase>` stamp of the column being ordered ('' when none). */
  readonly entered: string;
}

/** Derived order: priority, then rank, then `entered-<phase>`, then id. */
export function derivedOrder(keys: readonly OrderKey[], config: PriorityConfig = DEFAULT_PRIORITY_CONFIG): OrderKey[] {
  return [...keys].sort((a, b) => {
    const pri = priorityWeight(a.priority, config) - priorityWeight(b.priority, config);
    if (pri !== 0) {
      return pri;
    }
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    if (a.entered !== b.entered) {
      return a.entered === '' ? 1 : b.entered === '' ? -1 : a.entered < b.entered ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Final column order: the derived order (the order.md pins went with req-75). */
export function orderColumn<T extends { readonly id: string }>(
  tickets: readonly T[],
  keyOf: (ticket: T) => OrderKey,
  config: PriorityConfig = DEFAULT_PRIORITY_CONFIG,
): T[] {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  // Keys were built from byId itself, so every lookup lands.
  return derivedOrder([...byId.values()].map(keyOf), config).map((k) => byId.get(k.id) as T);
}

// --- snapshot assembly --------------------------------------------------------

export interface BoardFile {
  /** Vault-relative path of a `tickets/<dir>/<name>.md` file. */
  readonly path: string;
  readonly text: string;
}

export interface AssembleInput {
  readonly vaultId: string | null;
  readonly vaultName: string | null;
  readonly activeVaultName: string | null;
  readonly isGitRepo: boolean;
  readonly pipelineText: string | null;
  readonly reposText: string | null;
  readonly files: readonly BoardFile[];
  /** The plugin's configured default worker (M84) — what cards show when
   *  nothing above them pins one. */
  readonly defaultWorker: string;
  /**
   * The archived tickets of the last 7 days (req-75 W1b), already
   * computed by the caller from the same file list — the pure assembly
   * stays time-free. Default: none.
   */
  readonly recentDone?: readonly RecentDone[];
  /**
   * The settled-run usage per ticket id, already aggregated by the
   * caller from the fleet ledger's `run_settled` lines (concept §4.3) —
   * the pure assembly stays ledger-free. Default: none.
   */
  readonly ticketUsage?: Record<string, TicketUsage>;
  /** A store's own priority vocabulary (D-11): replaces pipeline.md's. Default: pipeline.md decides. */
  readonly priorities?: PriorityConfig;
}

/** Files under `tickets/` that are neither `_meta` nor ticket-shaped. */
function strayFileIssue(path: string): TicketIssue {
  return { level: 'noise', message: `unexpected file in the tickets tree: ${path}` };
}

export function assembleBoard(input: AssembleInput): BoardSnapshot {
  const issues: TicketIssue[] = [];

  const parsedPipeline = input.pipelineText === null
    ? { phases: [], pushRemote: null, priorities: DEFAULT_PRIORITY_CONFIG, error: 'tickets/_meta/pipeline.md is missing', issues: [] }
    : parsePipeline(input.pipelineText);
  const pipelineParse = input.priorities === undefined ? parsedPipeline : { ...parsedPipeline, priorities: input.priorities };
  if (pipelineParse.error !== null) {
    issues.push({ level: 'error', message: pipelineParse.error });
  }
  for (const issue of pipelineParse.issues) {
    issues.push({ level: issue.level, message: issue.message });
  }
  const phases = pipelineParse.phases;
  const phaseIds = new Set(phases.map((p) => p.id));

  const reposParse = parseRepos(input.reposText);
  if (reposParse.error !== null) {
    issues.push({ level: 'error', message: reposParse.error });
  }
  for (const warning of reposParse.warnings) {
    issues.push({ level: 'warning', message: warning });
  }
  const repoNames = new Set(reposParse.repos.map((r) => r.name));

  // Parse every ticket; group by directory. Cards stay mutable through
  // the duplicate and dependency passes, then flow into columns as-is
  // (structural match).
  interface AssemblyCard extends TicketCard {
    issues: TicketIssue[];
    blocked: readonly string[];
    blocks: readonly string[];
  }
  const byPhase = new Map<string, AssemblyCard[]>();
  const textById = new Map<string, string>();
  for (const file of input.files) {
    // The reserved archive folder (T-0041): beside `_meta`, never a
    // column, never a counter, never a stray badge — invisible here.
    // (Normalization still treats files moved into it; deletion inside
    // it stays the owner's manual act.)
    if (file.path.startsWith(`${TICKETS_ARCHIVE_DIR}/`)) {
      continue;
    }
    const parts = ticketPathParts(file.path);
    if (parts === null) {
      // `_meta` holds the board's configuration, not tickets — only
      // genuinely stray files get the badge.
      if (!file.path.startsWith('tickets/_meta/')) {
        issues.push(strayFileIssue(file.path));
      }
      continue;
    }
    if (parts.phase === '_meta') {
      continue; // a ticket-stemmed file inside _meta: ignore, don't column it.
    }
    const parsed = parseTicketFile(file.text, file.path, pipelineParse.priorities);
    // req-72: every named repo must be known — the primary and the extra
    // ones alike (a typo in the second entry would silently lose a repo).
    for (const name of parsed.meta.repos) {
      if (!repoNames.has(name)) {
        parsed.issues.push({ level: 'warning', message: `repo "${name}" is not in _meta/repos.md` });
      }
    }
    if (parsed.meta.parkedReason !== null && parts.phase !== 'inbox') {
      parsed.issues.push({ level: 'noise', message: 'parked ticket outside inbox — the fields are ignored here' });
    }
    // The card's display worker: the first named repo that pins one (the
    // primary usually decides; an extra repo's pin counts when the
    // primary leaves it open).
    const repoWorker =
      parsed.meta.repos
        .map((name) => reposParse.repos.find((r) => r.name === name)?.worker ?? null)
        .find((worker) => worker !== null) ?? null;
    const card: AssemblyCard = {
      id: parts.stem,
      path: file.path,
      phase: parts.phase,
      meta: parsed.meta,
      worker: resolveCardWorker(
        parsed.meta.worker,
        phases.find((p) => p.id === parts.phase)?.handover ?? null,
        repoWorker,
        input.defaultWorker,
      ),
      ...(input.ticketUsage?.[parts.stem] !== undefined ? { usage: input.ticketUsage[parts.stem] } : {}),
      issues: [...parsed.issues],
      blocked: [],
      blocks: [],
    };
    const list = byPhase.get(parts.phase) ?? [];
    list.push(card);
    byPhase.set(parts.phase, list);
    textById.set(parts.stem, file.text);
  }

  // An id in more than one phase is ambiguous — every occurrence carries
  // the badge (which file is the stray one is not for us to guess).
  const idCounts = new Map<string, number>();
  for (const cards of byPhase.values()) {
    for (const card of cards) {
      idCounts.set(card.id, (idCounts.get(card.id) ?? 0) + 1);
    }
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      for (const cards of byPhase.values()) {
        for (const card of cards) {
          if (card.id === id) {
            card.issues.unshift({ level: 'error', message: 'id exists in more than one phase' });
          }
        }
      }
    }
  }

  // The dependency pass (T-0050) runs on the final card list in column
  // order (configured phases first, then unknown directories sorted —
  // a duplicate id resolves to the first occurrence): every card gains
  // its derived blocked/blocks state, and the pass's findings join the
  // per-card issues. Blocked is derived, never stored.
  const knownDirs = new Set([...phaseIds, '_meta']);
  const orderedCards: readonly AssemblyCard[] = [
    ...phases.flatMap((phase) => byPhase.get(phase.id) ?? []),
    ...[...byPhase.keys()]
      .filter((dir) => !knownDirs.has(dir))
      .sort()
      .flatMap((dir) => byPhase.get(dir) ?? []),
  ];
  const terminalPhase = phases.length > 0 ? phases[phases.length - 1]!.id : '';
  const dependencies = runDependencyPass(orderedCards, terminalPhase);
  for (const card of orderedCards) {
    card.blocked = dependencies.blocked.get(card.id) ?? [];
    card.blocks = dependencies.blocks.get(card.id) ?? [];
    card.issues.push(...(dependencies.issuesByCard.get(card.id) ?? []));
  }

  // Columns: configured phases in order, then unknown directories.
  const columnKey = (phase: string) => (card: TicketCard): OrderKey => ({
    id: card.id,
    priority: card.meta.priority,
    rank: card.meta.rank,
    entered: card.meta.entered[phase] ?? '',
  });
  const columns: BoardColumn[] = phases.map((phase) => {
    const tickets = byPhase.get(phase.id) ?? [];
    return {
      phase,
      unknown: false,
      tickets: orderColumn(tickets, columnKey(phase.id), pipelineParse.priorities),
    };
  });
  for (const dir of [...byPhase.keys()].sort()) {
    if (!knownDirs.has(dir)) {
      issues.push({ level: 'warning', message: `directory "${dir}" is not a phase in pipeline.md` });
      columns.push({
        phase: phaseWithoutPoolKeys({ id: dir, title: dir, wip: null, claim: false, handover: 'manual' }),
        unknown: true,
        tickets: orderColumn(byPhase.get(dir)!, columnKey(dir), pipelineParse.priorities),
      });
    }
  }

  return {
    vaultId: input.vaultId,
    vaultName: input.vaultName,
    activeVaultName: input.activeVaultName,
    isGitRepo: input.isGitRepo,
    defaultWorker: input.defaultWorker,
    pipeline: phases,
    pipelineError: pipelineParse.error,
    pushRemote: pipelineParse.pushRemote,
    priorities: pipelineParse.priorities,
    repos: reposParse.repos,
    reposError: reposParse.error,
    columns,
    issues,
    checkpoints: [...checkpointPhaseIds(columns)],
    // With a Ready to try stage, Done asks nothing and no other group lists it: without this a ticket
    // accepted there vanishes (D-13). Without that stage its terminal column is a Needs-you row.
    recentDone: phaseIds.has(READY_STATE)
      ? withTerminalTickets(input.recentDone ?? [], (byPhase.get(terminalPhase) ?? []).map((card) => ({ card, text: textById.get(card.id) ?? '' })), terminalPhase, Date.now())
      : [...(input.recentDone ?? [])],
  };
}
