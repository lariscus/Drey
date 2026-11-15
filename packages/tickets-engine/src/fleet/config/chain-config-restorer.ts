import { CREW_FILE } from '../../contracts/crew-config';
import { parseCrewFile } from '../../core/crew-file';
import type { FileSystem } from '../ports/file-system';
import type { ChainConfig } from '../protocol';
import type { ChainVaultLocator } from '../orchestrate/chain-state';
import { LayeredConfigResolver } from './layered-config-resolver';

/**
 * The chain config a restarted runner works with before the board sends
 * one (req-173): `chain.json` keeps no configuration, so a runner that
 * keeps the Autopilot across a handover resolves the vault's
 * `_meta/crew.md` itself — the same resolver the board uses, so both
 * arrive at the same values. The board's next config replaces it.
 */
export class ChainConfigRestorer {
  private readonly resolver = new LayeredConfigResolver();

  constructor(private readonly fs: Pick<FileSystem, 'readTextOrNull' | 'join'>) {}

  async restore(vault: ChainVaultLocator): Promise<ChainConfig> {
    const text = await this.fs.readTextOrNull(this.fs.join(vault.ticketsVaultPath, ...CREW_FILE.split('/')));
    const crew = this.resolver.crew(parseCrewFile(text).config);
    return {
      ...vault,
      defaultWorker: crew.defaultWorker,
      defaultPersona: crew.defaultPersona,
      permissionMode: crew.permissionMode,
      caps: crew.caps,
      handover: crew.handover,
    };
  }
}
