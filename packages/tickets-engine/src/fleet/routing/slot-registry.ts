import type { Clock } from '../ports/clock';
import type { QuotaWindow, SlotSummary, SlotView } from '../protocol';
import type { QuotaReading, QuotaSource } from './quota-source';
import type { Slot } from './slot';
import { DEFAULT_REFRESH_MS, parseServiceSlots, type SlotConfigParse } from './slot-config';
import type { SlotReservations } from './slot-reservations';
import type { SlotFacts, SlotStateResolver } from './slot-state-resolver';
import { slotSummaryOf } from './slot-summary';

/** A remote quota is read at most this often per slot, whatever asks (a run end, the timer). */
export const MIN_FETCH_GAP_MS = 60_000;

/** Where the slots come from: `service.json`, read again on every load. */
export interface SlotConfigSource {
  load(): Promise<SlotConfigParse>;
}

export interface SlotRegistryDeps {
  readonly config: SlotConfigSource;
  readonly sourceOf: (slot: Slot) => QuotaSource;
  readonly reservations: SlotReservations;
  readonly resolver: SlotStateResolver;
  readonly clock: Clock;
  /** A slot's view changed (state, windows, busy count): the runner's `slot` event. */
  readonly onChange: (view: SlotView) => void;
  readonly log: (message: string) => void;
}

interface Known {
  windows: readonly QuotaWindow[];
  login: string | null;
  lastFetch: string | null;
  lastFetchError: string | null;
  lastFetchMs: number;
}

const remote = (slot: Slot): boolean => slot.quota === 'zai' || slot.quota === 'kimi';

/**
 * The slots and what is known of them (req-177): the config, the windows of
 * the last read, a refused login, the busy count. It reads the quota
 * sources on demand (the timer, a run's end) and tells every change once.
 */
export class SlotRegistry {
  private slots: readonly Slot[] = parseServiceSlots({}).slots;
  private refreshEveryMs = DEFAULT_REFRESH_MS;
  private readonly known = new Map<string, Known>();
  private readonly published = new Map<string, string>();
  private errors = '';

  constructor(private readonly deps: SlotRegistryDeps) {}

  /** Reads the config again; the slots it no longer names are forgotten. */
  async load(): Promise<void> {
    const parsed = await this.deps.config.load();
    this.slots = parsed.slots;
    this.refreshEveryMs = parsed.refreshMs;
    const errors = parsed.errors.join('; ');
    if (errors !== this.errors && errors !== '') {
      this.deps.log(`service.json slots: ${errors}`);
    }
    this.errors = errors;
    this.announce();
  }

  get refreshMs(): number {
    return this.refreshEveryMs;
  }

  list(): readonly Slot[] {
    return this.slots;
  }

  find(id: string): Slot | null {
    return this.slots.find((slot) => slot.id === id) ?? null;
  }

  views(): SlotView[] {
    const now = this.deps.clock.now();
    return this.slots.map((slot) => this.deps.resolver.view(slot, this.factsOf(slot), now));
  }

  view(id: string): SlotView | null {
    return this.views().find((view) => view.id === id) ?? null;
  }

  summary(): SlotSummary[] {
    return this.views().map(slotSummaryOf);
  }

  /** Reads the quota of one slot, or of all; a remote one at most every minute unless forced. */
  async refresh(id?: string, force = false): Promise<void> {
    const due = this.slots.filter((slot) => (id === undefined || slot.id === id) && (force || !remote(slot) || this.gapPassed(slot)));
    await Promise.all(due.map((slot) => this.readOne(slot)));
    this.announce();
  }

  /** The slot's login was refused (a run's `authentication_failed`, a quota 401): no run starts there until it stands again. */
  flagLogin(id: string, detail: string): void {
    const known = this.knownOf(id);
    if (known.login === null) {
      this.deps.log(`slot ${id} needs a login: ${detail}`);
    }
    known.login = detail;
    this.announce();
  }

  /** The owner logged in again (or a read succeeded): the slot takes runs again. */
  clearLogin(id: string): void {
    this.knownOf(id).login = null;
    this.announce();
  }

  /** Something outside changed a view (a reservation, a pushed reading): tell what changed. */
  announce(): void {
    for (const view of this.views()) {
      const json = JSON.stringify(view);
      if (this.published.get(view.id) !== json) {
        this.published.set(view.id, json);
        this.deps.onChange(view);
      }
    }
  }

  private async readOne(slot: Slot): Promise<void> {
    const known = this.knownOf(slot.id);
    const reading: QuotaReading = await this.deps
      .sourceOf(slot)
      .read(slot)
      .catch((error: unknown) => ({ kind: 'unavailable', detail: error instanceof Error ? error.message : String(error) }) as const);
    const now = this.deps.clock.now();
    known.lastFetchMs = now.getTime();
    known.lastFetch = now.toISOString();
    if (reading.kind === 'login') {
      known.lastFetchError = reading.detail;
      this.flagLogin(slot.id, reading.detail);
      return;
    }
    if (reading.kind === 'unavailable') {
      known.lastFetchError = reading.detail;
      return;
    }
    known.windows = reading.windows;
    known.lastFetchError = reading.detail ?? null;
    if (remote(slot) && reading.detail === undefined) {
      known.login = null;
    }
  }

  private gapPassed(slot: Slot): boolean {
    return this.deps.clock.now().getTime() - this.knownOf(slot.id).lastFetchMs >= MIN_FETCH_GAP_MS;
  }

  private knownOf(id: string): Known {
    let known = this.known.get(id);
    if (known === undefined) {
      known = { windows: [], login: null, lastFetch: null, lastFetchError: null, lastFetchMs: -Infinity };
      this.known.set(id, known);
    }
    return known;
  }

  private factsOf(slot: Slot): SlotFacts {
    const known = this.knownOf(slot.id);
    return { windows: known.windows, login: known.login, busy: this.deps.reservations.busy(slot.id), lastFetch: known.lastFetch, lastFetchError: known.lastFetchError };
  }
}
