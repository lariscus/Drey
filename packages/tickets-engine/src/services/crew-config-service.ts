import { CREW_FILE, type CrewConfigReply, type CrewOverridePatch, type CrewPatch } from '../contracts/crew-config';
import { patchCrewFile } from '../core/persona/crew-file-write';
import { withCrewOrder } from '../core/persona/crew-order';
import { personaRef } from '../core/persona/persona';
import { LayeredConfigResolver, type EffectiveCrew } from '../fleet/chain/layered-config-resolver';
import type { CrewConfigFiles } from './crew-config-files';
import type { CrewConfigMigrator } from './crew-config-migrator';
import type { EngineVault } from './host';

export type CrewSetResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * The vault layer of the configuration as the engine uses it (req-173,
 * R13): the board, the chain config and the free sessions read the
 * resolved crew from here; Settings → Tickets reads and patches it. The
 * first read of a vault runs the one-time migration first, so the keys the
 * old places held are in the file before anything resolves.
 */
export class CrewConfigService {
  private readonly resolver = new LayeredConfigResolver();
  private readonly warned = new Set<string>();

  constructor(
    private readonly files: CrewConfigFiles,
    private readonly migrator: CrewConfigMigrator,
    private readonly log: (message: string, level?: 'info' | 'warn') => void,
  ) {}

  /** The file's reader, writer and queue for the one writer that commits `crew.md` together with other files (the crew seeder, req-256). */
  get crewFiles(): Pick<CrewConfigFiles, 'read' | 'put' | 'serial'> {
    return this.files;
  }

  /** The crew resolved for this vault (vault over built-in defaults); a file that does not parse resolves to the defaults. */
  async effective(vault: EngineVault): Promise<EffectiveCrew> {
    await this.migrator.ensure(vault);
    const read = await this.files.read(vault);
    if (read.parse.error !== null && !this.warned.has(read.parse.error)) {
      this.warned.add(read.parse.error);
      this.log(`${read.parse.error} — the built-in defaults apply until it parses`, 'warn');
    }
    return this.resolver.crew(read.parse.config);
  }

  /** What Settings shows: the file's own values, the resolved ones and each one's layer. */
  async reply(vault: EngineVault | null): Promise<CrewConfigReply> {
    if (vault === null) {
      return { ok: false, error: 'no tickets vault detected' };
    }
    await this.migrator.ensure(vault);
    const read = await this.files.read(vault);
    const crew = this.resolver.crew(read.parse.config);
    return { ok: true, file: CREW_FILE, values: read.parse.config.values, resolved: crew.values, sources: crew.sources, overrides: read.parse.config.overrides, error: read.parse.error };
  }

  /** Applies the patches to the file: one commit; nothing written when the text does not change. */
  async set(vault: EngineVault | null, patches: readonly CrewPatch[], overrides: readonly CrewOverridePatch[] = []): Promise<CrewSetResult> {
    if (vault === null) {
      return { ok: false, error: 'no tickets vault detected' };
    }
    await this.migrator.ensure(vault);
    return this.files.serial(async () => {
      const read = await this.files.read(vault);
      const out = patchCrewFile(read.text, patches, overrides);
      if (!out.ok) {
        return out;
      }
      if (out.text !== read.text) {
        const names = [...patches.map((p) => p.key), ...overrides.map((o) => `handover.${o.map}.${o.name}`)];
        await this.files.write(vault, out.text, `tickets: crew settings (${names.join(', ')})`);
      }
      return { ok: true };
    });
  }

  /**
   * req-258: the crew's order — `order:` in crew.md, written whole by the Crew
   * tab's drag (one commit); nothing written when it does not change.
   */
  async setOrder(vault: EngineVault | null, ids: readonly string[]): Promise<CrewSetResult> {
    if (vault === null) {
      return { ok: false, error: 'no tickets vault detected' };
    }
    try {
      ids.forEach((id) => personaRef(id));
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    await this.migrator.ensure(vault);
    return this.files.serial(async () => {
      const read = await this.files.read(vault);
      const out = withCrewOrder(read.text, ids);
      if (!out.ok) {
        return out;
      }
      if (out.text !== read.text) {
        await this.files.write(vault, out.text, 'tickets: crew order');
      }
      return { ok: true };
    });
  }
}
