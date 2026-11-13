// i18n: catalog
/**
 * The tickets plugin's half of the title bar's project filter (req-285,
 * board 7n): it registers the filter (SDK 1.59, `ui.registerWorkspaceScope`),
 * hands it the snapshot's projects after every board read, and tells the
 * views what the active view's choice means for them — the cards the board
 * and the Tickets panel show, the chip under *All projects*, the project a
 * capture lands in. Columns, their load and the pool chip are not filtered:
 * the pool is cross-project (the concept's §4).
 */
import type { DreyPluginApi, Unsubscribe, WorkspaceScopeOption } from '../../../../shared/plugin-api/renderer';
import type { BoardSnapshot } from '../../shared/tickets';
import type { BoardScope } from '../desk-deps';
import { captureProjectOf, chipOf, inScope, scopeOptionsOf } from './project-scope';

export interface ProjectFilter {
  /** A fresh board: the filter's choices follow its projects and the Unassigned count. */
  update(snap: BoardSnapshot): void;
  /** What the board views apply; null = all with no chips (a board with one project or none). */
  boardScope(): BoardScope | null;
  /** The snapshot with only the chosen project's open tickets (the Tickets panel's list). */
  scoped(snap: BoardSnapshot): BoardSnapshot;
  /** The project a capture lands in; undefined = none named (all, Unassigned). */
  captureProject(): string | undefined;
  dispose(): void;
}

export function createProjectFilter(api: DreyPluginApi, deps: { snapshot(): BoardSnapshot | null; repaint(): void }): ProjectFilter {
  const t = api.i18n.t.bind(api.i18n);
  const handle = api.ui.registerWorkspaceScope({
    label: t('projects.filter.label'),
    allLabel: t('projects.filter.all'),
    manageLabel: t('projects.filter.manage'),
    manage: () => api.commands.run('settings.open', { category: 'projects' }),
  });
  let shown = '';
  const update = (snap: BoardSnapshot): void => {
    const options = scopeOptionsOf(snap.projects ?? [], snap.columns.flatMap((c) => c.tickets), t('projects.filter.unassigned'));
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
      const scope = current();
      if (scope === null && projects.length < 2) {
        return null;
      }
      return { filtered: scope !== null, shows: (card) => inScope(card, scope, projects), chip: (card) => chipOf(card, scope, projects) };
    },
    scoped: (snap) => {
      const scope = current();
      if (scope === null) {
        return snap;
      }
      const projects = snap.projects ?? [];
      return { ...snap, columns: snap.columns.map((column) => ({ ...column, tickets: column.tickets.filter((card) => inScope(card, scope, projects)) })) };
    },
    captureProject: () => captureProjectOf(current()),
    dispose: () => {
      off();
      handle.dispose();
    },
  };
}
