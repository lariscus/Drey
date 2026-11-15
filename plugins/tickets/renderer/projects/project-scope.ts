/**
 * The title bar's project filter as the tickets plugin fills and reads it
 * (req-285, board 7n; req-308: one project is always active — no *All
 * projects*, no *Unassigned*): one choice per project (its vaults and
 * folders as the Files panel's sources); which tickets a choice shows; a
 * ticket's project chip (the review head names it); the project a capture
 * lands in. Pure — the registration is in `index.ts`.
 */
import type { WorkspaceScopeOption } from '../../../../shared/plugin-api/renderer';
import { ticketProjectId, type ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';
import { colorOf } from './projects-model';

interface ScopedTicket {
  readonly meta: { readonly project?: string };
}

/** The choices for the snapshot's projects — the projects, nothing else. */
export function scopeOptionsOf(projects: readonly ProjectRecord[]): readonly WorkspaceScopeOption[] {
  return projects.map((project) => ({
    id: project.id,
    label: project.name,
    color: colorOf(project),
    sources: {
      vaults: Object.entries(project.vaults)
        .filter(([, access]) => access !== 'none')
        .map(([name, access]) => ({ name, readOnly: access === 'read' })),
      folders: [...project.folders],
    },
  }));
}

/** True when the ticket shows under the choice (null = the transient no-choice: everything shows). */
export function inScope(ticket: ScopedTicket, scope: Pick<WorkspaceScopeOption, 'id'> | null, projects: readonly Pick<ProjectRecord, 'id'>[]): boolean {
  if (scope === null) {
    return true;
  }
  return ticketProjectId(ticket.meta.project, projects) === scope.id;
}

/** A ticket's project chip: the ticket's own known project, whatever the filter shows. */
export interface ProjectChip {
  readonly label: string;
  readonly color: string;
}

export function chipOf(ticket: ScopedTicket, projects: readonly ProjectRecord[]): ProjectChip | null {
  // A board with one project names nothing (every ticket is its); from two on the ticket's own `project:` names it.
  if (projects.length < 2) {
    return null;
  }
  const id = ticketProjectId(ticket.meta.project, projects);
  const project = id === null ? undefined : projects.find((p) => p.id === id);
  return project === undefined ? null : { label: project.name, color: colorOf(project) };
}

/** The project a capture lands in: the chosen one; undefined only before the choices exist. */
export function captureProjectOf(scope: Pick<WorkspaceScopeOption, 'id'> | null): string | undefined {
  return scope === null ? undefined : scope.id;
}
