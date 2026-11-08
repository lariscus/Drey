import type { FileSystem } from './file-system';

/** An in-memory `FileSystem` for the core's unit specs: `/`-joined paths, folders implied by their files. */
export class MemoryFileSystem implements FileSystem {
  readonly files = new Map<string, string | Uint8Array>();
  readonly atomicWrites: string[] = [];

  async readText(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    }
    return typeof value === 'string' ? value : new TextDecoder().decode(value);
  }

  readTextOrNull(path: string): Promise<string | null> {
    return this.readText(path).catch(() => null);
  }

  async writeText(path: string, text: string): Promise<void> {
    this.files.set(path, text);
  }

  async writeAtomic(path: string, text: string): Promise<void> {
    this.atomicWrites.push(path);
    this.files.set(path, text);
  }

  async appendText(path: string, text: string): Promise<void> {
    this.files.set(path, `${(await this.readTextOrNull(path)) ?? ''}${text}`);
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
  }

  async mkdirp(): Promise<void> {}

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || [...this.files.keys()].some((key) => key.startsWith(`${path}/`));
  }

  async list(dir: string): Promise<string[]> {
    const names = [...this.files.keys()].filter((key) => key.startsWith(`${dir}/`)).map((key) => key.slice(dir.length + 1).split('/')[0]!);
    return [...new Set(names)];
  }

  join(...parts: string[]): string {
    return parts.join('/').replace(/\/+/g, '/');
  }

  dirname(path: string): string {
    return path.slice(0, Math.max(0, path.lastIndexOf('/')));
  }

  resolve(base: string, relative: string): string {
    return relative.startsWith('/') ? relative : this.join(base, relative);
  }
}
