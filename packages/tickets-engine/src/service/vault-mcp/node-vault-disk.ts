/**
 * {@link VaultDisk} over Node's file system (req-167): the Notes API's atomic
 * write and served-path guard, so a worker's write is made exactly like a
 * phone's.
 */
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { atomicWrite } from '../../services/atomic-note-write';
import { staysServed } from '../../services/served-files';
import type { VaultDisk, VaultDiskEntry } from './vault-disk';

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
      throw new Error('the target already exists');
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
