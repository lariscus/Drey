/**
 * Projects (req-282, the concept `project-handling-draft.md` §1/§2): the work
 * scope a ticket happens in — a name, a colour, the purpose, the repositories
 * of `repos.md` the work lands in, plain folders and the vaults a worker may
 * read or write. One record per project in `tickets/_meta/projects/<id>.md`
 * (the vault layer of R13, beside `repos.md`); a ticket names its project in
 * `project:` (`x-project` on a store).
 *
 * Pure and yaml-free: the renderer and the phone client read these types and
 * {@link ticketProjectId}; the record's parser lives in `core/project-record.ts`.
 */

/** Where the project records live, vault-relative. */
export const PROJECTS_DIR = 'tickets/_meta/projects';

/** A project id: the record's file stem — lowercase letters, digits and dashes. */
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** What a project lets its runs do with one vault; `none` is the explicit "never", the same as leaving it out. */
export type ProjectVaultAccess = 'none' | 'read' | 'write';

export const PROJECT_VAULT_ACCESS: readonly ProjectVaultAccess[] = ['none', 'read', 'write'];

/** One project record, as read from its file. */
export interface ProjectRecord {
  /** The file stem under {@link PROJECTS_DIR}. */
  readonly id: string;
  readonly name: string;
  /** `#rrggbb`; '' = none set (a client draws its default). */
  readonly color: string;
  /** Names from `_meta/repos.md`, primary first. */
  readonly repos: readonly string[];
  /** Plain folders a worker may read (never written, never a run's home), as written. */
  readonly folders: readonly string[];
  /** By the vault's registered NAME (ids are per device), each `none | read | write`. */
  readonly vaults: Readonly<Record<string, ProjectVaultAccess>>;
  /** The record's body: a few sentences that ride the run brief as `## Project` (ADR-0097). */
  readonly purpose: string;
}

/** The ticket's own field (`TicketMeta`). */
export interface TicketProjectField {
  /**
   * `project: drey` (`x-project` on a store). Absent = none named: the board's
   * only project while there is one, else Unassigned ({@link ticketProjectId}).
   */
  readonly project?: string;
}

/** The board's own field (`BoardSnapshot`). */
export interface BoardProjects {
  /**
   * `_meta/projects/*.md`, sorted by id; absent = a board without project
   * records (the engine's start writes the first one).
   */
  readonly projects?: readonly ProjectRecord[];
}

/**
 * The project a ticket belongs to: its own `project:` when it names one; with
 * none, the board's only project while there is exactly one; else null —
 * Unassigned (an inbox ticket may stay so; a working one is a board issue).
 * A named project the board does not know is returned as named: the board
 * reports it, a filter shows it nowhere but under its own id.
 */
export function ticketProjectId(named: string | null | undefined, projects: readonly Pick<ProjectRecord, 'id'>[]): string | null {
  const id = named?.trim() ?? '';
  if (id !== '') {
    return id;
  }
  return projects.length === 1 ? projects[0]!.id : null;
}

/** The record of a ticket's project ({@link ticketProjectId}); null for Unassigned or an unknown id. */
export function ticketProject<P extends Pick<ProjectRecord, 'id'>>(named: string | null | undefined, projects: readonly P[]): P | null {
  const id = ticketProjectId(named, projects);
  return id === null ? null : (projects.find((p) => p.id === id) ?? null);
}
