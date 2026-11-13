/**
 * The Find panel's project scope (req-285, SDK 1.59): the "Look in" row
 * offered only while the title bar's choice narrows, a project-scope run
 * kept to the project's vaults, and the fallback to the vault scope when
 * the choice stops narrowing.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  DreyPluginApi,
  TagSearchHit,
  WorkspaceScopeOption,
} from '../../../shared/plugin-api/renderer';
import { lookInRows, type FindMenuRow } from './find-menu.js';
import { createSearchSession } from './search-session.js';

const DREY: WorkspaceScopeOption = {
  id: 'drey',
  label: 'Drey',
  color: '#8ecbef',
  sources: { vaults: [{ name: 'Drey notes', readOnly: false }], folders: ['E:/specs'] },
};
const UNASSIGNED: WorkspaceScopeOption = { id: 'none', label: 'Unassigned', color: '', sources: null };

function hit(path: string, vaultId: string): TagSearchHit {
  return { path, line: 3, heading: 'H', snippet: 'alpha', vaultId } as TagSearchHit;
}

interface Fake {
  api: DreyPluginApi;
  setScope(option: WorkspaceScopeOption | null): void;
  searchSections: ReturnType<typeof vi.fn>;
  dirty: Array<{ kind: string; dirty: boolean; vaultId: string; path: string; name: string; buffer: string }>;
}

function fakeApi(scope: WorkspaceScopeOption | null): Fake {
  let current = scope;
  const scopeListeners = new Set<() => void>();
  const dirty: Fake['dirty'] = [];
  const searchSections = vi.fn(async () => [
    hit('a.md', 'v1'),
    hit('b.md', 'v2'),
    hit('c.md', 'v3'),
  ]);
  const api = {
    ui: {
      workspaceScope: () => current,
      onWorkspaceScopeChange: (listener: () => void) => {
        scopeListeners.add(listener);
        return () => scopeListeners.delete(listener);
      },
    },
    vault: {
      listVaults: async () => [
        { id: 'v1', name: 'Drey notes', active: false },
        { id: 'v2', name: 'Work notes', active: true },
        { id: 'v3', name: 'Private', active: false },
      ],
      onChanged: () => () => undefined,
    },
    search: { searchSections },
    documents: { list: () => dirty, active: () => null },
  } as unknown as DreyPluginApi;
  return {
    api,
    searchSections,
    dirty,
    setScope: (option) => {
      current = option;
      for (const listener of [...scopeListeners]) {
        listener();
      }
    },
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const labels = (rows: FindMenuRow[]): string[] => rows.map((row) => ('label' in row ? row.label : ''));

const t = ((key: string, params?: Record<string, unknown>) =>
  params?.['project'] !== undefined ? `${key}:${String(params['project'])}` : key) as DreyPluginApi['i18n']['t'];

describe('the "Look in" group', () => {
  it('offers This project only while the choice narrows', () => {
    for (const option of [null, UNASSIGNED]) {
      const session = createSearchSession(fakeApi(option).api);
      expect(session.projectLabel()).toBeNull();
      expect(labels(lookInRows(t, session.scope(), session.projectLabel(), () => undefined))).toEqual([
        'find.menu.look_in',
        'find.scope.file',
        'find.scope.vault',
        'find.scope.all',
      ]);
    }
    const session = createSearchSession(fakeApi(DREY).api);
    const rows = lookInRows(t, 'project', session.projectLabel(), () => undefined);
    expect(labels(rows).at(-1)).toBe('find.scope.project:Drey');
    expect(labels(rows.filter((row) => row.kind === 'check' && row.checked))).toEqual([
      'find.scope.project:Drey',
    ]);
  });
});

describe('a project-scope search', () => {
  it('searches every vault and keeps the project’s vaults, dirty buffers included', async () => {
    const fake = fakeApi(DREY);
    fake.dirty.push(
      { kind: 'text', dirty: true, vaultId: 'v1', path: 'd.md', name: 'd.md', buffer: '# D\n\nalpha\n' },
      { kind: 'text', dirty: true, vaultId: 'v2', path: 'e.md', name: 'e.md', buffer: '# E\n\nalpha\n' },
    );
    const session = createSearchSession(fake.api);
    session.prefs.scope = 'project';
    session.state.queryText = 'alpha';
    await session.run();
    expect(fake.searchSections).toHaveBeenCalledWith(expect.anything(), { kind: 'all' });
    expect(session.state.hits.map((h) => [h.path, h.vaultId])).toEqual([
      ['a.md', 'v1'],
      ['d.md', 'v1'],
    ]);
    expect([...(session.projectVaultIds() ?? [])]).toEqual(['v1']);
  });

  it('falls back to the vault scope when the choice stops narrowing, and comes back', async () => {
    const fake = fakeApi(DREY);
    const session = createSearchSession(fake.api);
    await settle();
    session.prefs.scope = 'project';
    session.state.queryText = 'alpha';
    await session.run();
    fake.searchSections.mockClear();

    fake.setScope(UNASSIGNED);
    await settle();
    expect(session.scope()).toBe('vault');
    expect(session.prefs.scope).toBe('project');
    expect(session.projectLabel()).toBeNull();
    // The active search re-ran in the active vault.
    expect(fake.searchSections).toHaveBeenCalledWith(expect.anything(), { kind: 'vault', vaultId: 'v2' });

    fake.setScope(DREY);
    await settle();
    expect(session.scope()).toBe('project');
    expect(session.state.hits.map((h) => h.vaultId)).toEqual(['v1']);
  });
});
