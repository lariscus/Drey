import type { FileSystem } from '../ports/file-system';

export type WriteOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** What a fresh `service.json` holds: no slots yet — every provider runs on its implied slot. */
export const FRESH_SERVICE_CONFIG = { slots: [] as unknown[] };

/**
 * `service.json` in the service home (`~/.drey-engine/`, ADR-0092 R13): the
 * machine scope of the configuration. req-177 owns its `slots` and `quota`
 * keys, req-170 the pool's `models`, `capacity` and `ledgers`; every write
 * keeps the keys it does not know. The schema of every root key and its
 * owner: `service-config-schema.ts` (req-173 — the machine layer of R13). A file that does not
 * parse is never overwritten — the owner's text stays, the read says why.
 */
export class ServiceConfigFile {
  constructor(
    private readonly fs: FileSystem,
    readonly path: string,
  ) {}

  /** The parsed root, `{}` when the file is missing; the error when it does not parse. */
  async read(): Promise<{ readonly root: Record<string, unknown>; readonly error: string | null }> {
    const text = await this.fs.readTextOrNull(this.path);
    if (text === null) {
      return { root: {}, error: null };
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { root: parsed as Record<string, unknown>, error: null }
        : { root: {}, error: `${this.path} is not a JSON object` };
    } catch (error) {
      return { root: {}, error: `${this.path} does not parse: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** Creates the file when it is absent; an existing one is left as it is. */
  async ensure(): Promise<void> {
    if (!(await this.fs.exists(this.path))) {
      await this.fs.mkdirp(this.fs.dirname(this.path));
      await this.fs.writeAtomic(this.path, `${JSON.stringify(FRESH_SERVICE_CONFIG, null, 2)}\n`);
    }
  }

  /** Replaces the `slots` key, every other key kept; refused while the file does not parse. */
  writeSlots(slots: readonly unknown[]): Promise<WriteOutcome> {
    return this.update((root) => ({ ...root, slots }));
  }

  /** Replaces the pool keys (`models`, `capacity`, `ledgers`, req-170), every other key kept. */
  writePool(keys: Readonly<Record<string, unknown>>): Promise<WriteOutcome> {
    return this.update((root) => ({ ...root, ...keys }));
  }

  /** Rewrites the file from its parsed root; refused while the file does not parse, never a partial write. */
  async update(change: (root: Record<string, unknown>) => Record<string, unknown>): Promise<WriteOutcome> {
    const { root, error } = await this.read();
    if (error !== null) {
      return { ok: false, error };
    }
    await this.fs.mkdirp(this.fs.dirname(this.path));
    await this.fs.writeAtomic(this.path, `${JSON.stringify(change(root), null, 2)}\n`);
    return { ok: true };
  }
}
