import { DkProcess } from '../../store/dk-process';
import { DricketTicketStore } from '../../store/dricket-ticket-store';
import type { RunDkTarget } from '../protocol';
import type { TicketStore } from './ticket-store';

/**
 * The production stores of the runner (E14-5): one `DricketTicketStore`
 * over the installed `dk` per `bin|store|dataDir`, built on first use.
 * Only the composition root (`runner.ts`) knows this class.
 */
export class DkTicketStores {
  private readonly stores = new Map<string, TicketStore>();

  readonly storeFor = (target: RunDkTarget): TicketStore => {
    const key = `${target.bin}|${target.store}|${target.dataDir}`;
    let store = this.stores.get(key);
    if (store === undefined) {
      store = new DricketTicketStore(
        new DkProcess({
          bin: target.bin === '' ? 'dk' : target.bin,
          store: target.store,
          dataDir: target.dataDir === '' ? null : target.dataDir,
        }),
      );
      this.stores.set(key, store);
    }
    return store;
  };
}
