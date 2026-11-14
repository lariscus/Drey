// i18n: catalog
/**
 * Settings → Projects (req-284, board 7m): a top-level Settings category,
 * master-detail — the projects left (colour dot, name, open tickets, *New
 * project*), the selected project right (`projects-detail.ts`). It reads the
 * board snapshot's `projects`, `repos.md` and this device's vault registry,
 * writes through the engine's `projectSave` / `projectRemove` /
 * `projectAddFolder` (one commit each, applied as made — no Save) and follows
 * the board's change events, so it never shows a copy that drifted from disk.
 */
import type { DreyPluginApi, PluginSettingsPageContrib } from '../../../../shared/plugin-api/renderer';
import type { BoardSnapshot, ReposListing } from '../../shared/tickets';
import type { ProjectDraft, ProjectFolderReply, ProjectReply } from '../../../../packages/tickets-engine/src/contracts/project-commands';
import type { ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';
import { h } from '../desk-deps';
import { dot, iconBtn } from './projects-dom';
import { colorOf, draftOf, freshColor, newProjectName, ticketCounts } from './projects-model';
import type { CloneProgressEvent, FolderOutcome, ProjectsContext } from './projects-context';
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

/** The words for a refused folder or clone: the catalog's line for the code, the engine's or git's own text where there is no better one. */
export function failureText(t: ProjectsContext['t'], code: string | undefined, error: string | undefined): string {
  const detail = error ?? '';
  switch (code) {
    case 'not_a_repository':
      return t('projects.no_repository');
    case 'not_a_folder':
      return t('projects.not_a_folder');
    case 'bad_url':
      return t('projects.clone_error.bad_url');
    case 'credentials':
      return t('projects.clone_error.credentials');
    case 'auth':
      return t('projects.clone_error.auth');
    case 'offline':
      return t('projects.clone_error.offline');
    case 'not_found':
      return t('projects.clone_error.not_found');
    case 'no_git':
      return t('projects.clone_error.no_git');
    case 'busy':
      return t('projects.clone_error.busy');
    case 'exists':
      return t('projects.clone_error.exists', { path: detail });
    case 'git':
      return t('projects.clone_error.git', { detail });
    default:
      return detail;
  }
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
  /** A reply of `projectAddFolder` / `projectCloneRepo` as the page shows it; after a write the page reloads, so `latest` follows. */
  const outcomeOf = async (reply: unknown): Promise<FolderOutcome> => {
    const r = (reply ?? {}) as Partial<ProjectFolderReply> & { code?: string; error?: string };
    if (r.ok === true && (r.kind === 'repository' || r.kind === 'folder') && typeof r.name === 'string') {
      report(null);
      await load().catch(() => undefined);
      return { ok: true, kind: r.kind, name: r.name };
    }
    if (r.code === 'cancelled') {
      return { ok: false, message: '', cancelled: true };
    }
    const message = failureText(t, r.code, r.error);
    report(message);
    return { ok: false, message };
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
    remove: async (id) => {
      const ok = report(failureOf(await api.backend.invoke('projectRemove', { id })));
      if (ok) {
        state.selected = null;
        await load();
      }
      return ok;
    },
    pickFolder: async (title) => {
      const picked = (await api.backend.invoke('pickFolder', { title })) as { path?: string } | null;
      return typeof picked?.path === 'string' ? picked.path : null;
    },
    addFolder: async (id, folder, repoOnly) => outcomeOf(await api.backend.invoke('projectAddFolder', { id, folder, repoOnly })),
    cloneRepo: async (id, url, parent, onProgress) => {
      const off = api.backend.on('repo-clone-progress', (data) => onProgress(data as CloneProgressEvent));
      try {
        return await outcomeOf(await api.backend.invoke('projectCloneRepo', { id, url, parent }));
      } finally {
        off();
      }
    },
    cancelClone: () => void api.backend.invoke('projectCloneCancel').catch(() => undefined),
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
