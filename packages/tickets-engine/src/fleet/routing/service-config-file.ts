import type { FileSystem } from '../ports/file-system';
import { slotAdded, slotRemoved, slotUpdated, withoutRetiredSlotKeys, type SlotEdit } from './slot-edit';
import { OPENCODE_ACCOUNTS_KEY } from './slot-config';

export type WriteOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };
/** A one-slot edit's outcome: `invalid` when the edit does not stand, else what the file said. */
export type SlotEditOutcome = WriteOutcome | { readonly ok: false; readonly error: string; readonly invalid: true };

/** What a fresh `service.json` holds: no slots yet — every provider runs on its implied slot. */
export const FRESH_SERVICE_CONFIG = { slots: [] as unknown[] };

/** req-317: the accounts opencode is signed in to, by name — the consumer's view of its `auth.json` (the names only, never a value). */
export interface OpencodeAccounts {
  names(): Promise<readonly string[]>;
}

type Root = Record<string, unknown>;

/** The root without the synthetic accounts key: it is read-only and never reaches the file. */
function withoutAccounts(root: Root): Root {
  const { [OPENCODE_ACCOUNTS_KEY]: _synthetic, ...rest } = root;
  return rest;
}

/**
 * `service.json` in the service home (`~/.drey-engine/`, ADR-0092 R13): the
 * machine scope of the configuration. req-177 owns its `slots` and `quota`
 * keys, req-170 the pool's `models`, `capacity` and `ledgers`; every write
 * keeps the keys it does not know. A file that does not
 * parse is never overwritten — the owner's text stays, the read says why.
 * req-317: with the accounts port a read carries the synthetic root key
 * `opencodeAccounts` (the implied account slots come from it); every write
 * drops it again.
 */
export class ServiceConfigFile {
  constructor(
    private readonly fs: FileSystem,
    readonly path: string,
    private readonly accounts?: OpencodeAccounts,
  ) {}

  /** The parsed root (with the synthetic accounts key), `{}` when the file is missing; the error when it does not parse. */
  async read(): Promise<{ readonly root: Root; readonly error: string | null }> {
    const text = await this.fs.readTextOrNull(this.path);
    if (text === null) {
      return { root: await this.withAccounts({}), error: null };
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { root: await this.withAccounts(parsed as Root), error: null }
        : { root: {}, error: `${this.path} is not a JSON object` };
    } catch (error) {
      return { root: {}, error: `${this.path} does not parse: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async withAccounts(root: Root): Promise<Root> {
    const bare = withoutAccounts(root);
    return this.accounts === undefined ? bare : { ...bare, [OPENCODE_ACCOUNTS_KEY]: [...(await this.accounts.names().catch(() => []))] };
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

  /** D-69: removes one slot (an implied one through `impliedOff`); refused while a model row names it, unless `withModels` (req-287) takes those rows along. */
  removeSlot(id: string, withModels = false): Promise<SlotEditOutcome> {
    return this.edit((root) => slotRemoved(root, id, withModels));
  }

  /** req-287: changes one slot's label, cost or sessions in place, every other key kept. */
  updateSlot(id: string, patch: Readonly<Record<string, unknown>>): Promise<SlotEditOutcome> {
    return this.edit((root) => slotUpdated(root, id, patch));
  }

  /** Replaces the pool keys (`models`, `capacity`, `ledgers`, req-170), every other key kept. */
  writePool(keys: Readonly<Record<string, unknown>>): Promise<WriteOutcome> {
    return this.update((root) => ({ ...root, ...keys }));
  }

  private async edit(change: (root: Root) => SlotEdit): Promise<SlotEditOutcome> {
    const { root, error } = await this.read();
    if (error !== null) {
      return { ok: false, error };
    }
    const edited = change(root);
    return edited.ok ? this.update(() => edited.root) : { ok: false, error: edited.error, invalid: true };
  }

  /** Rewrites the file from its parsed root; refused while the file does not parse, never a partial write. The synthetic accounts key is never written. */
  async update(change: (root: Root) => Root): Promise<WriteOutcome> {
    const { root, error } = await this.read();
    if (error !== null) {
      return { ok: false, error };
    }
    await this.fs.mkdirp(this.fs.dirname(this.path));
    await this.fs.writeAtomic(this.path, `${JSON.stringify(withoutAccounts(change(root)), null, 2)}\n`);
    return { ok: true };
  }
}
