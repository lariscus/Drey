import type { GithubRepo, TreeEntry } from '../core/skill-source';
import { GithubError, type GithubClient } from './github-client';

/**
 * The GitHub adapter of the skills library (req-289): the REST API for a
 * ref's commit, a tree and the tags, `raw.githubusercontent.com` for the
 * files (outside the API's hourly limit of 60 unauthenticated calls). No
 * token, no credentials: a public repository only — a private one answers
 * 404 and is said so. The bases are options so an e2e points them at a local
 * fake (`DREY_GITHUB_API_URL`, `DREY_GITHUB_RAW_URL`); `fetch` is one so a
 * spec never reaches the network.
 */

export interface HttpGithubOptions {
  readonly apiBase: string;
  readonly rawBase: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** The largest file read, in bytes. */
  readonly maxFileBytes: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const PRIVATE_HINT = 'check the repository, the path and the ref — a private repository is not supported yet';

type Json = Record<string, unknown>;

const segments = (path: string): string => path.split('/').map(encodeURIComponent).join('/');
const repoPath = (repo: GithubRepo): string => `${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

export class HttpGithubClient implements GithubClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpGithubOptions) {
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async commitOf(repo: GithubRepo, ref: string): Promise<{ readonly sha: string; readonly tree: string }> {
    const body = (await this.api(`/repos/${repoPath(repo)}/commits/${encodeURIComponent(ref)}`, `${repo.repo}@${ref}`)) as Json;
    const commit = body['commit'] as Json | undefined;
    const tree = (commit?.['tree'] as Json | undefined)?.['sha'];
    if (typeof body['sha'] !== 'string' || typeof tree !== 'string') {
      throw new GithubError('fetch_failed', `GitHub's answer for ${repo.repo}@${ref} carries no commit`);
    }
    return { sha: body['sha'], tree };
  }

  async treeOf(repo: GithubRepo, tree: string): Promise<{ readonly entries: readonly TreeEntry[]; readonly truncated: boolean }> {
    const body = (await this.api(`/repos/${repoPath(repo)}/git/trees/${encodeURIComponent(tree)}?recursive=1`, repo.repo)) as Json;
    const raw = Array.isArray(body['tree']) ? (body['tree'] as Json[]) : [];
    const entries = raw.flatMap((entry): TreeEntry[] =>
      typeof entry['path'] === 'string' && (entry['type'] === 'blob' || entry['type'] === 'tree' || entry['type'] === 'commit')
        ? [{ path: entry['path'], type: entry['type'], ...(typeof entry['size'] === 'number' ? { size: entry['size'] } : {}) }]
        : [],
    );
    return { entries, truncated: body['truncated'] === true };
  }

  async fileOf(repo: GithubRepo, commit: string, path: string): Promise<Uint8Array> {
    const url = `${this.options.rawBase.replace(/\/+$/, '')}/${repoPath(repo)}/${encodeURIComponent(commit)}/${segments(path)}`;
    const res = await this.get(url, {}, `${repo.repo}/${path}`);
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > this.options.maxFileBytes) {
      throw new GithubError('fetch_failed', `${path} is larger than a skill may be`);
    }
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.byteLength > this.options.maxFileBytes) {
      throw new GithubError('fetch_failed', `${path} is larger than a skill may be`);
    }
    return data;
  }

  async tagsOf(repo: GithubRepo): Promise<readonly string[]> {
    const body = await this.api(`/repos/${repoPath(repo)}/tags?per_page=100`, repo.repo);
    return Array.isArray(body) ? body.flatMap((tag: unknown) => (tag !== null && typeof tag === 'object' && typeof (tag as Json)['name'] === 'string' ? [(tag as Json)['name'] as string] : [])) : [];
  }

  private async api(pathname: string, what: string): Promise<unknown> {
    const res = await this.get(`${this.options.apiBase.replace(/\/+$/, '')}${pathname}`, { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, what);
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new GithubError('fetch_failed', `GitHub's answer for ${what} does not read`);
    }
  }

  private async get(url: string, headers: Record<string, string>, what: string): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(url, { headers: { 'user-agent': 'Drey', ...headers }, signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    } catch (error) {
      throw new GithubError('fetch_failed', `GitHub could not be reached for ${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (res.ok) {
      return res;
    }
    throw this.failure(res, what);
  }

  private failure(res: Response, what: string): GithubError {
    if (res.status === 404 || res.status === 422) {
      return new GithubError('not_found', `${what} was not found on GitHub — ${PRIVATE_HINT}`);
    }
    if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
      return new GithubError('rate_limited', 'GitHub\'s limit for calls without a sign-in is reached for this hour — try again later');
    }
    return new GithubError('fetch_failed', `GitHub answered ${res.status} for ${what}`);
  }
}
