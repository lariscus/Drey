import * as path from 'node:path';
import { parseRegisteredVaults, VAULTS_KEY } from '../contracts/vaults';

/**
 * Whether the vault the engine hosts is still one of the vaults Drey has
 * registered (D-73). The service is started for one vault folder and outlives
 * Drey's registry changes; Drey names the registered vaults under
 * {@link VAULTS_KEY} on every change. A hosted vault that left that list is
 * *unloaded*: the engine serves no board from it until the folder is
 * registered again. Nothing on disk is touched — unloading is not deleting.
 *
 * Without the key (no Drey ever named a registry: a standalone engine, a
 * first start) the vault counts as loaded.
 */
export class HostedVault {
  constructor(
    private readonly vaultPath: string,
    private readonly config: { get<T>(key: string): Promise<T | undefined> },
  ) {}

  async loaded(): Promise<boolean> {
    const raw = await this.config.get<unknown>(VAULTS_KEY).catch(() => undefined);
    if (!Array.isArray(raw)) {
      return true;
    }
    const own = sameFolder(this.vaultPath);
    return parseRegisteredVaults(raw).some((vault) => sameFolder(vault.path) === own);
  }
}

/** A folder as one comparable string: resolved, and case-folded on Windows (Drey's registry compares the same way). */
function sameFolder(folder: string): string {
  const resolved = path.resolve(folder);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
