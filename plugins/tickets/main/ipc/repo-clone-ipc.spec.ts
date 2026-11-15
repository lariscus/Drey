import { describe, expect, it } from 'vitest';
import { registerRepoCloneIpc, type RepoCloneIpcDeps } from './repo-clone-ipc';
import type { CloneResult } from '../worker/repo-clone';

function rig(over: Partial<RepoCloneIpcDeps> = {}) {
  const handlers = new Map<string, (payload: unknown) => unknown>();
  const engineCalls: [string, unknown][] = [];
  const picks: [string, string | undefined][] = [];
  const cancels: number[] = [];
  registerRepoCloneIpc((channel, handler) => handlers.set(channel, handler), {
    pick: (title, defaultPath) => (picks.push([title, defaultPath]), Promise.resolve('E:/picked')),
    cloner: {
      clone: (): Promise<CloneResult> => Promise.resolve({ ok: true, path: 'E:/picked/drey', name: 'drey' }),
      cancel: () => void cancels.push(1),
    },
    engine: (method, payload) => (engineCalls.push([method, payload]), Promise.resolve({ ok: true, id: 'home', kind: 'repository', name: 'drey' })),
    progress: () => undefined,
    ...over,
  });
  const call = (channel: string, payload?: unknown): Promise<unknown> => Promise.resolve(handlers.get(channel)!(payload));
  return { call, engineCalls, picks, cancels };
}

describe('the folder and clone channels (req-304)', () => {
  it('opens the picker with the page’s title and answers the chosen path', async () => {
    const r = rig();
    expect(await r.call('pickFolder', { title: 'Add folder' })).toEqual({ ok: true, path: 'E:/picked' });
    expect(r.picks).toEqual([['Add folder', undefined]]);
  });

  it('answers ok without a path when the picker is cancelled', async () => {
    const r = rig({ pick: () => Promise.resolve(null) });
    expect(await r.call('pickFolder')).toEqual({ ok: true });
  });

  it('registers a finished clone through the engine and names the checkout', async () => {
    const r = rig();
    expect(await r.call('projectCloneRepo', { id: 'home', url: 'https://example.com/drey.git', parent: 'E:/picked' })).toEqual({ ok: true, id: 'home', kind: 'repository', name: 'drey', path: 'E:/picked/drey' });
    expect(r.engineCalls).toEqual([['projectAddFolder', { id: 'home', folder: 'E:/picked/drey', repoOnly: true }]]);
  });

  it('hands a failed clone back and registers nothing', async () => {
    const r = rig({ cloner: { clone: () => Promise.resolve({ ok: false, code: 'auth', error: 'denied' }), cancel: () => undefined } });
    expect(await r.call('projectCloneRepo', { id: 'home', url: 'https://example.com/drey.git', parent: 'E:/picked' })).toEqual({ ok: false, code: 'auth', error: 'denied' });
    expect(r.engineCalls).toEqual([]);
  });

  it('refuses a payload without project, url or folder, and cancels on request', async () => {
    const r = rig();
    expect(await r.call('projectCloneRepo', { id: 'home' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await r.call('projectCloneCancel')).toEqual({ ok: true });
    expect(r.cancels).toHaveLength(1);
  });
});
