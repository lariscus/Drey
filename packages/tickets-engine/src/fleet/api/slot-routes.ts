import type { SlotView } from '../protocol';
import type { RouteContext, RouteGroup } from './route-context';

/** What the routes need of the slot registry. */
export interface SlotDesk {
  views(): readonly SlotView[];
  view(id: string): SlotView | null;
  find(id: string): unknown;
  load(): Promise<void>;
  refresh(id?: string, force?: boolean): Promise<void>;
  clearLogin(id: string): void;
}

/** What the routes need of `service.json`. */
type Written = { readonly ok: true } | { readonly ok: false; readonly error: string };
/** A one-slot edit: `invalid` when the edit itself does not stand (422), else the file refused it (409). */
type Edited = Written | { readonly ok: false; readonly error: string; readonly invalid: true };

export interface SlotConfigStore {
  readonly path: string;
  writeSlots(slots: readonly unknown[]): Promise<Written>;
  addSlot(entry: unknown): Promise<Edited>;
  removeSlot(id: string): Promise<Edited>;
}

/** Checks a `slots` list before it is written: the reasons the parse would leave entries out. */
export type SlotListCheck = (slots: readonly unknown[]) => readonly string[];

/**
 * The slots (req-177, boards 7l and 7e): `GET /slots` reads every slot with
 * its windows, q, state and last fetch; `POST /slots/refresh` reads the
 * quotas now; `POST /slots/login-done` clears a `needs login` after the
 * owner signed in again; `POST /slots/config` writes the `slots` of
 * `service.json` (every other key kept) and reloads; `POST /slots/add` and
 * `POST /slots/remove` change one slot, every other entry kept as written
 * (D-69, Settings → Models).
 */
export class SlotRoutes implements RouteGroup {
  constructor(
    private readonly desk: SlotDesk,
    private readonly config: SlotConfigStore,
    private readonly check: SlotListCheck,
  ) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    switch (`${ctx.method} ${ctx.pathname}`) {
      case 'GET /slots':
        ctx.respond(200, this.reply());
        return true;
      case 'POST /slots/refresh':
        return this.refresh(ctx);
      case 'POST /slots/login-done':
        return this.loginDone(ctx);
      case 'POST /slots/config':
        return this.configure(ctx);
      case 'POST /slots/add':
        return this.edit(ctx, (body) => this.config.addSlot(body['slot']));
      case 'POST /slots/remove':
        return this.edit(ctx, (body) => (typeof body['id'] === 'string' ? this.config.removeSlot(body['id']) : Promise.resolve({ ok: false, error: 'a slot to remove needs its id', invalid: true } as const)));
      default:
        return false;
    }
  }

  private reply(): { readonly ok: true; readonly slots: readonly SlotView[]; readonly configPath: string } {
    return { ok: true, slots: this.desk.views(), configPath: this.config.path };
  }

  private async refresh(ctx: RouteContext): Promise<boolean> {
    const body = (await ctx.body()) as { id?: unknown };
    const id = typeof body.id === 'string' ? body.id : undefined;
    if (id !== undefined && this.desk.find(id) === null) {
      ctx.respond(404, { ok: false, error: `unknown slot "${id}"` });
      return true;
    }
    await this.desk.load();
    await this.desk.refresh(id, true);
    ctx.respond(200, this.reply());
    return true;
  }

  private async loginDone(ctx: RouteContext): Promise<boolean> {
    const body = (await ctx.body()) as { id?: unknown };
    if (typeof body.id !== 'string' || this.desk.find(body.id) === null) {
      ctx.respond(404, { ok: false, error: `unknown slot "${String(body.id)}"` });
      return true;
    }
    this.desk.clearLogin(body.id);
    await this.desk.refresh(body.id, true);
    ctx.respond(200, { ok: true, slot: this.desk.view(body.id) });
    return true;
  }

  private async configure(ctx: RouteContext): Promise<boolean> {
    const body = (await ctx.body()) as { slots?: unknown };
    if (!Array.isArray(body.slots)) {
      ctx.respond(422, { ok: false, error: 'the slot config needs a slots list' });
      return true;
    }
    const errors = this.check(body.slots);
    if (errors.length > 0) {
      ctx.respond(422, { ok: false, error: errors.join('; ') });
      return true;
    }
    const written = await this.config.writeSlots(body.slots);
    if (!written.ok) {
      ctx.respond(409, written);
      return true;
    }
    await this.desk.load();
    await this.desk.refresh(undefined, true);
    ctx.respond(200, this.reply());
    return true;
  }

  /** One slot added or removed: refused while `service.json` does not parse or the edit does not stand. */
  private async edit(ctx: RouteContext, change: (body: Record<string, unknown>) => Promise<Edited>): Promise<boolean> {
    const raw = (await ctx.body()) as unknown;
    const edited = await change(raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});
    if (!edited.ok) {
      ctx.respond('invalid' in edited ? 422 : 409, { ok: false, error: edited.error });
      return true;
    }
    await this.desk.load();
    await this.desk.refresh(undefined, true);
    ctx.respond(200, this.reply());
    return true;
  }
}
