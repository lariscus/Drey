/**
 * Settings → Projects' folder and clone channels (req-304), answered here in
 * Drey's own process rather than forwarded to the engine: the system folder
 * picker needs a window the engine process lacks, and the clone streams its
 * progress to the page. Everything that changes the project afterwards is the
 * engine's `projectAddFolder`, one commit.
 */
import type { RepoCloner } from './repo-clone';
import type { CloneProgress } from './repo-clone-errors';

type Handle = (channel: string, handler: (payload: unknown) => unknown) => void;

export interface RepoCloneIpcDeps {
  /** The system folder picker; null when cancelled. */
  readonly pick: (title: string, defaultPath?: string) => Promise<string | null>;
  readonly cloner: Pick<RepoCloner, 'clone' | 'cancel'>;
  /** The engine's invoke channel (`projectAddFolder`). */
  readonly engine: (method: string, payload: unknown) => Promise<unknown>;
  /** Pushes a clone's progress to the page. */
  readonly progress: (progress: CloneProgress) => void;
}

const objectOf = (payload: unknown): Record<string, unknown> => (payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {});
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

export function registerRepoCloneIpc(handle: Handle, deps: RepoCloneIpcDeps): void {
  handle('pickFolder', async (payload) => {
    const { title, defaultPath } = objectOf(payload);
    const chosen = await deps.pick(text(title) ?? '', text(defaultPath) ?? undefined);
    return chosen === null ? { ok: true } : { ok: true, path: chosen };
  });
  handle('projectCloneRepo', async (payload) => {
    const { id, url, parent } = objectOf(payload);
    if (text(id) === null || text(url) === null || text(parent) === null) {
      return { ok: false, code: 'invalid', error: 'bad clone payload' };
    }
    const cloned = await deps.cloner.clone({ url: url as string, parent: parent as string }, deps.progress);
    if (!cloned.ok) {
      return cloned;
    }
    const registered = objectOf(await deps.engine('projectAddFolder', { id, folder: cloned.path, repoOnly: true }));
    return { ...registered, path: cloned.path };
  });
  handle('projectCloneCancel', () => {
    deps.cloner.cancel();
    return { ok: true };
  });
}
