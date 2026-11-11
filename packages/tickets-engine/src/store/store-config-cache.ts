import type { PriorityConfig } from '../contracts/tickets';
import { readStoreConfigText } from './store-config-text';
import { readStorePriorities } from './store-priorities';
import { parseStoreStages, type StoreStageSet } from './store-stages';

/** `dricket.toml` changes by an admin's commit, rarely: a board read does not pay a git process each time. */
const MAX_AGE_MS = 60_000;

interface Cached<T> {
  readonly at: number;
  readonly value: T;
}

export interface StoreConfigReaders {
  /** The store's priority vocabulary (D-11); null when no ref holds a `dricket.toml`. */
  readonly priorities?: (checkout: string) => Promise<PriorityConfig | null>;
  /** The store's `[stages]` (req-265); null without a table or a `dricket.toml`. */
  readonly stages?: (checkout: string) => Promise<StoreStageSet | null>;
}

async function readStoreStages(checkout: string): Promise<StoreStageSet | null> {
  const config = await readStoreConfigText(checkout);
  return config === null ? null : parseStoreStages(config.text);
}

/**
 * What the board reads of a store's `dricket.toml`, re-read at most once a minute per checkout: the
 * priority vocabulary (D-11) and the stage vocabulary (req-265: which stages a write goes to). The
 * stage migration invalidates it after its config commits.
 */
export class StoreConfigCache {
  private readonly prioritiesByCheckout = new Map<string, Cached<PriorityConfig | null>>();
  private readonly stagesByCheckout = new Map<string, Cached<StoreStageSet | null>>();

  constructor(
    private readonly readers: StoreConfigReaders = {},
    private readonly now: () => number = Date.now,
  ) {}

  priorities(checkout: string): Promise<PriorityConfig | null> {
    return this.cached(this.prioritiesByCheckout, checkout, this.readers.priorities ?? readStorePriorities);
  }

  stages(checkout: string): Promise<StoreStageSet | null> {
    return this.cached(this.stagesByCheckout, checkout, this.readers.stages ?? readStoreStages);
  }

  /** The next read asks git again (the config was just committed). */
  invalidate(): void {
    this.prioritiesByCheckout.clear();
    this.stagesByCheckout.clear();
  }

  private async cached<T>(map: Map<string, Cached<T>>, checkout: string, read: (checkout: string) => Promise<T>): Promise<T> {
    const hit = map.get(checkout);
    const at = this.now();
    if (hit !== undefined && at - hit.at < MAX_AGE_MS) {
      return hit.value;
    }
    const value = await read(checkout);
    map.set(checkout, { at, value });
    return value;
  }
}
