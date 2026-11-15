import type { FileSystem } from '../ports/file-system';
import type { ChainFile, ChainVaultLocator } from './chain-state';
import { locatorOf } from './chain-state';
import type { ChainStatePaths } from './chain-state-paths';

/**
 * The one move of a runner's machine-wide `chain.json` from before req-173
 * into its vault's own file: the runtime state goes to
 * `chains/<vault key>/chain.json` (its `config` dropped — that is the
 * vault's `_meta/crew.md` now), the file itself is kept as
 * `chain.legacy.json` for the key migration and removed from the root. A
 * file that names no vault (an unconfigured chain) has no state worth a
 * vault; it is set aside the same way.
 */
export class PreVaultChainMove {
  constructor(
    private readonly paths: ChainStatePaths,
    private readonly fs: FileSystem,
    private readonly log: (message: string) => void,
  ) {}

  /** Moves the root file when there is one; the vault it belonged to, or null. */
  async run(): Promise<ChainVaultLocator | null> {
    const raw = await this.fs.readTextOrNull(this.paths.preVault());
    if (raw === null) {
      return null;
    }
    await this.fs.writeAtomic(this.paths.legacy(), raw);
    await this.fs.remove(this.paths.preVault());
    const parsed = this.parse(raw);
    const config = parsed?.config ?? null;
    if (parsed === null || config === null || typeof config.ticketsVaultPath !== 'string' || config.ticketsVaultPath === '') {
      this.log('chain.json named no tickets vault — set aside as chain.legacy.json');
      return null;
    }
    const vault = locatorOf(config);
    const { config: _dropped, ...runtime } = parsed;
    const file = this.paths.fileFor(vault.ticketsVaultPath);
    await this.fs.mkdirp(this.fs.dirname(file));
    await this.fs.writeAtomic(file, `${JSON.stringify({ ...runtime, vault }, null, 2)}\n`);
    this.log(`chain.json moved to the vault's own file (${file}); its config is the vault's _meta/crew.md now`);
    return vault;
  }

  private parse(raw: string): ChainFile | null {
    try {
      const parsed = JSON.parse(raw) as ChainFile;
      return parsed.version === 1 ? parsed : null;
    } catch {
      return null;
    }
  }
}
