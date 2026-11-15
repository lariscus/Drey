import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { LEGACY_CHAIN_FILE, PRE_VAULT_CHAIN_FILE } from '../fleet/chain/chain-state-paths';
import { CREW_MIGRATED_KEY, type CrewLegacyPort } from './crew-config-migrator';

/** The engine's config store as the migration needs it (`FileConfigStore` fits). */
export interface FlatConfigStore {
  all(): Promise<Readonly<Record<string, unknown>>>;
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

async function configOfChainFile(file: string): Promise<Readonly<Record<string, unknown>> | null> {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as { config?: unknown };
    return typeof parsed.config === 'object' && parsed.config !== null ? (parsed.config as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The old places of the vault keys on this device (req-173): the engine's
 * `config.json` and the fleet root's chain file from before the per-vault
 * split — `chain.legacy.json` once the runner moved it aside, `chain.json`
 * while it has not yet.
 */
export class CrewLegacyFiles implements CrewLegacyPort {
  constructor(
    private readonly store: FlatConfigStore,
    private readonly fleetRoot: string,
  ) {}

  config(): Promise<Readonly<Record<string, unknown>>> {
    return this.store.all();
  }

  async chainConfig(): Promise<Readonly<Record<string, unknown>> | null> {
    return (await configOfChainFile(path.join(this.fleetRoot, LEGACY_CHAIN_FILE))) ?? (await configOfChainFile(path.join(this.fleetRoot, PRE_VAULT_CHAIN_FILE)));
  }

  async markDone(vaultKey: string, at: string): Promise<void> {
    const marks = await this.store.get<Record<string, string>>(CREW_MIGRATED_KEY);
    await this.store.set(CREW_MIGRATED_KEY, { ...(typeof marks === 'object' && marks !== null ? marks : {}), [vaultKey]: at });
  }
}
