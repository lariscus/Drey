// i18n: catalog
/**
 * The tickets plugin's half of the title bar's project filter (req-285,
 * board 7n; req-308: one project is always active — the filter offers no
 * *All projects* and no *Unassigned*): it registers the filter (SDK 1.59,
 * `ui.registerWorkspaceScope`, no all-choice since SDK 1.61), hands it the
 * snapshot's projects after every board read, and tells the views what the
 * active view's choice means for them — the cards the board and the Tickets
 * panel show, the project a capture lands in. Columns, their load and the
 * pool chip are not filtered: the pool is cross-project (the concept's §4).
 * A board with fewer than two projects offers no choices at all (the
 * control stays hidden, as Mission Control's filter does) and filters
 * nothing: every ticket is that project's or belongs to none.
 */
import type { DreyPluginApi, Unsubscribe, WorkspaceScopeOption } from '../../../../shared/plugin-api/renderer';
import type { BoardSnapshot } from '../../shared/tickets';
import type { BoardScope } from '../board/desk-deps';
import { captureProjectOf, inScope, scopeOptionsOf } from './project-scope';

export interface ProjectFilter {
  /** A fresh board: the filter's choices follow its projects. */
  update(snap: BoardSnapshot): void;
  /** What the board views apply; null = fewer than two projects (nothing to narrow). */
  boardScope(): BoardScope | null;
  /** The snapshot with only the chosen project's open tickets (the Tickets panel's list). */
  scoped(snap: BoardSnapshot): BoardSnapshot;
  /** The project a capture lands in; undefined on a board with fewer than two projects. */
  captureProject(): string | undefined;
  dispose(): void;
}

export function createProjectFilter(api: DreyPluginApi, deps: { snapshot(): BoardSnapshot | null; repaint(): void }): ProjectFilter {
  const t = api.i18n.t.bind(api.i18n);
  const handle = api.ui.registerWorkspaceScope({
    label: t('projects.filter.label'),
    manageLabel: t('projects.filter.manage'),
    manage: () => api.commands.run('settings.open', { category: 'projects' }),
  });
  let shown = '';
  const update = (snap: BoardSnapshot): void => {
    const projects = snap.projects ?? [];
    const options = projects.length >= 2 ? scopeOptionsOf(projects) : [];
    const key = JSON.stringify(options);
    if (key !== shown) {
      shown = key;
      handle.setOptions(options);
    }
  };
  const current = (): WorkspaceScopeOption | null => api.ui.workspaceScope();
  const off: Unsubscribe = api.ui.onWorkspaceScopeChange(() => deps.repaint());
  const initial = deps.snapshot();
  if (initial !== null) {
    update(initial);
  }
  return {
    update,
    boardScope: () => {
      const projects = deps.snapshot()?.projects ?? [];
      if (projects.length < 2) {
        return null;
      }
      const scope = current();
      if (scope === null) {
        return null;
      }
      return { filtered: true, shows: (card) => inScope(card, scope, projects) };
    },
    scoped: (snap) => {
      const projects = snap.projects ?? [];
      if (projects.length < 2) {
        return snap;
      }
      const scope = current();
      if (scope === null) {
        return snap;
      }
      return { ...snap, columns: snap.columns.map((column) => ({ ...column, tickets: column.tickets.filter((card) => inScope(card, scope, projects)) })) };
    },
    captureProject: () => captureProjectOf(current()),
    dispose: () => {
      off();
      handle.dispose();
    },
  };
}
