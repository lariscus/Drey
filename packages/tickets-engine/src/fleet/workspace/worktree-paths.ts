import { promises as fsp } from 'node:fs';
import * as path from 'node:path';

/** Resolved, forward-slashed, case-folded on win32 — the one way paths
 *  from git porcelain and paths from `path.join` compare equal. Shared
 *  with the worktree home/clean rules (T-0044). */
export function normalizeForMatch(p: string): string {
  const resolved = path.resolve(p).replaceAll('\\', '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function sameWorktreePath(a: string, b: string): boolean {
  return normalizeForMatch(a) === normalizeForMatch(b);
}

/** realpath, or null when the path does not resolve — the resolver of the
 *  alias second chance, shared with the worktree-clean rules. */
export async function realPathOrNull(p: string): Promise<string | null> {
  try {
    return await fsp.realpath(p);
  } catch {
    return null;
  }
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function lexists(p: string): Promise<boolean> {
  return fsp.lstat(p).then(
    () => true,
    () => false,
  );
}

export async function isDirectory(p: string): Promise<boolean> {
  return fsp.stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

export type DirState = 'missing' | 'empty' | 'content';

export async function directoryState(dir: string): Promise<DirState> {
  const entries = await fsp.readdir(dir).then(
    (list) => list,
    () => null,
  );
  if (entries === null) {
    return 'missing';
  }
  return entries.length === 0 ? 'empty' : 'content';
}
