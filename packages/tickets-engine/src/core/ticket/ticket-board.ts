/**
 * Pure board assembly (ADR-0076): parses the `_meta` configuration,
 * orders columns (derived order — the order.md pins went with the kanban
 * board, req-75), and folds parsed
 * tickets into a snapshot shape. No IO — `index.ts` feeds it files and
 * paths, the specs feed it fixtures. Everything here is deterministic:
 * the same files always produce the same board (no stored state).
 */
import { isCollection, isMap, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import { splitFrontmatter } from '../../../../../shared/frontmatter';
import {
  DEFAULT_PRIORITY_CONFIG,
  parsePriorityConfig,
  priorityWeight,
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
} from '../../contracts/tickets';
import { runDependencyPass } from './blocked';
import { parseProjects } from '../projects/project-record';
import { parseRepos } from '../projects/repos-file';
import { parseTicketFile, ticketPathParts } from './ticket-files';
import { ticketProjectIssues } from './ticket-project';
import { pipelinePhaseOf } from '../pipeline/pipeline-phase';
import { CLOSING_SIGNALS_KEY, parseClosingSignals, type ClosingSignal } from '../pipeline/closing-signals';
import { FLOW_KEY, PROPOSE_FLOW_KEY, parsePipelineFlow, parseProposeFlow } from '../pipeline/pipeline-flow';
import type { ChainEntry } from '../../contracts/chain';

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
  /** req-169: `closing-signals:` — the signals that earn a run its closing round; set on a successful parse. */
  readonly closingSignals?: readonly ClosingSignal[];
  /** req-266: `flow:` — the standard flow; set on a successful parse (empty = none). */
  readonly flow?: readonly ChainEntry[];
  /** E10-5b: `propose-flow:` — the plan persona proposes a flow for every new plan; set on a successful parse. */
  readonly proposeFlow?: boolean;
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
  const closingSignals = parseClosingSignals(root[CLOSING_SIGNALS_KEY], issues);
  const flow = parsePipelineFlow(root[FLOW_KEY], issues);
  const proposeFlow = parseProposeFlow(root[PROPOSE_FLOW_KEY], issues);
  return { phases, pushRemote, priorities, error: null, issues, closingSignals, flow, proposeFlow };
}


// --- repos.md: core/repos-file.ts (req-177) ----------------------------------

export { parseRepos, reposFileText, reposProse, type ReposParse } from '../projects/repos-file';

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
  /** The project records (`tickets/_meta/projects/*.md`, req-282); other paths are skipped. Default: none. */
  readonly projectFiles?: readonly BoardFile[];
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
  // req-282: the projects, and per ticket the project checks (a working ticket outside the first and last column).
  const projectsParse = parseProjects(input.projectFiles ?? []);
  issues.push(...projectsParse.warnings.map((message): TicketIssue => ({ level: 'warning', message })));
  const edgePhases = new Set([phases[0]?.id, phases[phases.length - 1]?.id]);

  // Parse every ticket; group by directory. Cards stay mutable through
  // the duplicate and dependency passes, then flow into columns as-is
  // (structural match).
  interface AssemblyCard extends TicketCard {
    issues: TicketIssue[];
    blocked: readonly string[];
    blocks: readonly string[];
  }
  const byPhase = new Map<string, AssemblyCard[]>();
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
    parsed.issues.push(...ticketProjectIssues(parsed.meta, !edgePhases.has(parts.phase), projectsParse.projects));
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
        phase: { id: dir, title: dir, color: null },
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
    ...(pipelineParse.closingSignals !== undefined ? { closingSignals: pipelineParse.closingSignals } : {}),
    ...(pipelineParse.flow !== undefined && pipelineParse.flow.length > 0 ? { flow: pipelineParse.flow } : {}),
    ...(pipelineParse.proposeFlow === true ? { proposeFlow: true } : {}),
    priorities: pipelineParse.priorities,
    repos: reposParse.repos,
    reposError: reposParse.error,
    ...(projectsParse.projects.length > 0 ? { projects: projectsParse.projects } : {}),
    columns,
    issues,
    checkpoints: [], // the persona board has no owner checkpoint column (req-307); the field stays on the contract
    recentDone: [...(input.recentDone ?? [])],
  };
}
