/**
 * {@link VaultDisk} over Node's file system (req-167): the Notes API's atomic
 * write and served-path guard, so a worker's write is made exactly like a
 * phone's.
 */
import { promises as fsp } from 'node:fs';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { atomicWrite } from '../../services/atomic-note-write';
import { staysServed } from '../../services/served-files';
import type { VaultDisk, VaultDiskEntry } from './vault-disk';

/**
 * True when `b` is occupied but only by `a` itself: on a case-insensitive
 * filesystem (Windows' and macOS' defaults) a case-only rename
 * ("Concepts" -> "concepts", D-74) resolves the new name to the very
 * entry being renamed. dev+ino say "same file"; a genuinely different
 * entry stays a conflict.
 */
function sameEntryAs(a: string, b: string): Promise<boolean> {
  return fsp.stat(a).then(
    (source) =>
      fsp.stat(b).then((target) => source.dev === target.dev && source.ino === target.ino, () => false),
    () => false,
  );
}

/**
 * The two-step rename a case-only change needs (D-74): out of the old
 * name into a staging name, then into the new casing. A single rename
 * cannot express it on a case-insensitive filesystem -- the target name
 * "exists" (it is the source) -- and a failure in between rolls the entry
 * back under its old name rather than losing it.
 */
async function renameCaseOnly(from: string, to: string): Promise<void> {
  const staging = `${from}.case-rename-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await fsp.rename(from, staging);
    await fsp.rename(staging, to);
  } catch (error) {
    await fsp.rename(staging, from).catch(() => undefined);
    throw error;
  }
}

export class NodeVaultDisk implements VaultDisk {
  isFolder(abs: string): Promise<boolean> {
    return fsp.stat(abs).then((s) => s.isDirectory(), () => false);
  }

  staysServed(root: string, rel: string): Promise<boolean> {
    return staysServed(root, rel).catch(() => false);
  }

  async list(abs: string): Promise<readonly VaultDiskEntry[]> {
    const entries = await fsp.readdir(abs, { withFileTypes: true }).catch(() => []);
    return entries.map((e) => ({ name: e.name, kind: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other' }));
  }

  readText(abs: string): Promise<string> {
    return fsp.readFile(abs, 'utf8');
  }

  mtimeOf(abs: string): Promise<number | null> {
    return fsp.stat(abs).then((s) => Math.round(s.mtimeMs), () => null);
  }

  async writeText(abs: string, text: string): Promise<void> {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await atomicWrite(abs, text);
  }

  async rename(fromAbs: string, toAbs: string): Promise<void> {
    if ((await this.mtimeOf(toAbs)) !== null) {
      // A case-only rename on a case-insensitive filesystem (D-74) finds
      // the source itself at the target; dev+ino tell it apart from a
      // genuinely different entry, which stays refused.
      if (!(await sameEntryAs(fromAbs, toAbs))) {
        throw new Error('the target already exists');
      }
      await renameCaseOnly(fromAbs, toAbs);
      return;
    }
    await fsp.mkdir(path.dirname(toAbs), { recursive: true });
    await fsp.rename(fromAbs, toAbs);
  }

  async copy(fromAbs: string, toAbs: string): Promise<void> {
    await fsp.mkdir(path.dirname(toAbs), { recursive: true });
    await fsp.cp(fromAbs, toAbs, { recursive: true, errorOnExist: true, force: false });
  }

  async removeDirIfEmpty(abs: string): Promise<void> {
    await fsp.rmdir(abs).catch(() => undefined);
  }

  join(root: string, rel: string): string {
    return path.join(root, ...rel.split('/'));
  }
}
