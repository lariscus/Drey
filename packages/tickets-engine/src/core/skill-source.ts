import { isSkillName, SKILL_FILE } from './skill';

/**
 * The GitHub sources of the skills library (req-289), the pure half: what
 * the owner typed into *Add from GitHub* read into a repository, a folder and
 * a ref; the skill folders a repository's file tree holds under that folder;
 * and which tag counts as newer. Nothing here touches the network or a disk.
 */

const HOST = 'github.com';
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const VERSION = /^(v?)(\d+(?:\.\d+){0,3})$/;
/** A source brings at most this many skills (a repository of hundreds is a mistake, not a library). */
export const MAX_SOURCE_SKILLS = 50;

export interface GithubRepo {
  readonly owner: string;
  readonly name: string;
  /** `github.com/<owner>/<name>` — how the record and the page write it. */
  readonly repo: string;
}

/** `github.com/o/r`, `https://github.com/o/r(.git)(/)`, `git@github.com:o/r.git` or `o/r`; null for anything else. */
export function parseGithubRepo(input: string): GithubRepo | null {
  const text = input
    .trim()
    .replace(/^git@github\.com:/i, '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const parts = text.split('/');
  if (parts.length !== 2) {
    return null;
  }
  const [owner, name] = parts as [string, string];
  return OWNER.test(owner) && REPO.test(name) && name !== '.' && name !== '..' ? { owner, name, repo: `${HOST}/${owner}/${name}` } : null;
}

/** A folder inside the repository, `/`-separated, no leading or trailing slash; '' = the root; null when it would leave it. */
export function normalizeSourcePath(input: string | undefined): string | null {
  const text = (input ?? '').trim().replaceAll(String.fromCharCode(92), '/').replace(/^\/+|\/+$/g, '');
  if (text === '') {
    return '';
  }
  const parts = text.split('/');
  return parts.some((part) => part === '' || part === '.' || part === '..' || part.includes('\0')) ? null : parts.join('/');
}

/** A tag or branch name as git allows it, kept to what a URL carries plainly. */
export function isRefName(ref: string): boolean {
  return REF.test(ref) && !ref.includes('..') && !ref.endsWith('/') && !ref.endsWith('.lock');
}

/** The source's identity: the repository and the folder, one string. */
export function sourceIdOf(repo: string, path: string): string {
  return path === '' ? repo : `${repo}/${path}`;
}

/** One entry of a repository's file tree (GitHub's `git/trees?recursive=1`). */
export interface TreeEntry {
  readonly path: string;
  readonly type: 'blob' | 'tree' | 'commit';
  readonly size?: number;
}

/** A skill folder found in the tree: where it is, what it is called, its files (relative to it) and their sizes. */
export interface FoundSkill {
  /** The folder in the repository ('' when the repository root is the skill). */
  readonly folder: string;
  readonly name: string;
  readonly files: readonly { readonly path: string; readonly size: number }[];
}

export interface TreeSkills {
  readonly skills: readonly FoundSkill[];
  /** Folders with a `SKILL.md` whose name is no skill name, or beyond {@link MAX_SOURCE_SKILLS}. */
  readonly skipped: readonly { readonly folder: string; readonly reason: 'bad_name' | 'too_many' }[];
}

const dirOf = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const inside = (path: string, folder: string): boolean => folder === '' || path === folder || path.startsWith(`${folder}/`);

/**
 * Every skill folder under `path`: a folder with a `SKILL.md`, the topmost
 * one where folders nest (a skill's own `examples/x/SKILL.md` is a file of
 * it). The folder's name is the skill's name; the repository's own name when
 * the root itself is the skill.
 */
export function skillsInTree(entries: readonly TreeEntry[], path: string, repoName: string): TreeSkills {
  const blobs = entries.filter((entry) => entry.type === 'blob' && inside(entry.path, path));
  const folders = blobs
    .filter((entry) => entry.path === SKILL_FILE || entry.path.endsWith(`/${SKILL_FILE}`))
    .map((entry) => dirOf(entry.path))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  const tops: string[] = [];
  for (const folder of folders) {
    if (!tops.some((top) => inside(folder, top))) {
      tops.push(folder);
    }
  }
  const skills: FoundSkill[] = [];
  const skipped: { folder: string; reason: 'bad_name' | 'too_many' }[] = [];
  for (const folder of tops.sort((a, b) => a.localeCompare(b))) {
    const name = folder === '' ? repoName : folder.slice(folder.lastIndexOf('/') + 1);
    if (!isSkillName(name)) {
      skipped.push({ folder, reason: 'bad_name' });
    } else if (skills.length >= MAX_SOURCE_SKILLS) {
      skipped.push({ folder, reason: 'too_many' });
    } else {
      const prefix = folder === '' ? '' : `${folder}/`;
      const files = blobs.filter((entry) => inside(entry.path, folder)).map((entry) => ({ path: entry.path.slice(prefix.length), size: entry.size ?? 0 }));
      skills.push({ folder, name, files });
    }
  }
  return { skills, skipped };
}

function versionOf(ref: string): { readonly prefix: string; readonly parts: readonly number[] } | null {
  const match = VERSION.exec(ref);
  return match === null ? null : { prefix: match[1]!, parts: match[2]!.split('.').map(Number) };
}

/** True when the ref reads as a version tag (`v1.4`, `2.0.1`): its updates are higher tags, not new commits. */
export function isVersionRef(ref: string): boolean {
  return versionOf(ref) !== null;
}

function compareParts(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** The highest tag above `current` written the same way (`v1.5` over `v1.4`, never `1.5` over `v1.4`); null when none is. */
export function newerVersionRef(current: string, tags: readonly string[]): string | null {
  const base = versionOf(current);
  if (base === null) {
    return null;
  }
  let best: { readonly tag: string; readonly parts: readonly number[] } | null = null;
  for (const tag of tags) {
    const version = versionOf(tag);
    if (version !== null && version.prefix === base.prefix && compareParts(version.parts, base.parts) > 0 && (best === null || compareParts(version.parts, best.parts) > 0)) {
      best = { tag, parts: version.parts };
    }
  }
  return best?.tag ?? null;
}
