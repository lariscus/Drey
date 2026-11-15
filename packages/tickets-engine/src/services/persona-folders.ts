import { promises as fsp } from 'node:fs';
import { PERSONAS_DIR } from '../core/persona/persona';
import type { EngineHost, EngineVault } from './host';

/** Whether a persona's folder is there (what the seeder must never touch). */
export interface PersonaFolderPort {
  has(vault: EngineVault, id: string): Promise<boolean>;
}

/** `tickets/_meta/personas/<id>/` looked up on disk through the host's path resolution. */
export class PersonaFolders implements PersonaFolderPort {
  constructor(private readonly host: Pick<EngineHost, 'resolveAssetPath'>) {}

  async has(vault: EngineVault, id: string): Promise<boolean> {
    const dir = this.host.resolveAssetPath(vault.id, `${PERSONAS_DIR}/${id}`);
    if (dir === null) {
      return false;
    }
    return (await fsp.stat(dir).catch(() => null))?.isDirectory() ?? false;
  }
}
