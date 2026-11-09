/**
 * Which vault and path one vault tool call names (req-167) — for the audit
 * line and the stale-write guard, resolved the way the tool set itself
 * resolves it (`ToolScope.locate`), so the audit names the file the call
 * really touched.
 */
import { cleanPath, ToolScope, type ToolVault, type VaultCallOptions } from '../../../../../shared/vault-tools';

export interface VaultCallTarget {
  readonly vault: string | null;
  readonly path: string | null;
}

const SINGLE_FILE = new Set(['vault_read', 'vault_edit', 'vault_write']);

export function vaultCallTarget(vault: ToolVault, options: VaultCallOptions, name: string, args: Readonly<Record<string, unknown>>): VaultCallTarget {
  const scope = new ToolScope(vault, options);
  if (SINGLE_FILE.has(name) || name === 'vault_move') {
    const located = scope.locate(name === 'vault_move' ? args['from'] : args['path'], args['vault']);
    if ('error' in located) {
      return { vault: typeof args['vault'] === 'string' ? args['vault'] : null, path: null };
    }
    const path = name === 'vault_move' ? `${located.path} → ${cleanPath(args['to'])}` : located.path;
    return { vault: located.vault.id, path };
  }
  const folder = cleanPath(args['path']);
  return { vault: typeof args['vault'] === 'string' && args['vault'] !== '' ? args['vault'] : null, path: folder === '' ? null : folder };
}

/** `vault:path`, `vault:` or the path alone, for one audit line. */
export function targetLabel(target: VaultCallTarget): string {
  return target.vault === null ? (target.path ?? 'all vaults') : `${target.vault}:${target.path ?? ''}`;
}
