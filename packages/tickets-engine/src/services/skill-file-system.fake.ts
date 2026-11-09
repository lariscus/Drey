import type { SkillDirEntry, SkillFileSystem } from './skill-file-system';

/** A fake port over a map of path to text, for specs. */
export class MemorySkillFileSystem implements SkillFileSystem {
  readonly store = new Map<string, string | Uint8Array>();

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [rel, text] of Object.entries(initial)) {
      this.store.set(rel, text);
    }
  }

  async readText(rel: string): Promise<string | null> {
    const data = this.store.get(rel);
    return data === undefined ? null : typeof data === 'string' ? data : new TextDecoder().decode(data);
  }

  async list(rel: string): Promise<readonly SkillDirEntry[]> {
    const seen = new Map<string, boolean>();
    for (const file of this.store.keys()) {
      if (file.startsWith(`${rel}/`)) {
        const rest = file.slice(rel.length + 1);
        const slash = rest.indexOf('/');
        seen.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0);
      }
    }
    return [...seen].map(([name, dir]) => ({ name, dir })).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  }

  async files(rel: string): Promise<readonly string[]> {
    return [...this.store.keys()].filter((file) => file.startsWith(`${rel}/`)).map((file) => file.slice(rel.length + 1)).sort();
  }

  async writeFile(rel: string, data: Uint8Array | string): Promise<void> {
    this.store.set(rel, data);
  }

  async remove(rel: string): Promise<void> {
    for (const file of [...this.store.keys()]) {
      if (file === rel || file.startsWith(`${rel}/`)) {
        this.store.delete(file);
      }
    }
  }
}
