/**
 * Model discovery (req-286, board 7l v3): the models each harness on this
 * machine offers, asked of the harnesses themselves — never typed in. A
 * check runs every probe (in parallel), keeps the harness rows and the
 * models offered, and — when the owner asks (*Find models again*) — fills
 * their capabilities from the registry import (milestone 217). The last
 * check is kept in the service home (`discovery.json`), so the page shows
 * it after a restart; a check runs only when asked (the page asks once,
 * without the registry, when none was ever made).
 * The models found that the table does not hold and the owner did not
 * ignore are the page's new-model cards.
 */
import { discoveryKeyOf, type DiscoveredModel, type DiscoveryReport, type HarnessReport, type HarnessState, type ModelCapabilities, type ModelRow, type OfferedModel, type ProbeOutcome, type WorkerProviderId } from '../protocol';
import type { Clock } from '../ports/clock';
import { suggestedClassOf } from './class-suggestion';
import type { ImportOutcome } from './models-dev-import';
import type { PoolSettingsView } from './pool-settings';
import type { Slot } from './slot';

/** One harness's probe, as the runner's `fleet/harness/probe-*` satisfies it. */
export interface HarnessProbe {
  readonly provider: WorkerProviderId;
  readonly label: string;
  probe(): Promise<ProbeOutcome>;
}

/** The last check as `discovery.json` keeps it. */
export interface SavedDiscovery {
  readonly checkedAt: string;
  readonly harnesses: readonly HarnessReport[];
  readonly offered: readonly DiscoveredModel[];
}

export interface DiscoveryFile {
  read(): Promise<SavedDiscovery | null>;
  write(saved: SavedDiscovery): Promise<void>;
}

/** The registry import, over rows (models.dev, milestone 217). */
export interface CapabilityRegistry {
  fill(rows: readonly ModelRow[]): Promise<ImportOutcome>;
}

export interface ModelDiscoveryDeps {
  readonly probes: readonly HarnessProbe[];
  readonly file: DiscoveryFile;
  readonly settings: Pick<PoolSettingsView, 'classes' | 'table'>;
  readonly slots: () => readonly Slot[];
  /** The `<provider>:<model>` keys the owner ignored (`service.json` → `discovery.ignored`). */
  readonly ignored: () => readonly string[];
  readonly registry: CapabilityRegistry;
  readonly clock: Clock;
  readonly log: (message: string) => void;
}

/** What a check says beside the report: the registry's refusal, when it was asked and failed. */
export interface CheckOutcome {
  readonly registryError: string | null;
}

const has = (caps: ModelCapabilities): boolean => Object.keys(caps).length > 0;

/** The model providers a harness serves through, from its ids (`zai-coding-plan/glm-5.3`); empty when its ids carry none. */
function providersOf(models: readonly OfferedModel[]): string[] {
  return [...new Set(models.map((m) => m.model.split('/')).filter((parts) => parts.length > 1).map((parts) => parts[0]!))];
}

function stateOf(outcome: ProbeOutcome): HarnessState {
  if (!outcome.installed) {
    return 'not-installed';
  }
  if (outcome.error !== null) {
    return 'failed';
  }
  return outcome.signedIn === false ? 'signed-out' : 'signed-in';
}

export class ModelDiscovery {
  private saved: SavedDiscovery | null = null;
  private running: Promise<CheckOutcome> | null = null;

  constructor(private readonly deps: ModelDiscoveryDeps) {}

  async load(): Promise<void> {
    this.saved = await this.deps.file.read().catch(() => null);
  }

  /** Asks every harness again; `withRegistry` fills the capabilities from the registry (one network call). A check already running is joined. */
  check(withRegistry: boolean): Promise<CheckOutcome> {
    if (this.running === null) {
      this.running = this.run(withRegistry).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  report(): DiscoveryReport {
    const table = this.deps.settings.table();
    const ignored = this.deps.ignored();
    const found = (this.saved?.offered ?? []).filter((m) => table.rowsOf(m.model, m.provider).length === 0 && !ignored.includes(discoveryKeyOf(m)));
    return { checkedAt: this.saved?.checkedAt ?? null, running: this.running !== null, harnesses: this.saved?.harnesses ?? [], found, ignored };
  }

  /** The model the key names among the last check's offers; null when it offered none such. */
  offered(provider: WorkerProviderId, model: string): DiscoveredModel | null {
    return this.saved?.offered.find((m) => m.provider === provider && m.model === model) ?? null;
  }

  private async run(withRegistry: boolean): Promise<CheckOutcome> {
    const outcomes = await Promise.all(this.deps.probes.map(async (probe) => ({ probe, outcome: await probe.probe().catch((error: unknown) => failedOutcome(error)) })));
    const harnesses = outcomes.map(({ probe, outcome }) => this.harnessOf(probe, outcome));
    let offered = outcomes.flatMap(({ probe, outcome }) => outcome.models.map((m) => this.discoveredOf(probe.provider, m)));
    let registryError: string | null = null;
    if (withRegistry && offered.length > 0) {
      const filled = await this.withCapabilities(offered);
      offered = filled.offered;
      registryError = filled.error;
    }
    this.saved = { checkedAt: this.deps.clock.now().toISOString(), harnesses, offered };
    await this.deps.file.write(this.saved).catch((error: unknown) => this.deps.log(`discovery.json could not be written: ${error instanceof Error ? error.message : String(error)}`));
    return { registryError };
  }

  private harnessOf(probe: HarnessProbe, outcome: ProbeOutcome): HarnessReport {
    return { provider: probe.provider, label: probe.label, version: outcome.version, state: stateOf(outcome), providers: providersOf(outcome.models), models: outcome.models.length, error: outcome.error };
  }

  /** One offered model: its account (opencode's provider entry names one), what the last check knew of it, the class the card proposes. */
  private discoveredOf(provider: WorkerProviderId, offered: OfferedModel): DiscoveredModel {
    const prefix = offered.model.includes('/') ? offered.model.split('/')[0]! : null;
    const slot = provider === 'opencode' && prefix !== null ? (this.deps.slots().find((s) => s.provider === 'opencode' && s.login.opencodeAuthEntry === prefix)?.id ?? null) : null;
    const before = this.offered(provider, offered.model);
    const suggested = suggestedClassOf(offered.model, this.deps.settings.classes().map((c) => c.name));
    return { model: offered.model, provider, slot, name: offered.name, capabilities: before?.capabilities ?? {}, suggested };
  }

  private async withCapabilities(offered: readonly DiscoveredModel[]): Promise<{ offered: DiscoveredModel[]; error: string | null }> {
    const rows: ModelRow[] = offered.map((m) => ({ model: m.model, slot: null, provider: m.provider, category: '', class: m.suggested, cost: 1, enabled: true }));
    const outcome = await this.deps.registry.fill(rows);
    if (!outcome.ok) {
      return { offered: [...offered], error: outcome.error };
    }
    return {
      offered: offered.map((m, i) => {
        const row = outcome.rows[i]!;
        const caps: ModelCapabilities = { ...(row.input !== undefined ? { input: row.input } : {}), ...(row.tools !== undefined ? { tools: row.tools } : {}), ...(row.context !== undefined ? { context: row.context } : {}), ...(row.output !== undefined ? { output: row.output } : {}) };
        return has(caps) ? { ...m, capabilities: caps } : m;
      }),
      error: null,
    };
  }
}

function failedOutcome(error: unknown): ProbeOutcome {
  return { installed: true, version: null, signedIn: null, models: [], error: error instanceof Error ? error.message : String(error) };
}
