/**
 * The review checkout's on-disk guard over Node's `fs` (req-183, `TreeMode`).
 * POSIX: the write bits of files and folders go (`mode & ~0o222`) and come
 * back for the owner (`mode | 0o200`); a folder is closed after its children
 * and opened before them. Windows: `chmod` only toggles a file's read-only
 * attribute, and a folder's attribute guards nothing, so only files change.
 * `lstat` throughout — a link is never followed out of the checkout.
 */
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { TreeMode } from './ports/tree-mode';

const WRITE_BITS = 0o222;
const OWNER_WRITE = 0o200;

export class NodeTreeMode implements TreeMode {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  async setReadOnly(root: string, readOnly: boolean): Promise<void> {
    await this.walk(root, readOnly);
  }

  private async walk(target: string, readOnly: boolean): Promise<void> {
    const stat = await fsp.lstat(target);
    if (stat.isSymbolicLink()) {
      return;
    }
    if (!stat.isDirectory()) {
      await fsp.chmod(target, this.modeOf(stat.mode, readOnly));
      return;
    }
    const folders = this.platform !== 'win32';
    if (folders && !readOnly) {
      await fsp.chmod(target, this.modeOf(stat.mode, false));
    }
    for (const name of await fsp.readdir(target)) {
      await this.walk(path.join(target, name), readOnly);
    }
    if (folders && readOnly) {
      await fsp.chmod(target, this.modeOf(stat.mode, true));
    }
  }

  private modeOf(mode: number, readOnly: boolean): number {
    const bits = mode & 0o7777;
    return readOnly ? bits & ~WRITE_BITS : bits | OWNER_WRITE;
  }
}
