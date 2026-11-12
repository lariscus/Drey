import type { BoardSnapshot, PriorityConfig } from '../contracts/tickets';
import type { TicketComment, TicketDetail, TicketStore } from '../ports/ticket-store';
import type { BoardDiff } from './board-diff';
import { assembleBoardFromRecords, type RecordsBoardInput } from './store-board';
import type { AddOptions, AddResult, Claim, ClaimOptions, PutOptions, ReleaseOptions, ReleaseResult } from '../ports/ticket-store';
import type { DricketTicketStore } from './dricket-ticket-store';
import { DricketFileStore, type WriteOutcome } from './dricket-file-store';
import { FileStoreReader } from './file-store-reader';
import { legacyToDricketDocument } from './legacy-bridge';
import { StoreChangeFeed, type StoreChangeFeedStats, type WatchFn } from './store-change-feed';
import { headFingerprint, remoteMovedProbe } from './store-git-probe';
import { StorePathReporter, type StorePathChange } from './store-path-report';
import { StoreConfigCache } from './store-config-cache';
import { readStoreConfigText } from './store-config-text';
import { StoreReader } from './store-reader';
import { checkoutOf, createDricketStore, type StoreSettings } from './store-settings';
import { StoreShadow } from './store-shadow';
import { writePlacement, type StoreStageSet } from './store-stages';
import { ACTIVE_STAGE, PHASE_PIN_KEY, RUNNING_STAGE } from '../core/lifecycle-stages';

/** The seams of the file path (E14-4); specs replace them, the engine leaves them out. */
export interface StoreBoardSourceOptions {
  /** The store's change feed fired: the board is stale. */
  readonly onChange?: () => void;
  /** Which files of the checkout such a change touched (D-28); absent = nobody asks, no git round. */
  readonly onPaths?: (change: StorePathChange) => void;
  /** Debounce of the watcher; default 200 ms. */
  readonly debounceMs?: number;
  readonly watch?: WatchFn;
  /** The `dk` store of the file path (reads of tickets never use it; writes, claims and syncs do). */
  readonly dkFactory?: (settings: StoreSettings) => DricketTicketStore;
  /** Ceiling of a watcher burst before it announces anyway; default 1 s. */
  readonly maxWaitMs?: number;
  /** The checkout's HEAD commit (the echo comparison and the ref check); default `git rev-parse HEAD`. Specs pass a stub or `null` for none. */
  readonly fingerprint?: ((dir: string) => () => Promise<string | null>) | null;
  /** Ref check period; default 10 s, null = off. */
  readonly refCheckEveryMs?: number | null;
  /** Has the remote moved (periodic sync gate); default `git ls-remote`. `null` = always sync. */
  readonly remoteMoved?: ((dir: string) => () => Promise<boolean>) | null;
  /** The store's priority vocabulary; default `git show <config ref>:dricket.toml`. */
  readonly readPriorities?: (checkout: string) => Promise<PriorityConfig | null>;
  /** The store's `[stages]` (req-265); default `git show <config ref>:dricket.toml`. */
  readonly readStages?: (checkout: string) => Promise<StoreStageSet | null>;
}

/**
 * A board write: the column the ticket ends in (the store's stage and pin follow from it, req-265),
 * or `keepStage` for an edit that moves nothing (stage and pin stay as the document has them).
 */
export type LegacyWrite =
  | {
      readonly phase: string;
      /** `true` adds the `archived` label, `false` removes it, absent leaves the labels. */
      readonly archived?: boolean;
    }
  | { readonly keepStage: true };

interface Source {
  readonly key: string;
  /** The legacy read path: one `dk show` per ticket. Used only without a checkout. */
  readonly reader: StoreReader;
  /** The file read + `dk` write path; null without a checkout. */
  readonly files: DricketFileStore | null;
  readonly feed: StoreChangeFeed | null;
  readonly remote: boolean;
  synced: boolean;
}

/**
 * The glue between the board service and the dricket store: builds the store
 * (once per settings) and reads its tickets (E14-2) — from the files of the
 * store's checkout when there is one (E14-4: 18 ms for 91 tickets, no process),
 * else through the caching {@link StoreReader} — runs the `shadow` comparison
 * off the request path, and is the one door for writes (`dk put`, the engine the
 * single writer) and for change detection (own writes, watcher, `dk sync`).
 */
export class StoreBoardSource {
  private current: Source | null = null;
  private readonly feeds = new Set<StoreChangeFeed>();
  private readonly pathReporters = new Set<StorePathReporter>();
  private readonly shadow: StoreShadow;
  private readonly config: StoreConfigCache;
  /** req-257: an `active` ticket of the last board read still carries req-265's column pin. */
  private pinned = false;

  constructor(
    /** Where the shadow report lands (`<userRoot>/shadow`). */
    reportDir: string,
    private readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void,
    /** Minimum gap between two shadow runs (every snapshot would otherwise cost a `dk` pass). */
    shadowIntervalMs = 30_000,
    /** Test seam: a store instead of the real `dk`. */
    private readonly storeFactory: (settings: StoreSettings) => TicketStore = createDricketStore,
    private readonly options: StoreBoardSourceOptions = {},
  ) {
    this.shadow = new StoreShadow(reportDir, log, shadowIntervalMs, (settings) => this.records(settings));
    this.config = new StoreConfigCache({
      ...(options.readPriorities === undefined ? {} : { priorities: options.readPriorities }),
      ...(options.readStages === undefined ? {} : { stages: options.readStages }),
    });
  }

  private sourceFor(settings: StoreSettings): Source {
    const key = JSON.stringify([settings.dkPath, settings.dkStore, settings.dkDataDir, settings.dkCheckout, settings.dkSyncSeconds]);
    if (this.current !== null && this.current.key === key) {
      return this.current;
    }
    this.current?.feed?.stop();
    const checkout = checkoutOf(settings);
    const reader = new StoreReader(this.storeFactory(settings));
    let source: Source;
    if (checkout === null) {
      source = { key, reader, files: null, feed: null, remote: false, synced: false };
    } else {
      const dk = (this.options.dkFactory ?? createDricketStore)(settings);
      const files = new DricketFileStore(new FileStoreReader({ root: checkout }), dk, checkout);
      const remote = settings.dkCheckout !== '' && settings.dkCheckout !== settings.dkStore;
      const onChange = this.options.onChange;
      const paths = onChange === undefined || this.options.onPaths === undefined ? null : new StorePathReporter(checkout, this.options.onPaths, this.log);
      if (paths !== null) {
        this.pathReporters.add(paths);
        void paths.start();
      }
      const feed = onChange === undefined
        ? null
        : new StoreChangeFeed({
          dir: checkout,
          onChange: () => {
            onChange();
            void paths?.report();
          },
          ...(this.options.debounceMs === undefined ? {} : { debounceMs: this.options.debounceMs }),
          ...(this.options.watch === undefined ? {} : { watch: this.options.watch }),
          ...(this.options.maxWaitMs === undefined ? {} : { maxWaitMs: this.options.maxWaitMs }),
          ...(this.options.refCheckEveryMs === undefined ? {} : { refCheckEveryMs: this.options.refCheckEveryMs }),
          ...(this.options.fingerprint === null ? {} : { fingerprint: (this.options.fingerprint ?? headFingerprint)(checkout) }),
          syncEveryMs: remote && settings.dkSyncSeconds > 0 ? settings.dkSyncSeconds * 1000 : null,
          sync: () => files.sync(),
          ...(remote && this.options.remoteMoved !== null ? { remoteMoved: (this.options.remoteMoved ?? remoteMovedProbe)(checkout) } : {}),
          log: this.log,
        });
      feed?.start();
      if (feed !== null) {
        this.feeds.add(feed);
      }
      source = { key, reader, files, feed, remote, synced: false };
    }
    this.current = source;
    return source;
  }

  /** Stops the watcher and the sync round (the service is shutting down, or the settings changed). */
  dispose(): void {
    this.current?.feed?.stop();
    this.current = null;
  }

  /**
   * Resolves when the background work is over: the watcher's HEAD reads, the ref check, a sync round (of any
   * feed, also one replaced by new settings) and a running shadow comparison. Call after {@link dispose} before
   * the folders are let go; the processes it waits for hold their working directory.
   */
  async idle(): Promise<void> {
    await Promise.allSettled([...[...this.feeds].map((feed) => feed.idle()), this.shadow.idle()]);
    await Promise.allSettled([...this.pathReporters].map((paths) => paths.idle()));
  }

  /** The file store of the configured checkout, or null when reads go through `dk`. */
  fileStore(settings: StoreSettings): DricketFileStore | null {
    return this.sourceFor(settings).files;
  }

  /**
   * Replaces a ticket through `dk put --claim --if-version`; a conflict (exit 12)
   * comes back with the ticket as it is now, so the caller can ask. Announces the
   * change at once. Needs a checkout (the write path is the file store's).
   */
  async write(settings: StoreSettings, id: string, text: string, options: PutOptions): Promise<WriteOutcome> {
    const source = this.sourceFor(settings);
    if (source.files === null) {
      throw new Error('no ticket checkout configured (tickets.dk.checkout, or a local tickets.dk.store)');
    }
    const outcome = await source.files.write(id, text, options);
    if (outcome.ok) {
      source.feed?.notifyOwnWrite();
    }
    return outcome;
  }

  /**
   * A human's `dk claim` / `dk release` from the board (E14-5): dk alone decides (exit 11 while
   * another owner's lease runs, takeover only after lease + grace). Announces the change at once.
   */
  async claim(settings: StoreSettings, id: string, options: ClaimOptions): Promise<Claim> {
    const claim = await this.storeFactory(settings).claim(id, options);
    this.sourceFor(settings).feed?.notifyOwnWrite();
    return claim;
  }

  async release(settings: StoreSettings, id: string, options: ReleaseOptions): Promise<ReleaseResult> {
    const result = await this.storeFactory(settings).release(id, options);
    this.sourceFor(settings).feed?.notifyOwnWrite();
    return result;
  }

  /** A ticket's comments from the checkout's `comments/` files, oldest first (E14-6); empty without a checkout. */
  async comments(settings: StoreSettings, id: string): Promise<readonly TicketComment[]> {
    const source = this.sourceFor(settings);
    return source.files === null ? [] : source.files.comments(id);
  }

  /** Appends a comment through `dk comment` (never a file write) and announces the change. */
  async comment(settings: StoreSettings, id: string, text: string, actor: string): Promise<void> {
    const source = this.sourceFor(settings);
    const store = source.files ?? this.storeFactory(settings);
    await store.comment(id, text, { actor });
    source.feed?.notifyOwnWrite();
  }

  /** One ticket as it is stored now (any stage, archived ones too); needs a checkout. */
  async record(settings: StoreSettings, id: string): Promise<TicketDetail> {
    const source = this.sourceFor(settings);
    if (source.files === null) {
      throw new Error('no ticket checkout configured (tickets.dk.checkout, or a local tickets.dk.store)');
    }
    return source.files.show(id);
  }

  /**
   * The board's write: `legacyText` is the patched legacy-shaped ticket (what the
   * board mutations produce), `current` the record it was made on. The dricket
   * document is derived from `current` (`legacy-bridge`) and written with
   * `put --claim --if-version current.rev`; exit 12 comes back as a conflict.
   */
  async writeLegacy(settings: StoreSettings, current: TicketDetail, legacyText: string, target: LegacyWrite): Promise<WriteOutcome> {
    if (current.rev === null) {
      throw new Error(`${current.id} has no rev: the store did not report one`);
    }
    const bridge = 'keepStage' in target
      ? { stage: current.stage }
      : { ...writePlacement(target.phase, await this.stages(settings), current.text), ...(target.archived === undefined ? {} : { archived: target.archived }) };
    return this.write(settings, current.id, legacyToDricketDocument(current.text, legacyText, bridge), { expectedRev: current.rev });
  }

  /** The stage a release from the board hands a ticket in column `phase` to (req-265: a lifecycle stage on a migrated store). */
  async releaseStageOf(settings: StoreSettings, phase: string): Promise<string> {
    return writePlacement(phase, await this.stages(settings), '').stage;
  }

  /** req-257: whether the last board read found an `active` ticket still carrying req-265's column pin (the migration converts it). */
  pinsLeft(): boolean {
    return this.pinned;
  }

  /** The store's `[stages]` (cached a minute); null without a checkout, a config or a table. */
  async stages(settings: StoreSettings): Promise<StoreStageSet | null> {
    const checkout = checkoutOf(settings);
    return checkout === null ? null : this.config.stages(checkout);
  }

  /** The store's `dricket.toml` as it is now (uncached; the stage migration plans from it). */
  async configText(settings: StoreSettings): Promise<{ readonly ref: string; readonly text: string } | null> {
    const checkout = checkoutOf(settings);
    return checkout === null ? null : readStoreConfigText(checkout);
  }

  /** The store's config was just committed: the next read asks git again. */
  invalidateConfig(): void {
    this.config.invalidate();
  }

  /** Creates an unclaimed ticket through `dk add`; dk allocates the number. */
  async add(settings: StoreSettings, options: AddOptions): Promise<AddResult> {
    const source = this.sourceFor(settings);
    if (source.files === null) {
      throw new Error('no ticket checkout configured (tickets.dk.checkout, or a local tickets.dk.store)');
    }
    const created = await source.files.add(options);
    source.feed?.notifyOwnWrite();
    return created;
  }

  /** `dk sync` of a remote store now (refresh, board open, before a claim); a local store shares the ref and needs none. */
  async syncNow(settings: StoreSettings): Promise<void> {
    const source = this.sourceFor(settings);
    if (source.remote && source.feed !== null) {
      await source.feed.syncNow();
    }
  }

  /** What the change feed has seen so far (watcher events, announcements, ref-check misses, syncs); null without a checkout. */
  changeStats(settings: StoreSettings): StoreChangeFeedStats | null {
    return this.sourceFor(settings).feed?.stats() ?? null;
  }

  /** The store's tickets; throws a readable error when `dk` or the store is not usable. */
  async records(settings: StoreSettings): Promise<readonly TicketDetail[]> {
    if (settings.dkStore === '') {
      throw new Error('no dricket store configured (tickets.dk.store)');
    }
    const source = this.sourceFor(settings);
    if (source.files === null) {
      return source.reader.readAll();
    }
    if (source.remote && !source.synced) {
      // Board open on a remote store: bring the checkout up to date once (best effort).
      source.synced = true;
      await source.feed?.syncNow();
    }
    return source.files.readAll();
  }

  /** The board from the store; a store that cannot be read gives an empty board with one error issue. */
  async board(settings: StoreSettings, input: Omit<RecordsBoardInput, 'records'>): Promise<BoardSnapshot> {
    try {
      const records = await this.records(settings);
      this.pinned = records.some((r) => (r.stage === ACTIVE_STAGE || r.stage === RUNNING_STAGE) && (r.extensions[PHASE_PIN_KEY] ?? '') !== '');
      const [priorities, comments] = await Promise.all([this.prioritiesOf(settings), this.commentsByTicket(settings, records)]);
      return assembleBoardFromRecords({ ...input, records, comments, ...(priorities === null ? {} : { priorities }) });
    } catch (error) {
      const message = `dricket store: ${error instanceof Error ? error.message : String(error)}`;
      const empty = assembleBoardFromRecords({ ...input, records: [] });
      return { ...empty, issues: [{ level: 'error', message }, ...empty.issues] };
    }
  }

  /** The store's priority vocabulary (D-11), re-read at most once a minute; null when no ref holds a `dricket.toml`. */
  private async prioritiesOf(settings: StoreSettings): Promise<PriorityConfig | null> {
    const checkout = checkoutOf(settings);
    return checkout === null ? null : this.config.priorities(checkout);
  }

  /** Every ticket's comments for the board's Needs-you rows (D-12); one unreadable ticket has none. */
  private async commentsByTicket(settings: StoreSettings, records: readonly TicketDetail[]): Promise<ReadonlyMap<string, readonly TicketComment[]>> {
    const files = this.sourceFor(settings).files;
    const out = new Map<string, readonly TicketComment[]>();
    if (files === null) {
      return out;
    }
    await Promise.all(
      records.map(async (record) => {
        out.set(record.id, await files.comments(record.id).catch(() => []));
      }),
    );
    return out;
  }

  /** The last comparison, or null before the first shadow run finished. */
  get lastShadowDiff(): BoardDiff | null {
    return this.shadow.lastDiff;
  }

  /** Shadow mode (E14-2): the store's board compared with the one the UI shows, off the request path ({@link StoreShadow}). */
  scheduleShadow(settings: StoreSettings, input: Omit<RecordsBoardInput, 'records'>, shown: BoardSnapshot): void {
    this.shadow.schedule(settings, input, shown);
  }

  /** The awaitable core of {@link scheduleShadow} (specs call it directly). */
  runShadow(settings: StoreSettings, input: Omit<RecordsBoardInput, 'records'>, shown: BoardSnapshot): Promise<BoardDiff | null> {
    return this.shadow.run(settings, input, shown);
  }
}
