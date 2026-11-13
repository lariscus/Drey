// i18n: catalog
/**
 * Settings → Projects (req-284, board 7m): a top-level Settings category,
 * master-detail — the projects left (colour dot, name, open tickets, *New
 * project*), the selected project right (`projects-detail.ts`). It reads the
 * board snapshot's `projects`, `repos.md` and this device's vault registry,
 * writes through the engine's `projectSave` / `projectRemove` /
 * `projectAddRepo` (one commit each, applied as made — no Save) and follows
 * the board's change events, so it never shows a copy that drifted from disk.
 */
import type { DreyPluginApi, PluginSettingsPageContrib } from '../../../../shared/plugin-api/renderer';
import type { BoardSnapshot, RepoCandidate, RepoRef, ReposListing } from '../../shared/tickets';
import type { ProjectDraft, ProjectReply } from '../../../../packages/tickets-engine/src/contracts/project-commands';
import type { ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';
import { h } from '../desk-deps';
import { dot, iconBtn } from './projects-dom';
import { colorOf, draftOf, freshColor, newProjectName, ticketCounts } from './projects-model';
import type { ProjectsContext } from './projects-context';
import { projectDetail, type ProjectDetail } from './projects-detail';

interface PageState {
  projects: readonly ProjectRecord[];
  counts: ReadonlyMap<string, number>;
  repos: readonly string[];
  vaults: readonly string[];
  selected: string | null;
}

function failureOf(reply: unknown): string | null {
  const r = reply as ProjectReply | null;
  return r?.ok === true ? null : (r?.error ?? '');
}

export function createProjectsSettingsPage(api: DreyPluginApi): PluginSettingsPageContrib {
  const t = api.i18n.t.bind(api.i18n);
  return {
    id: 'projects',
    label: t('projects.settings.label'),
    hint: t('projects.settings.hint'),
    bare: true,
    entries: [
      { key: 'projects', label: t('projects.settings.label'), description: t('projects.settings.entry') },
      { key: 'projects.vaults', label: t('projects.vaults'), description: t('projects.settings.entry_vaults') },
    ],
    mount: (body) => mountProjectsPage(api, body),
  };
}

function mountProjectsPage(api: DreyPluginApi, body: HTMLElement): () => void {
  const t = api.i18n.t.bind(api.i18n);
  body.classList.add('prj');
  const list = h('div', 'prj-list');
  const detailHost = h('div', 'prj-detail-host');
  const status = h('span', 'prj-status');
  status.setAttribute('role', 'status');
  const main = h('div', 'prj-main');
  main.append(list, detailHost);
  body.append(main, status);
  const state: PageState = { projects: [], counts: new Map(), repos: [], vaults: [], selected: null };
  let detail: ProjectDetail | null = null;
  let shown = '';
  let disposed = false;

  /** "Saved · committed just now", aging by the minute; a failure stays until the next write. */
  let savedAt: number | null = null;
  const paintSaved = (): void => {
    if (savedAt !== null) {
      status.textContent = t('projects.saved', { minutes: Math.floor((Date.now() - savedAt) / 60_000) });
    }
  };
  const ticker = setInterval(paintSaved, 30_000);
  const report = (error: string | null): boolean => {
    savedAt = error === null ? Date.now() : null;
    status.classList.toggle('prj-status-error', error !== null);
    if (error === null) {
      paintSaved();
    } else {
      status.textContent = t('projects.not_saved', { error });
    }
    return error === null;
  };
  const latest = (id: string): ProjectRecord => state.projects.find((p) => p.id === id) ?? { id, name: id, color: '', repos: [], folders: [], vaults: {}, purpose: '' };
  const put = (record: ProjectRecord): void => {
    state.projects = state.projects.some((p) => p.id === record.id) ? state.projects.map((p) => (p.id === record.id ? record : p)) : [...state.projects, record];
  };
  const ctx: ProjectsContext = {
    api,
    t,
    repoNames: () => state.repos,
    vaultNames: () => state.vaults,
    latest,
    save: async (id, patch) => {
      const next: ProjectRecord = { ...latest(id), ...patch };
      put(next);
      const reply = await api.backend.invoke('projectSave', { id, project: draftOf(next) });
      return report(failureOf(reply));
    },
    addRepo: async (id, repo: RepoRef) => report(failureOf(await api.backend.invoke('projectAddRepo', { id, repo }))),
    remove: async (id) => {
      const ok = report(failureOf(await api.backend.invoke('projectRemove', { id })));
      if (ok) {
        state.selected = null;
        await load();
      }
      return ok;
    },
    pickFolder: async () => {
      const picked = (await api.backend.invoke('pickFolder')) as { path?: string } | null;
      return typeof picked?.path === 'string' ? picked.path : null;
    },
    scanFolder: async (): Promise<readonly RepoCandidate[]> => {
      const folder = await ctx.pickFolder();
      if (folder === null) {
        return [];
      }
      const found = (await api.backend.invoke('scanRepos', { folder })) as { ok?: boolean; candidates?: readonly RepoCandidate[]; error?: string };
      if (found.ok !== true) {
        report(found.error ?? t('projects.no_repository'));
        return [];
      }
      if ((found.candidates ?? []).length === 0) {
        report(t('projects.no_repository'));
      }
      return found.candidates ?? [];
    },
  };

  const create = async (): Promise<void> => {
    const draft: ProjectDraft = { name: newProjectName(t('projects.new_name'), state.projects.map((p) => p.name)), color: freshColor(state.projects), repos: [], folders: [], vaults: {}, purpose: '' };
    const reply = (await api.backend.invoke('projectSave', { project: draft })) as ProjectReply;
    if (report(failureOf(reply)) && reply.ok) {
      state.selected = reply.id;
      await load();
      body.querySelector<HTMLInputElement>('.prj-input')?.select();
    }
  };

  const drawList = (): void => {
    const head = h('div', 'prj-list-head');
    head.append(h('span', 'prj-list-title', t('projects.settings.label')), h('span', 'prj-grow'), iconBtn(api, 'plus', t('projects.new'), () => void create()));
    list.replaceChildren(head);
    for (const project of state.projects) {
      const item = h('button', 'prj-item');
      item.type = 'button';
      item.setAttribute('aria-current', String(project.id === state.selected));
      item.append(dot(colorOf(project)), h('span', 'prj-item-name', project.name), h('span', 'prj-item-count', t('projects.ticket_count', { count: state.counts.get(project.id) ?? 0 })));
      item.addEventListener('click', () => {
        if (project.id !== state.selected) {
          detail?.flush();
          state.selected = project.id;
          draw();
        }
      });
      list.append(item);
    }
  };

  /** The detail is rebuilt only when what it shows changed (a rebuild would take the caret from the editor). */
  const drawDetail = (): void => {
    const project = state.projects.find((p) => p.id === state.selected) ?? null;
    const key = project === null ? '' : JSON.stringify([project, state.repos, state.vaults]);
    if (key === shown) {
      return;
    }
    shown = key;
    detail?.dispose();
    detail = project === null ? null : projectDetail(ctx, project);
    detailHost.replaceChildren(detail?.element ?? h('p', 'prj-empty', t('projects.empty')));
  };

  const draw = (): void => {
    drawList();
    drawDetail();
  };

  const load = async (): Promise<void> => {
    const [snap, repos, vaults] = await Promise.all([
      api.backend.invoke('board') as Promise<BoardSnapshot>,
      api.backend.invoke('reposListing') as Promise<ReposListing>,
      api.vault.listVaults().catch(() => []),
    ]);
    if (disposed) {
      return;
    }
    state.projects = snap.projects ?? [];
    state.counts = ticketCounts(snap.columns.flatMap((c) => c.tickets), state.projects);
    state.repos = repos.repos.map((r) => r.name);
    // The tickets vault itself is no source: no worker's vault tool reaches it (ADR-0094).
    state.vaults = vaults.filter((v) => v.id !== (snap.vaultId ?? null)).map((v) => v.name);
    if (state.selected === null || !state.projects.some((p) => p.id === state.selected)) {
      state.selected = state.projects[0]?.id ?? null;
    }
    draw();
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  const off = api.backend.on('board-changed', () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void load().catch(() => undefined);
    }, 250);
  });
  void load().catch(() => undefined);
  return () => {
    disposed = true;
    clearInterval(ticker);
    detail?.flush();
    detail?.dispose();
    off();
    if (timer !== null) {
      clearTimeout(timer);
    }
  };
}
