import { OPENCODE_API, OPENCODE_BUILTIN_COMMANDS, stripVariant, type OcModel } from './opencode-api';
import { emitOf, type OpencodeContext } from './opencode-state';

/**
 * What the OpenCode server offers a worker: its slash commands (the
 * built-ins and the project's own) and the model's context window, asked
 * once per worker. A `/name args` prompt naming a known command runs as
 * that command.
 */
export class OpencodeCatalog {
  private readonly custom = new Set<string>();

  constructor(private readonly ctx: OpencodeContext) {}

  /** The project's custom commands, fetched once the server is up; the built-ins alone on a failure. */
  async loadCommands(): Promise<void> {
    try {
      const res = await this.ctx.client.get(OPENCODE_API.commands);
      if (res.ok) {
        for (const c of (await this.ctx.client.data<ReadonlyArray<{ name?: string }>>(res)) ?? []) {
          if (typeof c.name === 'string') {
            this.custom.add(c.name);
          }
        }
      }
    } catch {
      // the built-ins alone are still offered
    }
    emitOf(this.ctx)({ kind: 'usage', commands: [...OPENCODE_BUILTIN_COMMANDS, ...this.custom] });
  }

  /** Runs `/name args` as the command it names; false = not a command, send it as a prompt. */
  async postCommand(name: string, args: string): Promise<boolean> {
    const { state, client } = this.ctx;
    const isCompact = name === 'compact';
    if (state.sessionRef === null || !client.bound || (!isCompact && !this.custom.has(name))) {
      return false;
    }
    try {
      const res = await client.post(isCompact ? OPENCODE_API.compact(state.sessionRef) : OPENCODE_API.command(state.sessionRef), isCompact ? {} : { name, text: args });
      if (!res.ok) {
        emitOf(this.ctx)({ kind: 'error', text: `/${name} failed: ${res.status}` });
      }
      return res.ok;
    } catch (error) {
      emitOf(this.ctx)({ kind: 'error', text: String(error).slice(0, 300) });
      return false;
    }
  }

  /**
   * The model's context window: the catalog entry the pin names
   * (`providerID` + `id`, then `providerID` + `modelID`, a `#variant`
   * stripped), else the server's default model. A miss is one stream note —
   * the number is never guessed.
   */
  async reportContextWindow(): Promise<void> {
    try {
      const found = await this.modelInfo();
      if (typeof found === 'string') {
        return this.missing(found);
      }
      const window = found.limit?.context;
      if (typeof window !== 'number' || window <= 0) {
        return this.missing('the model entry carries no context limit');
      }
      emitOf(this.ctx)({ kind: 'usage', contextWindow: window });
    } catch (error) {
      this.missing(String(error).slice(0, 160));
    }
  }

  /** The model's catalog entry, or why there is none. */
  private async modelInfo(): Promise<OcModel | string> {
    const model = this.ctx.start.model;
    const client = this.ctx.client;
    if (model === null || model.trim() === '') {
      const res = await client.get(OPENCODE_API.modelDefault);
      if (!res.ok) {
        return `the default model fetch failed (${res.status})`;
      }
      return (await client.data<OcModel>(res)) ?? 'the server names no default model';
    }
    const slashAt = model.indexOf('/');
    const providerID = (slashAt === -1 ? '' : model.slice(0, slashAt)).trim();
    const pinned = stripVariant((slashAt === -1 ? model : model.slice(slashAt + 1)).trim());
    const res = await client.get(OPENCODE_API.models);
    if (!res.ok) {
      return `the model catalog fetch failed (${res.status})`;
    }
    const catalog = (await client.data<ReadonlyArray<OcModel>>(res)) ?? [];
    const entry =
      catalog.find((m) => m.providerID === providerID && stripVariant(m.id ?? '') === pinned) ?? catalog.find((m) => m.providerID === providerID && stripVariant(m.modelID ?? '') === pinned);
    return entry ?? `the catalog has no entry for ${providerID === '' ? '' : `${providerID}/`}${pinned}`;
  }

  private missing(why: string): void {
    emitOf(this.ctx)({ kind: 'note', detail: 'runner', text: `context window not reported — ${why}` });
  }
}
