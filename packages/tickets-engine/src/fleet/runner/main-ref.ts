import { gitOutputOf, type LeavingGit } from '../chain/leaving-git';

/** What "main" is for one repository: the ref to merge, and where it is pushed. */
export interface MainTarget {
  /** The integration branch's name (`repos.md` `branch:`). */
  readonly branch: string;
  /** The ref a merge reads: `origin/main` after a fetch, or the local `main` without an upstream. */
  readonly ref: string;
  /** The upstream's remote; null = the branch has none, the merge lands on the local branch. */
  readonly remote: string | null;
  /** The branch's name on the remote (usually `branch`); null without a remote. */
  readonly remoteBranch: string | null;
}

export type MainResolution = { readonly ok: true; readonly target: MainTarget } | { readonly ok: false; readonly error: string };

/**
 * Resolves "main" for the leaving actions (req-267): the integration
 * branch's git upstream, fetched first, so `sync-main` and the commit see
 * what has landed on the remote, not a local branch the owner has not pulled.
 * A branch without an upstream is used as it is. Git's own notion decides,
 * not a remote named by convention.
 */
export class MainRef {
  constructor(private readonly git: LeavingGit) {}

  async resolve(repoPath: string, branch: string): Promise<MainResolution> {
    const upstream = await this.upstreamOf(repoPath, branch);
    if (upstream === null) {
      return this.local(repoPath, branch);
    }
    try {
      await this.git.run(repoPath, ['fetch', upstream.remote, upstream.remoteBranch]);
    } catch (error) {
      return { ok: false, error: `git fetch ${upstream.remote} ${upstream.remoteBranch} failed — ${gitOutputOf(error)}` };
    }
    return { ok: true, target: { branch, ref: `${upstream.remote}/${upstream.remoteBranch}`, remote: upstream.remote, remoteBranch: upstream.remoteBranch } };
  }

  /** Fetches the remote branch again (a retry after a refused push, the proof after a push). */
  async refetch(repoPath: string, target: MainTarget): Promise<string | null> {
    if (target.remote === null || target.remoteBranch === null) {
      return null;
    }
    try {
      await this.git.run(repoPath, ['fetch', target.remote, target.remoteBranch]);
      return null;
    } catch (error) {
      return `git fetch ${target.remote} ${target.remoteBranch} failed — ${gitOutputOf(error)}`;
    }
  }

  private async local(repoPath: string, branch: string): Promise<MainResolution> {
    try {
      await this.git.run(repoPath, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]);
    } catch {
      return { ok: false, error: `the integration branch ${branch} does not exist in ${repoPath}` };
    }
    return { ok: true, target: { branch, ref: branch, remote: null, remoteBranch: null } };
  }

  /** `branch.<b>.remote` and `branch.<b>.merge` — null when the branch tracks nothing or tracks a local branch. */
  private async upstreamOf(repoPath: string, branch: string): Promise<{ remote: string; remoteBranch: string } | null> {
    const remote = await this.config(repoPath, `branch.${branch}.remote`);
    const merge = await this.config(repoPath, `branch.${branch}.merge`);
    if (remote === null || merge === null || remote === '.' || !merge.startsWith('refs/heads/')) {
      return null;
    }
    return { remote, remoteBranch: merge.slice('refs/heads/'.length) };
  }

  private async config(repoPath: string, key: string): Promise<string | null> {
    const value = await this.git.run(repoPath, ['config', '--get', key]).catch(() => '');
    return value.trim() === '' ? null : value.trim();
  }
}
