import type { PhoneWorkGroup } from './phone-rows';
import {
  filterInEffectOf,
  inProjectFilter,
  projectChoicesOf,
  projectsOf,
  ticketProjectsOf,
  type McProject,
  type McProjectChoice,
  type McProjectFilter,
} from './projects';
import type { McDoneEntry, WorkGroup } from './work.model';

/**
 * The project filter applied to Mission Control's Work list (req-298; req-308:
 * one project is always active): which rows a choice shows. The list is built
 * for every project first — so a holder group's load (and the fleet chip, the
 * capacity, the pool) counts every project, as on the desktop board — and the
 * rows are narrowed afterwards; a group left without rows leaves, as an empty
 * group always does on Mission Control's list. A row is matched by its ticket
 * id; a row without one (a need of no ticket) and a ticket the board does not
 * hold stay under every choice.
 */
export interface WorkProjectScope {
  readonly projects: readonly McProject[];
  /** The choice in effect (a project that went away reads as the board's first); null = a board without projects. */
  readonly filter: McProjectFilter;
  /** Ticket id → its own `project:` (the open columns and Done this week). */
  readonly byTicket: ReadonlyMap<string, string | null>;
}

/** The scope of one board read and this device's choice. */
export function workProjectScopeOf(board: unknown, filter: McProjectFilter | undefined): WorkProjectScope {
  const projects = projectsOf(board as { readonly projects?: unknown } | null);
  return { projects, filter: filterInEffectOf(filter ?? null, projects), byTicket: ticketProjectsOf(board) };
}

/** The filter's menu rows for this board: the projects, in the board's order. */
export function workProjectChoicesOf(scope: WorkProjectScope): readonly McProjectChoice[] {
  return projectChoicesOf(scope.projects);
}

/** True when the ticket's row shows under the choice; a row of no ticket, or a ticket the board does not hold, always does. */
export function showsTicket(scope: WorkProjectScope, id: string | null | undefined): boolean {
  if (scope.filter === null || id === null || id === undefined || id === '' || !scope.byTicket.has(id)) {
    return true;
  }
  return inProjectFilter(scope.byTicket.get(id), scope.filter, scope.projects);
}

/** The phone's and the iPad's groups narrowed to the choice; the loads stay as computed over every project. */
export function scopedPhoneGroupsOf(groups: readonly PhoneWorkGroup[], scope: WorkProjectScope): readonly PhoneWorkGroup[] {
  if (scope.filter === null) {
    return groups;
  }
  return groups.flatMap((group) => {
    const rows = group.rows.filter((row) => showsTicket(scope, row.ticketId));
    return rows.length === 0 ? [] : [{ ...group, rows }];
  });
}

/** The desk's wide list narrowed the same way: the need cards and the cards of each group. */
export function scopedWorkGroupsOf(groups: readonly WorkGroup[], scope: WorkProjectScope): WorkGroup[] {
  if (scope.filter === null) {
    return [...groups];
  }
  return groups.flatMap((group): WorkGroup[] => {
    if (group.kind === 'needs') {
      const needs = group.needs.filter((vm) => showsTicket(scope, vm.need.ticketId));
      return needs.length === 0 ? [] : [{ ...group, needs }];
    }
    const tickets = group.tickets.filter((vm) => showsTicket(scope, vm.id));
    return tickets.length === 0 ? [] : [{ ...group, tickets }];
  });
}

/** Done this week's entries under the choice. */
export function scopedDoneOf(done: readonly McDoneEntry[], scope: WorkProjectScope): readonly McDoneEntry[] {
  return scope.filter === null ? done : done.filter((entry) => showsTicket(scope, entry.id));
}
