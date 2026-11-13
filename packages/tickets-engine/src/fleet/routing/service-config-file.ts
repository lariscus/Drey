import type { FileSystem } from '../ports/file-system';
import { slotAdded, slotRemoved, withoutRetiredSlotKeys, type SlotEdit } from './slot-edit';

export type WriteOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };
/** A one-slot edit's outcome: `invalid` when the edit does not stand, else what the file said. */
export type SlotEditOutcome = WriteOutcome | { readonly ok: false; readonly error: string; readonly invalid: true };

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

  /** Replaces the `slots` key, every other key kept; refused while the file does not parse. The retired `profile` key (req-290) is dropped. */
  writeSlots(slots: readonly unknown[]): Promise<WriteOutcome> {
    return this.update((root) => ({ ...root, slots: slots.map(withoutRetiredSlotKeys) }));
  }

  /** D-69: appends one slot entry, every other entry kept as written. */
  addSlot(entry: unknown): Promise<SlotEditOutcome> {
    return this.edit((root) => slotAdded(root, entry));
  }

  /** D-69: removes one slot (an implied one through `impliedOff`); refused while a model row names it. */
  removeSlot(id: string): Promise<SlotEditOutcome> {
    return this.edit((root) => slotRemoved(root, id));
  }

  /** Replaces the pool keys (`models`, `capacity`, `ledgers`, req-170), every other key kept. */
  writePool(keys: Readonly<Record<string, unknown>>): Promise<WriteOutcome> {
    return this.update((root) => ({ ...root, ...keys }));
  }

  private async edit(change: (root: Record<string, unknown>) => SlotEdit): Promise<SlotEditOutcome> {
    const { root, error } = await this.read();
    if (error !== null) {
      return { ok: false, error };
    }
    const edited = change(root);
    return edited.ok ? this.update(() => edited.root) : { ok: false, error: edited.error, invalid: true };
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
