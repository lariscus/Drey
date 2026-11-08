import { contextCap } from '../handover';
import { DEFAULT_FLEET_HANDOVER, type FleetHandoverConfig, type WorkerProviderId } from '../protocol';

/**
 * The session-handover thresholds (T-0049) one supervisor works with: the
 * defaults until the runner pushes the plugin's chain config, idempotent,
 * applied from the next start on.
 */
export class HandoverSettings {
  private current: FleetHandoverConfig = DEFAULT_FLEET_HANDOVER;

  constructor(private readonly provider: WorkerProviderId) {}

  set(config: FleetHandoverConfig): void {
    this.current = config;
  }

  get config(): FleetHandoverConfig {
    return this.current;
  }

  /** The mid-run context cap for this supervisor's provider and a model pin (req-80). */
  contextCap(model: string | null): number {
    return contextCap(this.current, this.provider, model);
  }
}
