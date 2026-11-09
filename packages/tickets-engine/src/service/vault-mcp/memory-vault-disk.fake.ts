import type { VaultDisk, VaultDiskEntry } from './vault-disk';

/**
 * A {@link VaultDisk} in memory for the vault MCP's specs: files under
 * `/`-joined absolute paths, folders implied by them (plus empty ones made
 * on purpose), a modification clock that ticks on every write. `escapes`
 * names vault-relative paths a link would lead out of the vault.
 */
export class MemoryVaultDisk implements VaultDisk {
  readonly files = new Map<string, { text: string; mtime: number }>();
  readonly folders = new Set<string>();
  readonly escapes = new Set<string>();
  private clock = 1000;

  /** Seeds a vault: `{ 'a.md': 'text' }` under `root`. */
  seed(root: string, files: Record<string, string>): this {
    this.folders.add(root);
    Object.entries(files).forEach(([rel, text]) => this.files.set(this.join(root, rel), { text, mtime: this.clock++ }));
    return this;
  }

  /** Someone else saved the file: new text, a later mtime. */
  touch(abs: string, text: string): void {
    this.files.set(abs, { text, mtime: this.clock++ });
  }

  isFolder(abs: string): Promise<boolean> {
    return Promise.resolve(this.folders.has(abs) || [...this.files.keys()].some((f) => f.startsWith(`${abs}/`)));
  }

  staysServed(_root: string, rel: string): Promise<boolean> {
    return Promise.resolve(![...this.escapes].some((e) => rel === e || rel.startsWith(`${e}/`)));
  }

  list(abs: string): Promise<readonly VaultDiskEntry[]> {
    const names = new Map<string, VaultDiskEntry['kind']>();
    for (const file of this.files.keys()) {
      if (file.startsWith(`${abs}/`)) {
        const rest = file.slice(abs.length + 1);
        const cut = rest.indexOf('/');
        names.set(cut === -1 ? rest : rest.slice(0, cut), cut === -1 ? 'file' : 'dir');
      }
    }
    return Promise.resolve([...names].map(([name, kind]) => ({ name, kind })));
  }

  readText(abs: string): Promise<string> {
    const file = this.files.get(abs);
    return file === undefined ? Promise.reject(new Error(`ENOENT: ${abs}`)) : Promise.resolve(file.text);
  }

  mtimeOf(abs: string): Promise<number | null> {
    return Promise.resolve(this.files.get(abs)?.mtime ?? null);
  }

  writeText(abs: string, text: string): Promise<void> {
    this.files.set(abs, { text, mtime: this.clock++ });
    return Promise.resolve();
  }

  rename(fromAbs: string, toAbs: string): Promise<void> {
    if (this.files.has(toAbs)) {
      return Promise.reject(new Error('the target already exists'));
    }
    for (const [file, entry] of [...this.files]) {
      if (file === fromAbs || file.startsWith(`${fromAbs}/`)) {
        this.files.delete(file);
        this.files.set(toAbs + file.slice(fromAbs.length), entry);
      }
    }
    return Promise.resolve();
  }

  copy(fromAbs: string, toAbs: string): Promise<void> {
    const file = this.files.get(fromAbs);
    if (file !== undefined) {
      this.files.set(toAbs, { ...file });
    }
    return Promise.resolve();
  }

  removeDirIfEmpty(): Promise<void> {
    return Promise.resolve();
  }

  join(root: string, rel: string): string {
    return `${root}/${rel}`;
  }
}
