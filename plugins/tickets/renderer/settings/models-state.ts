// i18n: catalog
/**
 * Settings → Models: what the page holds and how it talks to the engine. The
 * two answers (`poolModels`, `slots`), the one error line and the calls that
 * change them — each returns whether the engine accepted, and a refusal
 * lands in `error`. The parts (harnesses, classes, accounts, routing) read
 * this and repaint through `changed`.
 */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import type { ModelsReply, SlotView } from '../../../../packages/tickets-engine/src/fleet/protocol';

type Refusal = { readonly ok: false; readonly error: string };
type SlotsAnswer = { readonly ok: true; readonly slots: readonly SlotView[] } | Refusal | null | undefined;
type PoolAnswer = ModelsReply | Refusal | null | undefined;

export class ModelsState {
  reply: ModelsReply | null = null;
  slots: readonly SlotView[] = [];
  /** The engine's refusal (or the connection's), shown at the top; '' = none. */
  error = '';
  /** True while Find models again runs. */
  checking = false;
  private discovered = false;
  private fetchedAt = 0;

  constructor(
    readonly api: DreyPluginApi,
    /** Something changed; the page repaints. */
    readonly changed: () => void,
  ) {}

  /** Bound, so the parts can hand it on to the stepper. */
  readonly t = (key: Parameters<DreyPluginApi['i18n']['t']>[0], params?: Parameters<DreyPluginApi['i18n']['t']>[1]): string => this.api.i18n.t(key, params);

  /** Milliseconds since the last read of both answers. */
  age(): number {
    return Date.now() - this.fetchedAt;
  }

  async load(): Promise<void> {
    this.fetchedAt = Date.now();
    const [reply, slots] = await Promise.all([
      (this.api.backend.invoke('poolModels') as Promise<ModelsReply | null>).catch(() => null),
      (this.api.backend.invoke('slots') as Promise<SlotsAnswer>).catch(() => null),
    ]);
    this.reply = reply ?? null;
    this.slots = slots?.ok === true ? slots.slots : [];
    // The first look finds what the harnesses offer, without the network; Find models again goes to the registry.
    const discovery = this.reply?.discovery;
    if (discovery !== undefined && discovery.checkedAt === null && !discovery.running && !this.discovered) {
      this.discovered = true;
      await this.discover(false);
    }
  }

  private offline(): boolean {
    this.error = this.t('tickets.settings.models.offline');
    return false;
  }

  private refused(failure: unknown): boolean {
    this.error = failure instanceof Error ? failure.message : String(failure);
    return false;
  }

  /** A pool call (`poolModelsConfig`, `poolModelAdd`, `poolModelIgnore`, `poolModelsDiscover`). */
  async pool(method: string, payload: unknown): Promise<boolean> {
    try {
      const answer = (await this.api.backend.invoke(method, payload)) as PoolAnswer;
      if (answer === null || answer === undefined) {
        return this.offline();
      }
      if (answer.ok === false) {
        this.error = answer.error;
        return false;
      }
      this.reply = answer;
      this.error = '';
      return true;
    } catch (failure) {
      return this.refused(failure);
    } finally {
      this.changed();
    }
  }

  /** A slot call (`slotAdd`, `slotRemove`, `slotUpdate`); a removal with its models also re-reads the table. */
  async slot(method: 'slotAdd' | 'slotRemove' | 'slotUpdate', payload: unknown): Promise<boolean> {
    let accepted = false;
    try {
      const answer = (await this.api.backend.invoke(method, payload)) as SlotsAnswer;
      if (answer === null || answer === undefined) {
        this.offline();
      } else if (!answer.ok) {
        this.error = answer.error;
      } else {
        this.slots = answer.slots;
        this.error = '';
        accepted = true;
      }
    } catch (failure) {
      this.refused(failure);
    }
    if (accepted && method === 'slotRemove') {
      this.reply = await (this.api.backend.invoke('poolModels') as Promise<ModelsReply | null>).catch(() => this.reply);
    }
    this.changed();
    return accepted;
  }

  async discover(registry: boolean): Promise<void> {
    this.checking = true;
    this.changed();
    try {
      await this.pool('poolModelsDiscover', { registry });
    } finally {
      this.checking = false;
      this.changed();
    }
  }
}
