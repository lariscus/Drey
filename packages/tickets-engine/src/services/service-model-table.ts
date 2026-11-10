import type { FileSystem } from '../fleet/ports/file-system';
import type { ModelRow } from '../fleet/protocol-pool';
import { parsePoolSettings } from '../fleet/routing/pool-config';
import { ServiceConfigFile } from '../fleet/routing/service-config-file';
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

  constructor(fs: FileSystem, serviceJsonPath: string) {
    this.file = new ServiceConfigFile(fs, serviceJsonPath);
  }

  async rows(): Promise<readonly ModelRow[] | null> {
    const { root, error } = await this.file.read();
    if (error !== null || !Array.isArray(root['models'])) {
      return null;
    }
    return parsePoolSettings(root, parseServiceSlots(root).slots).settings.models;
  }
}
