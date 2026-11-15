import { describe, expect, it, vi } from 'vitest';
import { parseGithubRepo } from '../core/skills/skill-source';
import { GithubError } from './github-client';
import { HttpGithubClient } from './http-github-client';

const REPO = parseGithubRepo('acme/skills')!;

/** A `fetch` that answers from a table of URL -> response; no request leaves the process. */
function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    const route = routes[url];
    if (route === undefined) {
      return new Response('{}', { status: 404 });
    }
    return route();
  });
}

const json = (body: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const client = (fetch: ReturnType<typeof fakeFetch>, maxFileBytes = 1024) => new HttpGithubClient({ apiBase: 'https://api.test/', rawBase: 'https://raw.test', fetch, maxFileBytes });

describe('HttpGithubClient', () => {
  it('reads a ref\'s commit and tree, a file and the tags over the API and raw', async () => {
    const fetch = fakeFetch({
      'https://api.test/repos/acme/skills/commits/release%2F1': () => json({ sha: 'c1', commit: { tree: { sha: 't1' } } }),
      'https://api.test/repos/acme/skills/git/trees/t1?recursive=1': () => json({ tree: [{ path: 'a/SKILL.md', type: 'blob', size: 3 }, { path: 'a', type: 'tree' }, { bogus: 1 }], truncated: false }),
      'https://raw.test/acme/skills/c1/a/my%20file.md': () => new Response('hey'),
      'https://api.test/repos/acme/skills/tags?per_page=100': () => json([{ name: 'v1.4' }, { name: 'v1.5' }, {}]),
    });
    const github = client(fetch);
    expect(await github.commitOf(REPO, 'release/1')).toEqual({ sha: 'c1', tree: 't1' });
    expect(await github.treeOf(REPO, 't1')).toEqual({ entries: [{ path: 'a/SKILL.md', type: 'blob', size: 3 }, { path: 'a', type: 'tree' }], truncated: false });
    expect(new TextDecoder().decode(await github.fileOf(REPO, 'c1', 'a/my file.md'))).toBe('hey');
    expect(await github.tagsOf(REPO)).toEqual(['v1.4', 'v1.5']);
    const init = fetch.mock.calls[0]![1]!;
    expect(init.headers).toMatchObject({ 'user-agent': 'Drey', accept: 'application/vnd.github+json' });
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
  });

  it('says not found (and that a private repository is not supported), a spent rate limit, and any other status', async () => {
    const github = client(
      fakeFetch({
        'https://api.test/repos/acme/skills/commits/limited': () => json({}, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
        'https://api.test/repos/acme/skills/commits/busy': () => json({}, { status: 503 }),
      }),
    );
    await expect(github.commitOf(REPO, 'main')).rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('private repository') });
    await expect(github.commitOf(REPO, 'limited')).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(github.commitOf(REPO, 'busy')).rejects.toMatchObject({ code: 'fetch_failed', message: expect.stringContaining('503') });
  });

  it('turns a network failure into fetch_failed and refuses a file over the bound', async () => {
    const down = new HttpGithubClient({ apiBase: 'https://api.test', rawBase: 'https://raw.test', maxFileBytes: 4, fetch: vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))) });
    await expect(down.tagsOf(REPO)).rejects.toBeInstanceOf(GithubError);
    await expect(down.tagsOf(REPO)).rejects.toMatchObject({ code: 'fetch_failed', message: expect.stringContaining('ECONNREFUSED') });
    const big = client(fakeFetch({ 'https://raw.test/acme/skills/c1/big': () => new Response('0123456789') }), 4);
    await expect(big.fileOf(REPO, 'c1', 'big')).rejects.toMatchObject({ code: 'fetch_failed' });
  });

  it('refuses an answer that carries no commit', async () => {
    const github = client(fakeFetch({ 'https://api.test/repos/acme/skills/commits/main': () => json({ message: 'odd' }) }));
    await expect(github.commitOf(REPO, 'main')).rejects.toMatchObject({ code: 'fetch_failed' });
  });
});
