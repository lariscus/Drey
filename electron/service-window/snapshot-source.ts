/** Board 8a's whole picture at one moment (req-165): the service's status, the runner's runs, slots and ledgers, the local model. */
import type { ServiceSnapshot } from '../../shared/service-window/contract';
import type { LocalModelProbe } from './local-model-probe';
import type { ServiceCalls } from './service-calls';
import { DEFAULT_LOAD, componentsOf, governorFactsOf, isLive, loadOf, slotFactsOf, spendOf } from './snapshot-map';

const obj = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

export class SnapshotSource {
  constructor(
    private readonly calls: ServiceCalls,
    private readonly model: LocalModelProbe,
  ) {}

  async snapshot(): Promise<ServiceSnapshot> {
    const [status, runs, slots, models, model, governor] = await Promise.all([
      this.calls.status(),
      this.calls.runs(),
      this.calls.slots(),
      this.calls.models(),
      this.model.facts(),
      this.calls.governor(),
    ]);
    const settings = obj(status?.['settings']);
    const live = runs.filter(isLive).length;
    return {
      running: status !== null,
      pid: typeof status?.['pid'] === 'number' ? status['pid'] : null,
      startedAt: typeof status?.['startedAt'] === 'string' ? status['startedAt'] : null,
      components: { ...componentsOf(status ?? {}, live), model },
      spend: spendOf(models),
      slots: slots === null ? null : slots.map(obj).map(slotFactsOf),
      load: status === null ? DEFAULT_LOAD : loadOf(settings),
      governor: governor === null ? null : governorFactsOf(governor),
      autostart: settings['enabled'] === true && settings['autostart'] === true,
    };
  }

  /** Whether the tray icon is wanted (`service.trayIcon`); null while no service answers. */
  async trayWanted(): Promise<boolean | null> {
    const status = await this.calls.status();
    if (status === null) {
      return null;
    }
    return obj(status['settings'])['trayIcon'] !== false;
  }
}
