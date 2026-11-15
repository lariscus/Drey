/**
 * `tickets/_meta/repos.md` (ADR-0075, `specs/ticket-schema.md`): the work
 * repositories a ticket's `repos:` field may name — read into `RepoRef`s
 * and written back from them with the owner's prose kept. Split out of
 * `ticket-board.ts` with req-177. Req-290 retired the `profile:` key
 * req-177 had added: an old file's `profile` is read and silently
 * ignored, and no write emits it again.
 */
import { parseDocument, stringify } from 'yaml';
import { splitFrontmatter } from '../../../../../shared/frontmatter';
import type { RepoRef } from '../../contracts/repo-ref';

export interface ReposParse {
  readonly repos: readonly RepoRef[];
  readonly error: string | null;
  /** Tolerated entries (a non-string `launch:`), one message each. */
  readonly warnings: readonly string[];
}

type Entry = Record<string, unknown>;

const optionalText = (value: unknown, trim = true): string | null => {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  return trim ? value.trim() : value;
};

/** The frontmatter's `repos` mapping, or the error the whole file fails on. */
function reposMapping(text: string): Entry | string {
  const { yamlText, hadFence } = splitFrontmatter(text);
  if (!hadFence || yamlText === null) {
    return 'repos.md has no frontmatter fence';
  }
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    return `repos.md does not parse: ${doc.errors[0]!.message}`;
  }
  const parsed = doc.toJS() as unknown;
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Entry) : {};
  const rawRepos = root['repos'];
  if (rawRepos === undefined || rawRepos === null) {
    return 'repos.md needs a repos mapping';
  }
  if (typeof rawRepos !== 'object' || Array.isArray(rawRepos)) {
    return 'repos.md: repos must be a mapping of name -> {url, branch, policy}';
  }
  return rawRepos as Entry;
}

/** `launch:` — a command string; anything else is tolerated with a warning. */
function launchOf(name: string, raw: unknown, warnings: string[]): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim();
  }
  warnings.push(`repos.md: repo "${name}" launch must be a command string`);
  return null;
}

/** `instructions:` — a file inside the repo; anything else is tolerated with a warning. */
function instructionsOf(name: string, raw: unknown, warnings: string[]): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const rel = typeof raw === 'string' ? repoRelativePath(raw) : null;
  if (rel !== null && rel !== '') {
    return rel;
  }
  warnings.push(`repos.md: repo "${name}" instructions must be a file path inside the repo`);
  return null;
}

/** One entry as a `RepoRef`, or the error the whole file fails on. */
function repoOf(name: string, raw: unknown, warnings: string[]): RepoRef | string {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return `repos.md: repo "${name}" must be a mapping`;
  }
  const map = raw as Entry;
  const url = typeof map['url'] === 'string' ? map['url'].trim() : '';
  if (url === '') {
    return `repos.md: repo "${name}" needs a url`;
  }
  const launch = launchOf(name, map['launch'], warnings);
  const instructions = instructionsOf(name, map['instructions'], warnings);
  const links = parseRepoLinks(map['link']);
  if (typeof links === 'string') {
    return `repos.md: repo "${name}" ${links}`;
  }
  return {
    name,
    url,
    branch: optionalText(map['branch'], false),
    policy: optionalText(map['policy'], false),
    path: optionalText(map['path']),
    worker: optionalText(map['worker']),
    worktrees: optionalText(map['worktrees']),
    launch,
    instructions,
    ...(links.length > 0 ? { link: links } : {}),
  };
}

export function parseRepos(text: string | null): ReposParse {
  if (text === null) {
    return { repos: [], error: null, warnings: [] };
  }
  const mapping = reposMapping(text);
  if (typeof mapping === 'string') {
    return { repos: [], error: mapping, warnings: [] };
  }
  const repos: RepoRef[] = [];
  const warnings: string[] = [];
  for (const [name, entry] of Object.entries(mapping)) {
    const repo = repoOf(name, entry, warnings);
    if (typeof repo === 'string') {
      return { repos: [], error: repo, warnings };
    }
    repos.push(repo);
  }
  return { repos, error: null, warnings };
}

/**
 * The prose under `repos.md`'s frontmatter — the notes the owner keeps
 * there. A file without a fence reads as the shipped default prose.
 */
export function reposProse(text: string | null): string {
  if (text === null) {
    return DEFAULT_REPOS_PROSE;
  }
  const { body, hadFence } = splitFrontmatter(text);
  return hadFence && body.trim() !== '' ? body : DEFAULT_REPOS_PROSE;
}

export const DEFAULT_REPOS_PROSE = `Work repositories a ticket's \`repos:\` field may name. The fleet never
calls a host API — only plain git (ADR-0075); protection on \`main\` is
the host's branch-policy feature, recorded here when configured.
\`path\` is the local checkout the board's "Open work folder in
terminal" opens.`;

/** One repo's frontmatter entry: the optional keys only when set, so the file stays hand-readable. */
function entryOf(repo: RepoRef): Entry {
  const optional: readonly (readonly [string, string | null])[] = [
    ['branch', repo.branch],
    ['policy', repo.policy],
    ['path', repo.path === null ? null : repo.path.replaceAll('\\', '/')],
    ['worker', repo.worker],
    ['worktrees', repo.worktrees],
    ['launch', repo.launch],
    ['instructions', repo.instructions],
  ];
  const entry: Entry = { url: repo.url };
  for (const [key, value] of optional) {
    if (value !== null) {
      entry[key] = value;
    }
  }
  if (repo.link !== undefined && repo.link.length > 0) {
    entry['link'] = [...repo.link];
  }
  return entry;
}

/**
 * Writes `repos.md` from its entries (req-72, the settings page's save):
 * the frontmatter regenerated from the list, the owner's prose kept.
 */
export function reposFileText(repos: readonly RepoRef[], prose: string): string {
  const mapping: Record<string, Entry> = {};
  for (const repo of repos) {
    mapping[repo.name] = entryOf(repo);
  }
  const front = stringify({ repos: mapping }, { lineWidth: 0 }).trimEnd();
  return `---\n${front}\n---\n${prose.trimEnd()}\n`;
}

/**
 * `link:` (req-56) — the checkout's git-ignored folders a fleet worktree
 * borrows instead of rebuilding (`.tools`, `node_modules`): one name or a
 * list, each relative to the repo root, never leaving it. A string is
 * the reason it is refused.
 */
function parseRepoLinks(raw: unknown): readonly string[] | string {
  if (raw === undefined || raw === null) {
    return [];
  }
  const items = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : null;
  if (items === null || items.some((item) => typeof item !== 'string')) {
    return 'link: must be a folder name or a list of them';
  }
  const links: string[] = [];
  for (const item of items as string[]) {
    const rel = repoRelativePath(item);
    if (rel === null) {
      return `link: "${item}" must be a path inside the repo (no absolute path, no ..)`;
    }
    if (rel !== '') {
      links.push(rel);
    }
  }
  return links;
}

/**
 * A repo-relative path from `repos.md`, forward slashes, no trailing
 * slash; '' for a blank value, null when it is absolute or leaves the
 * repo (`..`, `.`).
 */
function repoRelativePath(raw: string): string | null {
  const rel = raw.trim().replaceAll('\\', '/').replace(/\/+$/, '');
  if (rel === '') {
    return '';
  }
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split('/').some((part) => part === '..' || part === '.')) {
    return null;
  }
  return rel;
}
