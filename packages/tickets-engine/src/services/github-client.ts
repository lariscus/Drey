import type { GithubRepo, TreeEntry } from '../core/skills/skill-source';

/**
 * What the skills library asks of GitHub (req-289): a ref's commit, the
 * commit's file tree, one file's bytes, the repository's tags. The port the
 * fetcher and the update look call; `HttpGithubClient` is the one adapter
 * (public repositories, no token), the specs hand a fake. A failure throws a
 * {@link GithubError} with the code the page explains.
 */
export interface GithubClient {
  commitOf(repo: GithubRepo, ref: string): Promise<{ readonly sha: string; readonly tree: string }>;
  treeOf(repo: GithubRepo, tree: string): Promise<{ readonly entries: readonly TreeEntry[]; readonly truncated: boolean }>;
  fileOf(repo: GithubRepo, commit: string, path: string): Promise<Uint8Array>;
  tagsOf(repo: GithubRepo): Promise<readonly string[]>;
}

export type GithubErrorCode = 'not_found' | 'rate_limited' | 'fetch_failed';

export class GithubError extends Error {
  constructor(
    readonly code: GithubErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GithubError';
  }
}
