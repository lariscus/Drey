import type { CapabilityImportReport, LedgerFigure, ModelRow, ModelsReply, PoolLoad, PoolSettings, QueueEntry } from '../protocol';
import type { RouteContext, RouteGroup } from './route-context';

/** What the routes need of the pool. */
export interface PoolDesk {
  settings(): PoolSettings;
  /** Entries `service.json` holds that the parse left out. */
  errors(): readonly string[];
  load(): PoolLoad;
  queue(): readonly QueueEntry[];
  providerDay(): readonly LedgerFigure[];
  /** The reasons the parse would leave entries of these pool keys out; empty = writable. */
  check(keys: Readonly<Record<string, unknown>>): readonly string[];
  /** The pool keys as `service.json` stores them. */
  stored(settings: PoolSettings): Record<string, unknown>;
  /** Reads `service.json` again (the slots and the pool). */
  reload(): Promise<void>;
  /** req-178: the model table with the columns models.dev declares filled in (only those a row leaves out); one network call. */
  importCapabilities(): Promise<({ readonly ok: true; readonly rows: readonly ModelRow[] } & CapabilityImportReport) | { readonly ok: false; readonly error: string }>;
}

/** What the routes need of `service.json`. */
export interface PoolConfigStore {
  readonly path: string;
  writePool(keys: Readonly<Record<string, unknown>>): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
}

const POOL_KEYS = ['models', 'capacity', 'ledgers', 'routing'] as const;

/**
 * The capacity pool's settings (req-170, board 7l): `GET /models` reads the
 * model table, the cap, the ledger defaults, the routing (req-178), the live
 * load, the queue and today's spend per slot; `POST /models/config` replaces
 * the keys it sends (`models`, `capacity`, `ledgers`, `routing` — the ones it
 * leaves out stay), checked row by row before anything is written, then
 * reloads. `POST /models/import` (req-178) fills the capability columns from
 * models.dev — the one network call here, only when the owner asks.
 */
export class ModelRoutes implements RouteGroup {
  constructor(
    private readonly desk: PoolDesk,
    private readonly config: PoolConfigStore,
  ) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    switch (`${ctx.method} ${ctx.pathname}`) {
      case 'GET /models':
        ctx.respond(200, this.reply());
        return true;
      case 'POST /models/config':
        return this.configure(ctx);
      case 'POST /models/import':
        return this.importCapabilities(ctx);
      default:
        return false;
    }
  }

  private reply(): ModelsReply {
    return { ok: true, ...this.desk.settings(), now: this.desk.load(), queue: this.desk.queue(), providerDay: this.desk.providerDay(), errors: this.desk.errors(), configPath: this.config.path };
  }

  private async importCapabilities(ctx: RouteContext): Promise<boolean> {
    const outcome = await this.desk.importCapabilities();
    if (!outcome.ok) {
      ctx.respond(502, outcome);
      return true;
    }
    const written = outcome.filled.length === 0 ? ({ ok: true } as const) : await this.config.writePool(this.desk.stored({ ...this.desk.settings(), models: outcome.rows }));
    if (!written.ok) {
      ctx.respond(409, written);
      return true;
    }
    await this.desk.reload();
    ctx.respond(200, { ...this.reply(), imported: { filled: outcome.filled, unmatched: outcome.unmatched } });
    return true;
  }

  private async configure(ctx: RouteContext): Promise<boolean> {
    const body = (await ctx.body()) as Record<string, unknown> | null;
    const sent = POOL_KEYS.filter((key) => body !== null && typeof body === 'object' && body[key] !== undefined);
    if (body === null || sent.length === 0) {
      ctx.respond(422, { ok: false, error: `the pool config needs one of ${POOL_KEYS.join(', ')}` });
      return true;
    }
    const keys = { ...this.desk.stored(this.desk.settings()), ...Object.fromEntries(sent.map((key) => [key, body[key]])) };
    const errors = this.desk.check(keys);
    if (errors.length > 0) {
      ctx.respond(422, { ok: false, error: errors.join('; ') });
      return true;
    }
    const written = await this.config.writePool(keys);
    if (!written.ok) {
      ctx.respond(409, written);
      return true;
    }
    await this.desk.reload();
    ctx.respond(200, this.reply());
    return true;
  }
}
