/** The node adapter of {@link LogFileSystem}: the service log's files on the real disk. */
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { LogFileSystem } from './daily-log-files';

export class NodeLogFileSystem implements LogFileSystem {
  append(file: string, text: string): Promise<void> {
    return fsp.appendFile(file, text, 'utf8');
  }

  async size(file: string): Promise<number | null> {
    const stat = await fsp.stat(file).catch(() => null);
    return stat === null ? null : stat.size;
  }

  async keepTail(file: string, bytes: number): Promise<void> {
    const text = await fsp.readFile(file, 'utf8').catch(() => '');
    await fsp.writeFile(file, text.slice(-bytes), 'utf8');
  }

  list(dir: string): Promise<readonly string[]> {
    return fsp.readdir(dir).catch(() => []);
  }

  remove(file: string): Promise<void> {
    return fsp.rm(file, { force: true });
  }

  async mkdir(dir: string): Promise<void> {
    await fsp.mkdir(dir, { recursive: true });
  }

  join(...parts: string[]): string {
    return path.join(...parts);
  }
}
