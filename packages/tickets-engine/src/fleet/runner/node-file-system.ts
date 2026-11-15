import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { FileSystem } from '../ports/file-system';

/** The runner's `FileSystem` port over `node:fs` (ADR-0096: Node lives at the edge). */
export class NodeFileSystem implements FileSystem {
  readText(file: string): Promise<string> {
    return fsp.readFile(file, 'utf8');
  }

  readTextOrNull(file: string): Promise<string | null> {
    return fsp.readFile(file, 'utf8').catch(() => null);
  }

  async writeText(file: string, text: string, options: { readonly mode?: number } = {}): Promise<void> {
    await fsp.writeFile(file, text, options.mode === undefined ? 'utf8' : { encoding: 'utf8', mode: options.mode });
  }

  async writeAtomic(file: string, text: string): Promise<void> {
    const temp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(temp, text, 'utf8');
    await fsp.rename(temp, file);
  }

  async appendText(file: string, text: string): Promise<void> {
    await fsp.appendFile(file, text, 'utf8');
  }

  async writeBytes(file: string, bytes: Uint8Array): Promise<void> {
    await fsp.writeFile(file, bytes);
  }

  async mkdirp(dir: string): Promise<void> {
    await fsp.mkdir(dir, { recursive: true });
  }

  async remove(file: string): Promise<void> {
    await fsp.rm(file, { force: true }).catch(() => undefined);
  }

  exists(file: string): Promise<boolean> {
    return fsp.stat(file).then(
      () => true,
      () => false,
    );
  }

  list(dir: string): Promise<string[]> {
    return fsp.readdir(dir).catch(() => [] as string[]);
  }

  join(...parts: string[]): string {
    return path.join(...parts);
  }

  dirname(file: string): string {
    return path.dirname(file);
  }

  resolve(base: string, relative: string): string {
    return path.resolve(base, relative);
  }
}
