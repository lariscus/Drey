import { promises as fsp } from 'node:fs';
import * as path from 'node:path';

/**
 * The disk as the skill services see it (req-172): paths relative to the
 * tickets vault, `/`-separated. The host's `read` / `write` cannot list a
 * folder, copy a script file or remove a folder, so skills get their own
 * small port; specs fake it with a map.
 */

export interface SkillDirEntry {
  readonly name: string;
  readonly dir: boolean;
}

export interface SkillFileSystem {
  /** The file's text; null when absent or unreadable. */
  readText(rel: string): Promise<string | null>;
  /** The folder's entries, folders first; empty when it does not exist. */
  list(rel: string): Promise<readonly SkillDirEntry[]>;
  /** Every file under a folder, however deep, as paths relative to it. */
  files(rel: string): Promise<readonly string[]>;
  /** Creates the folders on the way. */
  writeFile(rel: string, data: Uint8Array | string): Promise<void>;
  /** A file or a folder with everything in it; absent is fine. */
  remove(rel: string): Promise<void>;
}

/** The port over a vault folder on disk; a path that would leave the folder throws. */
export class NodeSkillFileSystem implements SkillFileSystem {
  constructor(private readonly root: string) {}

  private abs(rel: string): string {
    const full = path.resolve(this.root, ...rel.split('/'));
    const inside = path.relative(this.root, full);
    if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
      throw new Error(`the path ${rel} leaves the vault`);
    }
    return full;
  }

  readText(rel: string): Promise<string | null> {
    return fsp.readFile(this.abs(rel), 'utf8').then(
      (text) => text,
      () => null,
    );
  }

  async list(rel: string): Promise<readonly SkillDirEntry[]> {
    const entries = await fsp.readdir(this.abs(rel), { withFileTypes: true }).catch(() => []);
    return entries
      .map((entry) => ({ name: entry.name, dir: entry.isDirectory() }))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  }

  async files(rel: string): Promise<readonly string[]> {
    const found: string[] = [];
    for (const entry of await this.list(rel)) {
      if (entry.dir) {
        found.push(...(await this.files(`${rel}/${entry.name}`)).map((file) => `${entry.name}/${file}`));
      } else {
        found.push(entry.name);
      }
    }
    return found;
  }

  async writeFile(rel: string, data: Uint8Array | string): Promise<void> {
    const target = this.abs(rel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
  }

  remove(rel: string): Promise<void> {
    return fsp.rm(this.abs(rel), { recursive: true, force: true });
  }
}
