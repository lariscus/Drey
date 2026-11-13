/**
 * The title bar's project filter as the tickets plugin fills and reads it
 * (req-285, board 7n): one choice per project (its vaults and folders as
 * the Files panel's sources) and *Unassigned* with its count; which tickets
 * a choice shows; the chip a card carries under *All projects*; the project
 * a capture lands in. Pure — the registration is in `index.ts`.
 */
import type { WorkspaceScopeOption } from '../../../../shared/plugin-api/renderer';
import { ticketProjectId, type ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';
import { colorOf } from './projects-model';

/** The id of the *Unassigned* choice; a project id never has the leading underscore. */
export const UNASSIGNED_SCOPE = '_unassigned';

interface ScopedTicket {
  readonly meta: { readonly project?: string };
}

/** The choices for the snapshot's projects; *Unassigned* only on a board that can have unassigned tickets (not with exactly one project). */
export function scopeOptionsOf(projects: readonly ProjectRecord[], tickets: readonly ScopedTicket[], unassignedLabel: string): readonly WorkspaceScopeOption[] {
  const options: WorkspaceScopeOption[] = projects.map((project) => ({
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
  if (projects.length !== 1) {
    const count = tickets.filter((t) => ticketProjectId(t.meta.project, projects) === null).length;
    options.push({ id: UNASSIGNED_SCOPE, label: unassignedLabel, color: '', count, sources: null });
  }
  return options;
}

/** True when the ticket shows under the choice (null = all). */
export function inScope(ticket: ScopedTicket, scope: Pick<WorkspaceScopeOption, 'id'> | null, projects: readonly Pick<ProjectRecord, 'id'>[]): boolean {
  if (scope === null) {
    return true;
  }
  const id = ticketProjectId(ticket.meta.project, projects);
  return scope.id === UNASSIGNED_SCOPE ? id === null : id === scope.id;
}

/** A card's project chip: only under *All projects*, only on a board with more than one project, and only for a ticket that has a known project. */
export interface ProjectChip {
  readonly label: string;
  readonly color: string;
}

export function chipOf(ticket: ScopedTicket, scope: unknown, projects: readonly ProjectRecord[]): ProjectChip | null {
  if (scope !== null || projects.length < 2) {
    return null;
  }
  const id = ticketProjectId(ticket.meta.project, projects);
  const project = id === null ? undefined : projects.find((p) => p.id === id);
  return project === undefined ? null : { label: project.name, color: colorOf(project) };
}

/** The project a capture lands in: the filtered project; none under all or *Unassigned*. */
export function captureProjectOf(scope: Pick<WorkspaceScopeOption, 'id'> | null): string | undefined {
  return scope === null || scope.id === UNASSIGNED_SCOPE ? undefined : scope.id;
}
