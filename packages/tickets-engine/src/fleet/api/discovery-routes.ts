import { discoveryKeyOf, isWorkerProvider, type ModelRow, type WorkerProviderId } from '../protocol';
import { modelsReplyOf, type PoolConfigStore, type PoolDesk } from './model-routes';
import type { RouteContext, RouteGroup } from './route-context';

type Body = Record<string, unknown>;

const textOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** The harness and model a card names, or why the body does not. */
function targetOf(body: Body): { readonly provider: WorkerProviderId; readonly model: string } | string {
  const model = textOf(body['model']);
  const provider = body['provider'];
  if (model === null || !isWorkerProvider(provider)) {
    return 'a discovered model needs its provider and its model id';
  }
  return { provider, model };
}

/**
 * Model discovery's routes (req-286, board 7l v3): `POST /models/discover`
 * (*Find models again*) asks every harness and fills the capabilities from
 * the registry import — the found models' and the table rows' missing
 * columns (milestone 217); `{ registry: false }` asks the harnesses only (the
 * page's first look on a machine never checked: no network call); `POST /models/add` takes a found model into the
 * table under the class the card picked; `POST /models/ignore` keeps its card
 * away. No model is typed in: a model the last check did not find is refused.
 */
export class DiscoveryRoutes implements RouteGroup {
  constructor(
    private readonly desk: PoolDesk,
    private readonly config: PoolConfigStore,
  ) {}

  async handle(ctx: RouteContext): Promise<boolean> {
    switch (`${ctx.method} ${ctx.pathname}`) {
      case 'POST /models/discover':
        return this.discover(ctx);
      case 'POST /models/add':
        return this.add(ctx);
      case 'POST /models/ignore':
        return this.ignore(ctx);
      default:
        return false;
    }
  }

  private async discover(ctx: RouteContext): Promise<boolean> {
    const body = ((await ctx.body()) ?? {}) as Body;
    const withRegistry = body['registry'] !== false;
    const { registryError } = await this.desk.discover(withRegistry);
    if (withRegistry && registryError === null) {
      const filled = await this.desk.importCapabilities();
      if (filled.ok && filled.filled.length > 0) {
        await this.config.writePool(this.desk.stored({ ...this.desk.settings(), models: filled.rows }));
        await this.desk.reload();
      }
    }
    ctx.respond(200, { ...modelsReplyOf(this.desk, this.config), registryError });
    return true;
  }

  private async add(ctx: RouteContext): Promise<boolean> {
    const body = ((await ctx.body()) ?? {}) as Body;
    const target = targetOf(body);
    const chosen = textOf(body['class']);
    if (typeof target === 'string' || chosen === null) {
      ctx.respond(422, { ok: false, error: typeof target === 'string' ? target : 'a model is added to a class' });
      return true;
    }
    const found = this.desk.offered(target.provider, target.model);
    if (found === null) {
      ctx.respond(404, { ok: false, error: `${target.model} was not found on ${target.provider} — find models again first` });
      return true;
    }
    const settings = this.desk.settings();
    const row: ModelRow = { model: found.model, slot: found.slot, provider: found.provider, category: '', class: chosen, cost: 1, enabled: true, ...found.capabilities };
    const keys = this.desk.stored({ ...settings, models: [...settings.models, row] });
    return this.write(ctx, keys);
  }

  private async ignore(ctx: RouteContext): Promise<boolean> {
    const target = targetOf(((await ctx.body()) ?? {}) as Body);
    if (typeof target === 'string') {
      ctx.respond(422, { ok: false, error: target });
      return true;
    }
    const ignored = [...new Set([...this.desk.ignored(), discoveryKeyOf(target)])];
    return this.write(ctx, { discovery: { ignored } });
  }

  /** Checks the keys as the parse would, writes them beside every other key, reloads and answers. */
  private async write(ctx: RouteContext, keys: Readonly<Record<string, unknown>>): Promise<boolean> {
    const errors = this.desk.check({ ...this.desk.stored(this.desk.settings()), ...keys });
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
    ctx.respond(200, modelsReplyOf(this.desk, this.config));
    return true;
  }
}
