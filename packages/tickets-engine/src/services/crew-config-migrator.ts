import { patchCrewFile } from '../core/persona/crew-file-write';
import type { CrewConfigFiles } from './crew-config-files';
import { CrewMigrationPlan, type LegacyCrewSources } from './crew-migration-plan';
import type { EngineVault } from './host';

/** The engine's `config.json` key that records which vaults were migrated (path → ISO stamp). */
export const CREW_MIGRATED_KEY = 'crew.migrated';

/** Where the old values are read and the done-marker is kept (the engine's `config.json` and fleet root). */
export interface CrewLegacyPort {
  /** Every key of the engine's `config.json`. */
  config(): Promise<Readonly<Record<string, unknown>>>;
  /** The `config` object of the chain file from before req-173 (`chain.legacy.json`, else `chain.json`); null when none. */
  chainConfig(): Promise<Readonly<Record<string, unknown>> | null>;
  markDone(vaultKey: string, at: string): Promise<void>;
}

/** The marker key of a vault: its path, forward slashes, lower case (Windows paths compare that way). */
export function vaultKeyOf(vaultPath: string): string {
  return vaultPath.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * The one-time key migration of req-173 (R13): the vault keys that sat in
 * `~/.drey-engine/config.json` (`defaultWorker`, `autoPermissionMode`,
 * `personas.default`, `fleet.cap.*`, `fleet.compactAboveTokens*`,
 * `fleet.resumePauseTtlMin`, `fleet.contextCapTokens*`) and in the old
 * `chain.json`'s `config` move into `_meta/crew.md` — one commit, every
 * move logged. Once per vault and device: the marker in `config.json`
 * (`crew.migrated`) keeps it from running again, and the plan itself only
 * adds keys the file lacks, so a second run writes nothing. The old keys
 * are left where they were and read by nothing (ADR-0092 later change).
 */
export class CrewConfigMigrator {
  private readonly done = new Map<string, Promise<void>>();
  private readonly plan = new CrewMigrationPlan();

  constructor(
    private readonly files: CrewConfigFiles,
    private readonly legacy: CrewLegacyPort,
    private readonly log: (message: string, level?: 'info' | 'warn') => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Runs the migration for this vault once per process; later calls await the first. */
  ensure(vault: EngineVault): Promise<void> {
    const key = vaultKeyOf(vault.path);
    let running = this.done.get(key);
    if (running === undefined) {
      running = this.run(vault, key).catch((error: unknown) => this.log(`crew.md migration failed: ${error instanceof Error ? error.message : String(error)}`, 'warn'));
      this.done.set(key, running);
    }
    return running;
  }

  private async run(vault: EngineVault, key: string): Promise<void> {
    const config = await this.legacy.config();
    const marks = config[CREW_MIGRATED_KEY];
    if (typeof marks === 'object' && marks !== null && key in marks) {
      return;
    }
    const sources: LegacyCrewSources = { config, chain: await this.legacy.chainConfig() };
    await this.files.serial(async () => {
      const read = await this.files.read(vault);
      if (read.parse.error !== null) {
        this.log(`crew.md: ${read.parse.error} — the old settings stay where they are until it parses`, 'warn');
        return;
      }
      const migration = this.plan.plan(read.parse.config, sources);
      if (migration.moves.length > 0) {
        const out = patchCrewFile(read.text, migration.values, migration.overrides);
        if (!out.ok) {
          this.log(`crew.md migration refused: ${out.error}`, 'warn');
          return;
        }
        await this.files.write(vault, out.text, 'tickets: crew settings move into _meta/crew.md (req-173)');
        for (const move of migration.moves) {
          this.log(`crew.md: ${move.key} = ${move.value} (moved from ${move.from})`);
        }
      }
      await this.legacy.markDone(key, this.now().toISOString());
    });
  }
}
