import type { FileSystem } from '../fleet/ports/file-system';
import type { ClassConfig, ModelRow } from '../fleet/protocol-pool';
import { parsePoolSettings } from '../fleet/routing/pool-config';
import { ServiceConfigFile, type OpencodeAccounts } from '../fleet/routing/service-config-file';
import { parseServiceSlots } from '../fleet/routing/slot-config';

/** Where the engine reads the machine's model table (req-256). */
export interface ModelTablePort {
  /** The table's rows; null when there is no readable `service.json` (the machine has no table yet). */
  rows(): Promise<readonly ModelRow[] | null>;
}

/**
 * The model table (ADR-0095) read from `service.json` in the service home —
 * the file the Crew runner itself reads, so the answer does not depend on a
 * runner being awake (it sleeps when idle, and `GET /models` never wakes
 * one). Read-only: the file is never written here. A broken row is left out
 * like the pool leaves it out; a file that is absent or does not parse has no table.
 */
export class ServiceModelTable implements ModelTablePort {
  private readonly file: ServiceConfigFile;

  constructor(fs: FileSystem, serviceJsonPath: string, accounts?: OpencodeAccounts) {
    this.file = new ServiceConfigFile(fs, serviceJsonPath, accounts);
  }

  async rows(): Promise<readonly ModelRow[] | null> {
    return (await this.table())?.models ?? null;
  }

  /**
   * req-288: the owner's classes and the model rows — what the Persona page's Model block draws
   * while no runner is awake to answer `GET /models`; null without a readable table.
   */
  async table(): Promise<{ readonly ok: true; readonly classes: readonly ClassConfig[]; readonly models: readonly ModelRow[] } | null> {
    const { root, error } = await this.file.read();
    if (error !== null || !Array.isArray(root['models'])) {
      return null;
    }
    const { classes, models } = parsePoolSettings(root, parseServiceSlots(root).slots).settings;
    return { ok: true, classes, models };
  }
}
