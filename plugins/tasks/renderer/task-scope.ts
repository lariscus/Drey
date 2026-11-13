/**
 * Which vaults a Tasks-mode query reads outside the file scope: the active
 * vault, every vault, or (SDK 1.59) the vaults of the title bar's scope
 * choice. Pure -- the entry point hands in the registry and the choice.
 */
import type { FindQuery, WorkspaceScopeOption } from '../../../shared/plugin-api/renderer';
import { scopeVaultIds, type NamedVault } from '../../../shared/workspace-scope';

/**
 * The vault ids a vault / all / project query keeps; `null` = every vault.
 * A project scope whose choice no longer narrows reads as the vault scope
 * (the Find panel sends `project` only while it narrows; this is the guard).
 */
export function taskScopeVaults(
  scope: Exclude<FindQuery['scope'], 'file'>,
  activeVaultId: string | null,
  option: WorkspaceScopeOption | null,
  vaults: readonly NamedVault[],
): ReadonlySet<string> | null {
  if (scope === 'all') {
    return null;
  }
  if (scope === 'project') {
    const ids = scopeVaultIds(option, vaults);
    if (ids !== null) {
      return ids;
    }
  }
  return new Set(activeVaultId !== null ? [activeVaultId] : []);
}
