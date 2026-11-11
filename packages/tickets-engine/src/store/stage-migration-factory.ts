import type { StoreBoardSource } from './store-board-source';
import { readStoreConfigText } from './store-config-text';
import { StoreConfigWriter } from './store-config-writer';
import { checkoutOf, type StoreSettings } from './store-settings';
import { StoreStageMigration, type StageConfigCommitter } from './store-stage-migration';

/** The store's own directory when `dk.store` is a local directory; null for a remote store. */
export function localStoreDir(settings: StoreSettings): string | null {
  return checkoutOf({ ...settings, dkCheckout: '' });
}

/** A committer that refuses: the store has no local directory (its config is edited where it lives). */
const REMOTE_COMMITTER: StageConfigCommitter = {
  refusal: () => Promise.resolve('a remote store: dricket.toml is edited where the store lives'),
  commit: () => Promise.reject(new Error('a remote store: dricket.toml is edited where the store lives')),
};

/**
 * The stage migration of the configured store (req-265), wired over the board's store source: the
 * config is read from and committed to the LOCAL store directory (its `main`), the tickets are read
 * from the checkout and written through `dk put`, like every board write.
 */
export function stageMigrationFor(source: StoreBoardSource, settings: StoreSettings, actor: string, log: (message: string) => void): StoreStageMigration {
  const local = localStoreDir(settings);
  const checkout = checkoutOf(settings);
  const configDir = local ?? checkout;
  return new StoreStageMigration(
    {
      configText: () => (configDir === null ? Promise.resolve(null) : readStoreConfigText(configDir)),
      records: () => source.records(settings),
      show: (id) => source.record(settings, id),
      write: (id, text, options) => source.write(settings, id, text, options),
    },
    local === null ? REMOTE_COMMITTER : new StoreConfigWriter(local),
    actor,
    log,
  );
}
