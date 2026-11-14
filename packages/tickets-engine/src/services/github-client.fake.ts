import type { GithubRepo, TreeEntry } from '../core/skill-source';
import { GithubError, type GithubClient } from './github-client';

interface FakeRepo {
  /** ref (tag or branch) -> commit sha */
  readonly refs: Record<string, string>;
  /** commit sha -> path -> text */
  readonly commits: Record<string, Record<string, string>>;
  readonly tags: readonly string[];
}

/** GitHub as a spec sees it: repositories of text files at commits, no network. Every call is logged in `calls`. */
export class FakeGithub implements GithubClient {
  readonly calls: string[] = [];
  private readonly repos = new Map<string, FakeRepo>();
  /** The next call throws this, once. */
  failNext: GithubError | null = null;

  /** `name` is `owner/repo`. */
  set(name: string, repo: FakeRepo): void {
    this.repos.set(name, repo);
  }

  async commitOf(repo: GithubRepo, ref: string): Promise<{ readonly sha: string; readonly tree: string }> {
    const sha = this.repoOf(repo, `commit ${ref}`).refs[ref];
    if (sha === undefined) {
      throw new GithubError('not_found', `${repo.repo}@${ref} was not found`);
    }
    return { sha, tree: `tree-${sha}` };
  }

  async treeOf(repo: GithubRepo, tree: string): Promise<{ readonly entries: readonly TreeEntry[]; readonly truncated: boolean }> {
    const files = this.repoOf(repo, `tree ${tree}`).commits[tree.replace(/^tree-/, '')] ?? {};
    const dirs = new Set(Object.keys(files).flatMap((path) => path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
    const entries: TreeEntry[] = [...[...dirs].map((path) => ({ path, type: 'tree' as const })), ...Object.entries(files).map(([path, text]) => ({ path, type: 'blob' as const, size: text.length }))];
    return { entries, truncated: false };
  }

  async fileOf(repo: GithubRepo, commit: string, path: string): Promise<Uint8Array> {
    const text = this.repoOf(repo, `file ${path}`).commits[commit]?.[path];
    if (text === undefined) {
      throw new GithubError('not_found', `${path} was not found`);
    }
    return new TextEncoder().encode(text);
  }

  async tagsOf(repo: GithubRepo): Promise<readonly string[]> {
    return this.repoOf(repo, 'tags').tags;
  }

  private repoOf(repo: GithubRepo, call: string): FakeRepo {
    this.calls.push(`${repo.owner}/${repo.name} ${call}`);
    const failure = this.failNext;
    if (failure !== null) {
      this.failNext = null;
      throw failure;
    }
    const found = this.repos.get(`${repo.owner}/${repo.name}`);
    if (found === undefined) {
      throw new GithubError('not_found', `${repo.repo} was not found`);
    }
    return found;
  }
}
