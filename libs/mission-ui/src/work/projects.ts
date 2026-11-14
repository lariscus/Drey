/**
 * Mission Control's own project filter (req-298, board 7n's look): the
 * board's projects as `/api/board` sends them (`projects`, milestone 263),
 * the choices the filter offers, which tickets a choice shows, the chip a
 * card carries under *All projects*, and the device-local choice itself
 * (localStorage — this device's lens, not the desktop view's).
 *
 * `ticketProjectIdOf` is a local copy of the engine's `ticketProjectId`
 * (`packages/tickets-engine/src/contracts/projects.ts`; the lib imports
 * nothing from the engine, like `hold.ts`). Pure, apart from the two storage
 * helpers at the end.
 */

/** The default colour a project without one is drawn in (the desktop's first preset). */
export const DEFAULT_PROJECT_COLOR = '#8ecbef';

/** The *Unassigned* choice's id; a project id never starts with an underscore. */
export const UNASSIGNED_FILTER = '_unassigned';

/** A project as the filter and the chip draw it. */
export interface McProject {
  readonly id: string;
  readonly name: string;
  /** `#rrggbb`, the default filled in. */
  readonly color: string;
}

/** The filter's choice: a project id, {@link UNASSIGNED_FILTER}, or null for all projects. */
export type McProjectFilter = string | null;

/** One row of the filter's menu after *All projects*. */
export interface McProjectChoice {
  readonly id: string;
  readonly label: string;
  /** '' = the dashed dot (*Unassigned*). */
  readonly color: string;
  /** Only *Unassigned* counts its tickets (board 7n). */
  readonly count?: number;
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
 * only project while there is exactly one; else null (Unassigned). The
 * engine's `ticketProjectId`, restated.
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

/** The choice in effect: a project that went away (or a board with fewer than two projects) reads as all. */
export function filterInEffectOf(filter: McProjectFilter, projects: readonly McProject[]): McProjectFilter {
  if (filter === null || !filterShownOf(projects)) {
    return null;
  }
  return filter === UNASSIGNED_FILTER || projects.some((project) => project.id === filter) ? filter : null;
}

/** The menu's rows after *All projects*: each project, then *Unassigned* with its count. */
export function projectChoicesOf(projects: readonly McProject[], named: readonly (string | null | undefined)[], unassignedLabel: string): readonly McProjectChoice[] {
  const choices: McProjectChoice[] = projects.map((project) => ({ id: project.id, label: project.name, color: project.color }));
  const count = named.filter((project) => ticketProjectIdOf(project, projects) === null).length;
  return [...choices, { id: UNASSIGNED_FILTER, label: unassignedLabel, color: '', count }];
}

/** True when a ticket (its own `project:`) shows under the choice in effect. */
export function inProjectFilter(named: string | null | undefined, filter: McProjectFilter, projects: readonly McProject[]): boolean {
  if (filter === null) {
    return true;
  }
  const id = ticketProjectIdOf(named, projects);
  return filter === UNASSIGNED_FILTER ? id === null : id === filter;
}

/** A card's chip: only under *All projects*, on a board with two projects or more, for a ticket of a known project. */
export function projectChipOf(named: string | null | undefined, filter: McProjectFilter, projects: readonly McProject[]): McProjectChip | null {
  if (filter !== null || !filterShownOf(projects)) {
    return null;
  }
  const id = ticketProjectIdOf(named, projects);
  const project = projects.find((known) => known.id === id);
  return project === undefined ? null : { label: project.name, color: project.color };
}

/** The filter button's dot under *All projects*: a wheel of the first three colours (board 7n). */
export function allProjectsDotOf(projects: readonly McProject[]): string {
  const colors = projects.map((project) => project.color).slice(0, 3);
  if (colors.length === 0) {
    return 'var(--text-3)';
  }
  const step = 100 / colors.length;
  return `conic-gradient(${colors.map((color, i) => `${color} 0 ${Math.round(step * (i + 1))}%`).join(', ')})`;
}

/** The project Pia's new tickets go to: the filtered project; none under all or *Unassigned* (she asks). */
export function chatProjectOf(filter: McProjectFilter): string | undefined {
  return filter === null || filter === UNASSIGNED_FILTER ? undefined : filter;
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

/** The open columns' cards, each once, with its own `project:` (what *Unassigned* counts). */
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

/** This device's last choice; null (all) when none is stored or the storage is blocked. */
export function storedProjectFilter(storage: FilterStorage | null): McProjectFilter {
  try {
    const raw = storage?.getItem(STORAGE_KEY) ?? null;
    return raw !== null && (raw === UNASSIGNED_FILTER || PROJECT_ID.test(raw)) ? raw : null;
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
