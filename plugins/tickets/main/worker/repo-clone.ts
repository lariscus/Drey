/**
 * Clones a repository for Settings → Projects (req-304): the URL checked
 * (`shared/git-url.ts`), the checkout `<parent>/<repository name>` — a folder
 * that already holds something is refused before git runs — then the
 * installed git with `--progress`, whose phases are handed on as they print.
 * One clone at a time; `cancel` kills it and removes what it had begun.
 * Registering the checkout is not this class's business (the engine's
 * `projectAddFolder` does it, one commit).
 */
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { checkGitUrl } from '../../shared/git-url';
import { classifyCloneFailure, cleanCloneMessage, progressOfLine, type CloneFailureCode, type CloneProgress } from './repo-clone-errors';
import type { GitLauncher, GitProcess } from './repo-clone-process';

export interface CloneRequest {
  readonly url: string;
  /** The folder the owner picked; the checkout goes into a subfolder named after the repository. */
  readonly parent: string;
}

export type CloneResult =
  | { readonly ok: true; readonly path: string; readonly name: string }
  | { readonly ok: false; readonly code: CloneFailureCode; readonly error: string };

type TargetState = 'free' | 'empty' | 'taken';

async function targetState(target: string): Promise<TargetState> {
  try {
    return (await fsp.readdir(target)).length === 0 ? 'empty' : 'taken';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'free' : 'taken';
  }
}

const refuse = (code: CloneFailureCode, error: string): CloneResult => ({ ok: false, code, error });

export class RepoCloner {
  private running: GitProcess | null = null;
  private active = false;
  private cancelled = false;

  constructor(private readonly launch: GitLauncher) {}

  /** True while a clone runs. */
  get busy(): boolean {
    return this.active;
  }

  async clone(request: CloneRequest, onProgress: (progress: CloneProgress) => void): Promise<CloneResult> {
    if (this.active) {
      return refuse('busy', 'a clone is already running');
    }
    const checked = checkGitUrl(request.url);
    if (!checked.ok) {
      return refuse(checked.problem === 'credentials' ? 'credentials' : 'bad_url', checked.problem);
    }
    this.active = true;
    try {
      const target = path.join(request.parent, checked.name);
      const before = await targetState(target);
      return before === 'taken' ? refuse('exists', target) : await this.run(checked.url, checked.name, target, before, onProgress);
    } finally {
      this.active = false;
    }
  }

  /** Kills the running clone; the clone call then resolves `cancelled`. */
  cancel(): void {
    if (this.running !== null) {
      this.cancelled = true;
      this.running.kill();
    }
  }

  private async run(url: string, name: string, target: string, before: TargetState, onProgress: (progress: CloneProgress) => void): Promise<CloneResult> {
    this.cancelled = false;
    let pending = '';
    const onStderr = (chunk: string): void => {
      const lines = (pending + chunk).split(/[\r\n]+/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const progress = progressOfLine(line);
        if (progress !== null) {
          onProgress(progress);
        }
      }
    };
    const child = this.launch(['-c', 'protocol.ext.allow=never', 'clone', '--progress', '--', url, target], path.dirname(target), onStderr);
    this.running = child;
    try {
      const outcome = await child.done;
      if (this.cancelled) {
        await this.discard(target, before);
        return refuse('cancelled', '');
      }
      if (outcome.missing) {
        return refuse('no_git', 'git');
      }
      if (outcome.code !== 0) {
        await this.discard(target, before);
        const message = cleanCloneMessage(outcome.stderr);
        return refuse(classifyCloneFailure(message), message);
      }
      return { ok: true, path: target, name };
    } finally {
      this.running = null;
    }
  }

  /** Removes what a clone that did not finish left: the folder it made, or the contents of the empty one it was given. */
  private async discard(target: string, before: TargetState): Promise<void> {
    if (before === 'free') {
      await fsp.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
      return;
    }
    for (const entry of await fsp.readdir(target).catch(() => [] as string[])) {
      await fsp.rm(path.join(target, entry), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
    }
  }
}
