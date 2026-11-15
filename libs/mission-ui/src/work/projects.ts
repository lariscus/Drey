/**
 * Mission Control's own project filter (req-298, board 7n's look; req-308:
 * one project is always active — no *All projects*, no *Unassigned*): the
 * board's projects as `/api/board` sends them (`projects`, milestone 263),
 * the choice in effect (a board without projects is the only null), which
 * tickets a choice shows, and the device-local choice itself (localStorage
 * — this device's lens, not the desktop view's).
 *
 * `ticketProjectIdOf` is a local copy of the engine's `ticketProjectId`
 * (`packages/tickets-engine/src/contracts/projects.ts`; the lib imports
 * nothing from the engine, like `hold.ts`). Pure, apart from the two storage
 * helpers at the end.
 */

/** The default colour a project without one is drawn in (the desktop's first preset). */
export const DEFAULT_PROJECT_COLOR = '#8ecbef';

/** A project as the filter and the chip draw it. */
export interface McProject {
  readonly id: string;
  readonly name: string;
  /** `#rrggbb`, the default filled in. */
  readonly color: string;
}

/**
 * The filter's choice: a project id; null only while the board has no
 * projects at all (a choice is then not in effect — the filter is not drawn).
 */
export type McProjectFilter = string | null;

/** One row of the filter's menu. */
export interface McProjectChoice {
  readonly id: string;
  readonly label: string;
  readonly color: string;
}

/** A card's project chip. */
export interface McProjectChip {
  readonly label: string;
  readonly color: string;
}

const PROJECT_ID = /^[a-z0-9][a-z0-9-]*$/;
const COLOR = /^#[0-9a-f]{6}$/i;

type Rec = Record<string, unknown>;
const rec = (raw: unknown): Rec | null => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Rec) : null);

/** The board's projects, tolerantly read (junk entries drop out); [] for a board without project records. */
export function projectsOf(board: { readonly projects?: unknown } | null | undefined): readonly McProject[] {
  const raw = board?.projects;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: McProject[] = [];
  for (const entry of raw) {
    const project = rec(entry);
    const id = typeof project?.['id'] === 'string' ? project['id'] : '';
    if (project === null || !PROJECT_ID.test(id) || out.some((known) => known.id === id)) {
      continue;
    }
    const name = typeof project['name'] === 'string' && project['name'].trim() !== '' ? project['name'].trim() : id;
    const color = typeof project['color'] === 'string' && COLOR.test(project['color']) ? project['color'] : DEFAULT_PROJECT_COLOR;
    out.push({ id, name, color });
  }
  return out;
}

/**
 * The project a ticket belongs to: its own `project:`; with none, the board's
 * only project while there is exactly one; else null. The engine's
 * `ticketProjectId`, restated.
 */
export function ticketProjectIdOf(named: string | null | undefined, projects: readonly Pick<McProject, 'id'>[]): string | null {
  const id = named?.trim() ?? '';
  if (id !== '') {
    return id;
  }
  return projects.length === 1 ? projects[0]!.id : null;
}

/** True when the filter is worth drawing: with fewer than two projects every choice shows the same board. */
export function filterShownOf(projects: readonly McProject[]): boolean {
  return projects.length >= 2;
}

/**
 * The choice in effect: the stored project while the board knows it, else
 * the board's first project — one of them is always active; null only on a
 * board without projects.
 */
export function filterInEffectOf(filter: McProjectFilter, projects: readonly McProject[]): McProjectFilter {
  if (projects.length === 0) {
    return null;
  }
  return projects.some((project) => project.id === filter) ? filter : projects[0]!.id;
}

/** The menu's rows: each project, in the board's order. */
export function projectChoicesOf(projects: readonly McProject[]): readonly McProjectChoice[] {
  return projects.map((project) => ({ id: project.id, label: project.name, color: project.color }));
}

/** True when a ticket (its own `project:`) shows under the choice; a ticket of a project the board does not have shows under none. */
export function inProjectFilter(named: string | null | undefined, filter: McProjectFilter, projects: readonly McProject[]): boolean {
  if (filter === null) {
    return true;
  }
  return ticketProjectIdOf(named, projects) === filter;
}

/** The project Pia's new tickets go to: the choice in effect; undefined on a board without projects (she asks). */
export function chatProjectOf(filter: McProjectFilter): string | undefined {
  return filter ?? undefined;
}

/**
 * Every ticket id the board names, with its own `project:` — the open
 * columns' cards and Done this week's entries. A list row or a need is
 * looked up here by its ticket id; an id the board does not hold is not in
 * the map (its row stays under every choice).
 */
export function ticketProjectsOf(board: unknown): ReadonlyMap<string, string | null> {
  const out = new Map<string, string | null>(openTicketProjectsOf(board));
  const body = rec(board);
  for (const entry of Array.isArray(body?.['recentDone']) ? (body!['recentDone'] as unknown[]) : []) {
    const done = rec(entry);
    const id = typeof done?.['id'] === 'string' ? done['id'] : '';
    if (id !== '' && !out.has(id)) {
      out.set(id, ownProject(done!['project']));
    }
  }
  return out;
}

/** The open columns' cards, each once, with its own `project:`. */
export function openTicketProjectsOf(board: unknown): ReadonlyMap<string, string | null> {
  const out = new Map<string, string | null>();
  const body = rec(board);
  for (const column of Array.isArray(body?.['columns']) ? (body!['columns'] as unknown[]) : []) {
    const tickets = rec(column)?.['tickets'];
    for (const ticket of Array.isArray(tickets) ? (tickets as unknown[]) : []) {
      const card = rec(ticket);
      const id = typeof card?.['id'] === 'string' ? card['id'] : '';
      if (id !== '' && !out.has(id)) {
        out.set(id, ownProject(rec(card!['meta'])?.['project']));
      }
    }
  }
  return out;
}

function ownProject(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

// --- the device-local choice ---------------------------------------------------

const STORAGE_KEY = 'mc.project-filter';

/** The storage slice the choice needs (a `Storage` or a test fake). */
export interface FilterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** This device's last choice; null when none is stored, the storage is blocked, or the stored id is no project id. */
export function storedProjectFilter(storage: FilterStorage | null): McProjectFilter {
  try {
    const raw = storage?.getItem(STORAGE_KEY) ?? null;
    return raw !== null && PROJECT_ID.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Remembers the choice on this device; a blocked storage keeps it for this session only. */
export function storeProjectFilter(storage: FilterStorage | null, filter: McProjectFilter): void {
  try {
    if (filter === null) {
      storage?.removeItem(STORAGE_KEY);
    } else {
      storage?.setItem(STORAGE_KEY, filter);
    }
  } catch {
    /* storage blocked */
  }
}
