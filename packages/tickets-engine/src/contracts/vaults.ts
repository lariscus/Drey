/**
 * The registered vaults as Drey Service knows them (req-167): Drey keeps the
 * engine config key {@link VAULTS_KEY} on its vault registry (ADR-0051), so a
 * worker's vault MCP reaches every vault the owner registered — with Drey
 * closed too, the last list Drey named. Without the key the service serves
 * the vault it was started for.
 */

/** One registered vault: Drey's registry id, its name, its folder. */
export interface RegisteredVault {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  /** Drey's active vault: a single-file tool call without `vault` lands here. */
  readonly active: boolean;
}

/** The engine config key holding `RegisteredVault[]`. */
export const VAULTS_KEY = 'vaults.registered';

/** The key's value as it was stored; anything malformed is left out. */
export function parseRegisteredVaults(raw: unknown): RegisteredVault[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry: unknown): RegisteredVault[] => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const { id, name, path } = item;
    return typeof id === 'string' && id !== '' && typeof path === 'string' && path !== ''
      ? [{ id, name: typeof name === 'string' && name !== '' ? name : id, path, active: item['active'] === true }]
      : [];
  });
}
