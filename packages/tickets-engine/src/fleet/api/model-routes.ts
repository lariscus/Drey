import type { LedgerFigure, ModelsReply, PoolLoad, PoolSettings, QueueEntry } from '../protocol';
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
}

/** What the routes need of `service.json`. */
export interface PoolConfigStore {
  readonly path: string;
  writePool(keys: Readonly<Record<string, unknown>>): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
}

const POOL_KEYS = ['models', 'capacity', 'ledgers'] as const;

/**
 * The capacity pool's settings (req-170, board 7l): `GET /models` reads the
 * model table, the cap, the ledger defaults, the live load, the queue and
 * today's spend per slot; `POST /models/config` replaces the keys it sends
 * (`models`, `capacity`, `ledgers` — the ones it leaves out stay), checked
 * row by row before anything is written, then reloads.
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
      default:
        return false;
    }
  }

  private reply(): ModelsReply {
    return { ok: true, ...this.desk.settings(), now: this.desk.load(), queue: this.desk.queue(), providerDay: this.desk.providerDay(), errors: this.desk.errors(), configPath: this.config.path };
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
