import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * GitHub as the skills library's e2e sees it (req-289): a local HTTP server
 * answering the four calls `HttpGithubClient` makes — a ref's commit, a
 * tree, the tags (under `/api`) and a file (under `/raw`) — from repositories
 * of text files held in memory. Drey Service reaches it through
 * `DREY_GITHUB_API_URL` / `DREY_GITHUB_RAW_URL`; nothing leaves the machine.
 */

export interface FakeRepo {
  /** ref (tag or branch) -> commit sha */
  readonly refs: Record<string, string>;
  /** commit sha -> path -> text */
  readonly commits: Record<string, Record<string, string>>;
  readonly tags: readonly string[];
}

export interface FakeGithubServer {
  readonly apiUrl: string;
  readonly rawUrl: string;
  /** Every request path, in order. */
  readonly requests: string[];
  close(): Promise<void>;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function treeOf(files: Record<string, string>): unknown[] {
  const dirs = new Set(Object.keys(files).flatMap((file) => file.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
  return [...[...dirs].map((path) => ({ path, type: 'tree' })), ...Object.entries(files).map(([path, text]) => ({ path, type: 'blob', size: Buffer.byteLength(text) }))];
}

function answerApi(repos: Record<string, FakeRepo>, parts: readonly string[], res: http.ServerResponse): void {
  // /api/repos/<owner>/<repo>/...
  const repo = repos[`${parts[2]}/${parts[3]}`];
  const rest = parts.slice(4);
  if (repo === undefined) {
    json(res, 404, { message: 'Not Found' });
  } else if (rest[0] === 'commits' && rest.length === 2) {
    const sha = repo.refs[decodeURIComponent(rest[1]!)];
    sha === undefined ? json(res, 422, { message: 'No commit found' }) : json(res, 200, { sha, commit: { tree: { sha: `tree-${sha}` } } });
  } else if (rest[0] === 'git' && rest[1] === 'trees' && rest.length === 3) {
    const files = repo.commits[rest[2]!.replace(/^tree-/, '')];
    files === undefined ? json(res, 404, { message: 'Not Found' }) : json(res, 200, { tree: treeOf(files), truncated: false });
  } else if (rest[0] === 'tags') {
    json(res, 200, repo.tags.map((name) => ({ name })));
  } else {
    json(res, 404, { message: 'Not Found' });
  }
}

export async function startFakeGithub(repos: Record<string, FakeRepo>): Promise<FakeGithubServer> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    requests.push(url.pathname);
    const parts = url.pathname.split('/').filter((part) => part !== '');
    if (parts[0] === 'api' && parts[1] === 'repos') {
      answerApi(repos, parts, res);
      return;
    }
    // /raw/<owner>/<repo>/<sha>/<path…>
    const text = parts[0] === 'raw' ? repos[`${parts[1]}/${parts[2]}`]?.commits[parts[3] ?? '']?.[parts.slice(4).map(decodeURIComponent).join('/')] : undefined;
    if (text === undefined) {
      res.writeHead(404);
      res.end('404: Not Found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(text);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    apiUrl: `http://127.0.0.1:${port}/api`,
    rawUrl: `http://127.0.0.1:${port}/raw`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
