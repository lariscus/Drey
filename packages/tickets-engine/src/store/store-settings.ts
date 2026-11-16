import type { TicketRecord } from '../ports/ticket-store';
import { DkProcess } from './dk-process';
import { DricketTicketStore } from './dricket-ticket-store';

/**
 * The settings of the ticket store (E14-1) and the factory that turns them into a
 * store. Keys are the tickets plugin's own (`dk.path`, `dk.store`, `dk.dataDir`,
 * `dk.checkout`, `dk.syncSeconds`); a board with no `dk.store` is not configured
 * (E14-9b: dricket is the one backend, there is no `backend` key).
 */
export interface StoreSettings {
  /** `dk` executable; empty = `dk` on PATH. */
  readonly dkPath: string;
  /** The dricket store (directory or `<remote>#<branch>`); empty = not configured. */
  readonly dkStore: string;
  /** Private working copies (`DK_DATA_DIR`); empty = dk's default. */
  readonly dkDataDir: string;
  /**
   * The checkout the board is read from (E14-4): the files of the store's
   * ticket branch. Empty = the store directory itself when `dk.store` is a
   * local directory; a remote store (`<remote>#<branch>`) needs one (it must
   * not live in OneDrive). No checkout = reads fall back to one `dk` call per ticket.
   */
  readonly dkCheckout: string;
  /** Seconds between two `dk sync` rounds of a remote store; 0 = off. Default 30. */
  readonly dkSyncSeconds: number;
}

export const DEFAULT_SYNC_SECONDS = 30;

/** The settings of a board whose store is not configured yet (`dkStore` empty). */
export const UNCONFIGURED_STORE: StoreSettings = { dkPath: '', dkStore: '', dkDataDir: '', dkCheckout: '', dkSyncSeconds: DEFAULT_SYNC_SECONDS };

export const STORE_SETTING_KEYS = ['dk.path', 'dk.store', 'dk.dataDir', 'dk.checkout', 'dk.syncSeconds'] as const;

export async function readStoreSettings(configGet: <T>(key: string) => Promise<T | undefined>): Promise<StoreSettings> {
  const text = async (key: string): Promise<string> => ((await configGet<string>(key)) ?? '').trim();
  return {
    dkPath: await text('dk.path'),
    dkStore: await text('dk.store'),
    dkDataDir: await text('dk.dataDir'),
    dkCheckout: await text('dk.checkout'),
    dkSyncSeconds: syncSecondsOf(await configGet<unknown>('dk.syncSeconds')),
  };
}

function syncSecondsOf(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SYNC_SECONDS;
}

/** A remote store (`<remote>#<branch>`, a URL or an scp-like location): fetched by dk, not created beside a vault. */
export function isRemoteStore(store: string): boolean {
  return store.includes('#') || /^[a-z][a-z0-9+.-]*:\/\//i.test(store) || /^[^\/]+@[^\/]+:/.test(store);
}

/**
 * Where the board's files are: the explicit checkout, else the store itself
 * when it is a local directory (what `dk.store` holds for a local store);
 * null for a remote store without a checkout.
 */
export function checkoutOf(settings: StoreSettings): string | null {
  if (settings.dkCheckout !== '') {
    return settings.dkCheckout;
  }
  const store = settings.dkStore;
  return store !== '' && !isRemoteStore(store) ? store : null;
}

export function createDricketStore(settings: StoreSettings, env?: NodeJS.ProcessEnv): DricketTicketStore {
  return new DricketTicketStore(
    new DkProcess({
      bin: settings.dkPath === '' ? 'dk' : settings.dkPath,
      store: settings.dkStore,
      dataDir: settings.dkDataDir === '' ? null : settings.dkDataDir,
      // dk v0.6.0: parallel reads of one store collide on its private working copy
      // (git exit 128, dricket requirement R-26) - reads go one at a time until that is fixed.
      readConcurrency: 1,
      ...(env === undefined ? {} : { env }),
    }),
  );
}

// ---------------------------------------------------------------------------
// The read-only board listing

export interface StoreColumn {
  readonly stage: string;
  readonly tickets: readonly TicketRecord[];
}

export type StoreListing =
  | { readonly ok: true; readonly version: string | null; readonly columns: readonly StoreColumn[] }
  | { readonly ok: false; readonly error: string };

/** Known stages first in the order a ticket travels, the rest alphabetically. Display only — no stage logic. */
const STAGE_ORDER = ['open', 'inbox', 'shaping', 'prioritized', 'active', 'running', 'in-progress', 'building', 'build', 'review', 'ready', 'commit', 'blocked', 'done', 'cancelled'];

export function groupByStage(records: readonly TicketRecord[]): StoreColumn[] {
  const byStage = new Map<string, TicketRecord[]>();
  for (const record of records) {
    const list = byStage.get(record.stage) ?? [];
    list.push(record);
    byStage.set(record.stage, list);
  }
  const rank = (stage: string): number => {
    const i = STAGE_ORDER.indexOf(stage);
    return i < 0 ? STAGE_ORDER.length : i;
  };
  return [...byStage.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([stage, tickets]) => ({ stage, tickets: [...tickets].sort((x, y) => x.id.localeCompare(y.id)) }));
}
