/**
 * The registered vaults as Pia's read tools see them (req-315): the shared
 * vault tool set (`shared/vault-tools`, ADR-0071 — the one implementation)
 * over the host's registry. Read-only by construction: the write methods
 * refuse, and the toolset is built with `write: 'off'`, so no write tool is
 * offered or runs. A path that leaves a vault is refused by the host's own
 * resolution, like every host read.
 */
import type { VaultFileEntry, VaultStatus } from '../../../../shared/ipc-api';
import type { RenameVault } from '../../../../shared/link-rewriter';
import type { ToolVault } from '../../../../shared/vault-tools';
import type { EngineHost, EngineVault } from './host';

export class HostToolVault implements ToolVault, RenameVault {
  /** The registry as of the last {@link refresh} — the scope reads it synchronously. */
  private sites: readonly EngineVault[] = [];

  constructor(private readonly host: Pick<EngineHost, 'listVaults' | 'read' | 'listMarkdownFiles'>) {}

  /** Re-reads the registry; called before every tool round, so a vault Drey registered mid-turn joins on the next one. */
  async refresh(): Promise<void> {
    const all = await this.host.listVaults().catch(() => [] as readonly EngineVault[]);
    this.sites = all.filter((vault) => vault.exists);
  }

  listVaults(): VaultStatus[] {
    return this.sites.map((vault) => ({ id: vault.id, name: vault.name, path: vault.path, exists: true, active: vault.active }));
  }

  getActiveVaultId(): string | null {
    return (this.sites.find((vault) => vault.active) ?? this.sites[0])?.id ?? null;
  }

  async listFiles(vaultId?: string): Promise<VaultFileEntry[]> {
    const id = vaultId ?? this.getActiveVaultId();
    if (id === null) {
      return [];
    }
    const files = await this.host.listMarkdownFiles(id).catch(() => [] as readonly string[]);
    return files.map((relativePath) => ({ name: relativePath.slice(relativePath.lastIndexOf('/') + 1), relativePath, type: 'file' as const }));
  }

  /** The flat markdown list `vault_search` scans (DiskToolVault carries the same extra). */
  async listMarkdownFiles(vaultId?: string): Promise<string[]> {
    const id = vaultId ?? this.getActiveVaultId();
    if (id === null) {
      return [];
    }
    const files = await this.host.listMarkdownFiles(id).catch(() => [] as readonly string[]);
    return [...files];
  }

  async readFile(relativePath: string, vaultId?: string): Promise<{ content: string; modifiedMs: number }> {
    const id = vaultId ?? this.getActiveVaultId();
    if (id === null) {
      throw new Error('no vault is registered');
    }
    return { content: await this.host.read(id, relativePath), modifiedMs: 0 };
  }

  writeFile(): Promise<number> {
    return Promise.reject(new Error('Pia does not write notes'));
  }

  deleteEntry(): Promise<{ trashed: boolean }> {
    return Promise.reject(new Error('Pia does not delete notes'));
  }

  renameEntry(): Promise<string> {
    return Promise.reject(new Error('Pia does not move notes'));
  }

  removeDirIfEmpty(): Promise<void> {
    return Promise.reject(new Error('Pia does not move notes'));
  }

  copyEntry(): Promise<string> {
    return Promise.reject(new Error('Pia does not move notes'));
  }
}
