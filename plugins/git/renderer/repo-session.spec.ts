import { describe, expect, it, vi } from 'vitest';
import type { DreyPluginApi } from '../../../shared/plugin-api/renderer';
import type { GitChange, GitStatus, VaultGitState } from '../shared/status.js';
import { createRepoSession } from './repo-session.js';

const status = (staged: number): GitStatus => ({
  branch: 'main',
  head: 'abc1234',
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: Array.from({ length: staged }, (_, i) => ({ path: `f${i}.md`, kind: 'modified' }) satisfies GitChange),
  unstaged: [],
  conflicts: [],
});

const repo = (staged: number): VaultGitState => ({
  vaultId: 'v',
  state: 'ok',
  root: '/repo',
  prefix: '',
  status: status(staged),
  stagedOutside: 0,
  operation: null,
  fetchedAt: null,
  stashCount: 0,
  managedBy: null,
  subPath: '',
  discovered: false,
});

/** A host with only what the session touches; `invoke` answers every backend call with the next queued state. */
function fakeApi(answers: VaultGitState[][]): { api: DreyPluginApi; refreshStatus: ReturnType<typeof vi.fn> } {
  const refreshStatus = vi.fn();
  const api = {
    ui: { refreshStatus, setFileDecorations: vi.fn(), showMessage: vi.fn(() => Promise.resolve()) },
    vault: { listVaults: () => Promise.resolve([{ id: 'v', name: 'v' }]) },
    documents: { active: () => null, list: () => [] },
    backend: { invoke: () => Promise.resolve(answers.shift() ?? []), on: vi.fn() },
    i18n: { t: (key: string) => key },
  } as unknown as DreyPluginApi;
  return { api, refreshStatus };
}

describe('the Source control state and the panel header (D-64)', () => {
  it('tells the shell to re-read the header status after a refresh that changed what it reads', async () => {
    const { api, refreshStatus } = fakeApi([[repo(3)], [repo(0)]]);
    const session = createRepoSession(api);
    // What the header status reads at the moment the shell is told (the dock re-reads it then).
    const headerCountAtRefresh: number[] = [];
    refreshStatus.mockImplementation(() => {
      const ok = session.currentOk();
      headerCountAtRefresh.push(ok === null ? 0 : ok.status.staged.length);
    });

    await session.pull('cached');
    expect(headerCountAtRefresh.at(-1)).toBe(3);

    // The Refresh empties the lists: no document event, no vault round -- only this state change.
    await session.pull('refresh');
    expect(headerCountAtRefresh.at(-1)).toBe(0);
  });

  it('also does it when main pushes a status or another repository is picked', () => {
    const { api, refreshStatus } = fakeApi([]);
    const session = createRepoSession(api);
    session.applyStates([repo(1)]);
    const afterApply = refreshStatus.mock.calls.length;
    expect(afterApply).toBeGreaterThan(0);
    session.select('v');
    expect(refreshStatus.mock.calls.length).toBeGreaterThan(afterApply);
  });
});
