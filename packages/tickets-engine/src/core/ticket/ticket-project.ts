/**
 * The board's project checks of one ticket (req-282): a named project must
 * exist; a working ticket must belong to one (an inbox ticket may stay
 * Unassigned, a finished one is left alone); its repositories must be its
 * project's. A board without project records checks nothing — the engine's
 * start writes the first one (`ProjectMigrator`).
 */
import { ticketProject, type ProjectRecord } from '../../contracts/projects';
import type { TicketIssue } from '../../contracts/tickets';

export interface TicketProjectFacts {
  /** The ticket's own `project:`; null/absent = none named. */
  readonly project?: string | null;
  readonly repos: readonly string[];
}

/** The issues of one ticket; `working` = it stands in neither the first column (inbox) nor the last (done). */
export function ticketProjectIssues(meta: TicketProjectFacts, working: boolean, projects: readonly ProjectRecord[]): TicketIssue[] {
  if (projects.length === 0) {
    return [];
  }
  const named = meta.project?.trim() ?? '';
  if (named !== '' && !projects.some((p) => p.id === named)) {
    return [{ level: 'warning', message: `project "${named}" is not in _meta/projects/` }];
  }
  const project = ticketProject(named, projects);
  if (project === null) {
    return working ? [{ level: 'warning', message: 'a working ticket needs a project (project:)' }] : [];
  }
  return meta.repos
    .filter((name) => !project.repos.includes(name))
    .map((name): TicketIssue => ({ level: 'warning', message: `repo "${name}" is not a repo of project "${project.name}"` }));
}
