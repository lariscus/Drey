import { WORKER_PROVIDERS, type WorkerProviderId } from '../protocol';
import { impliedSlot, parseServiceSlots } from './slot-config';
import type { WriteOutcome } from './service-config-file';

/** The marker `service.json` keeps once the old pool sizes moved in. */
export const POOL_SIZE_MIGRATION = 'fleet.pool.size';

/** What the migration needs of `service.json`. */
export interface MigrationConfigFile {
  read(): Promise<{ readonly root: Record<string, unknown>; readonly error: string | null }>;
  update(change: (root: Record<string, unknown>) => Record<string, unknown>): Promise<WriteOutcome>;
}

type Entry = Record<string, unknown>;

/** A slot entry as `service.json` stores the implied slot of a provider. */
function impliedEntry(provider: WorkerProviderId, sessions: number): Entry {
  const slot = impliedSlot(provider);
  return { id: slot.id, label: slot.label, provider, profile: 'private', quota: slot.quota, sessions };
}

/** The `slots` with every provider's sessions set: a slot that names none takes its provider's old pool size. */
export function slotsWithSessions(root: Entry, sizes: Readonly<Partial<Record<WorkerProviderId, number>>>): unknown[] {
  const raw = Array.isArray(root['slots']) ? (root['slots'] as unknown[]) : [];
  const configured = parseServiceSlots({ slots: raw }).slots.filter((slot) => !slot.implied);
  const slots = raw.map((entry): unknown => {
    const e = (entry ?? {}) as Entry;
    const size = WORKER_PROVIDERS.includes(e['provider'] as WorkerProviderId) ? sizes[e['provider'] as WorkerProviderId] : undefined;
    return e['sessions'] === undefined && size !== undefined ? { ...e, sessions: size } : entry;
  });
  const missing = WORKER_PROVIDERS.filter((provider) => !configured.some((slot) => slot.provider === provider) && sizes[provider] !== undefined);
  return [...slots, ...missing.map((provider) => impliedEntry(provider, sizes[provider]!))];
}

/**
 * The one-time move of req-63's `fleet.pool.<provider>.size` (req-170): the
 * old size becomes the `sessions` of that provider's slots in `service.json`
 * — a provider no slot names gets its implied slot written out with it — and
 * a marker says it happened, so a later size in the plugin config changes
 * nothing. A file that does not parse is left alone (and asked again).
 */
export class PoolMigration {
  constructor(
    private readonly file: MigrationConfigFile,
    private readonly log: (message: string) => void,
  ) {}

  /** True when it wrote the file (the caller reloads the slots). */
  async run(sizes: Readonly<Partial<Record<WorkerProviderId, number>>>): Promise<boolean> {
    const { root, error } = await this.file.read();
    const done = Array.isArray(root['migrations']) && (root['migrations'] as unknown[]).includes(POOL_SIZE_MIGRATION);
    if (error !== null || done) {
      return false;
    }
    const written = await this.file.update((current) => ({
      ...current,
      slots: slotsWithSessions(current, sizes),
      migrations: [...(Array.isArray(current['migrations']) ? (current['migrations'] as unknown[]) : []), POOL_SIZE_MIGRATION],
    }));
    if (written.ok) {
      const moved = WORKER_PROVIDERS.filter((p) => sizes[p] !== undefined).map((p) => `${p} ${sizes[p]}`);
      this.log(`service.json: the pool sizes moved into the slots' sessions (${moved.join(', ')}) — Settings → Models owns them now`);
    }
    return written.ok;
  }
}
