/**
 * Which vaults a worker reaches (req-167, R5: it reads every registered
 * vault): the engine config key Drey keeps on its registry, re-read at every
 * call so a vault Drey added or removed applies at once; without the key, the
 * vault the service was started for.
 */
import { parseRegisteredVaults, VAULTS_KEY } from '../../contracts/vaults';
import type { VaultSite } from './disk-tool-vault';
import type { VaultDisk } from './vault-disk';

/** The slice of the engine config this reads. */
export interface VaultsConfig {
  get<T>(key: string): Promise<T | undefined>;
}

export class RegisteredVaults {
  constructor(
    private readonly config: VaultsConfig,
    /** The vault the service was started for (`--vault`). */
    private readonly hosted: string,
    private readonly disk: Pick<VaultDisk, 'isFolder'>,
  ) {}

  async current(): Promise<VaultSite[]> {
    const named = parseRegisteredVaults(await this.config.get<unknown>(VAULTS_KEY).catch(() => undefined));
    const vaults = named.length > 0 ? named : [{ id: 'vault', name: this.hosted.split(/[\\/]/).filter((p) => p !== '').pop() ?? 'vault', path: this.hosted, active: true }];
    return Promise.all(vaults.map(async (vault) => ({ ...vault, exists: await this.disk.isFolder(vault.path) })));
  }
}
