/**
 * The registered vaults as the shared vault tool set sees them (req-167,
 * ADR-0094): `ToolVault` and the link rewriter's `RenameVault` over the files
 * on disk — the service's counterpart of Drey's `VaultManager`. Every path
 * passes the Notes API's rule (`core/note-path.ts`: no `tickets/`, no
 * `chats/`, no dot-folder, nothing outside the vault, links resolved), so the
 * tickets repository is reached by no vault tool. One instance serves one
 * call over the vaults as they were registered when it began.
 */
import type { VaultFileEntry, VaultStatus } from '../../../../../shared/ipc-api';
import type { RenameVault } from '../../../../../shared/link-rewriter';
import type { ToolVault } from '../../../../../shared/vault-tools';
import type { RegisteredVault } from '../../contracts/vaults';
import { isServedChild, isServedPath } from '../../core/note-path';
import type { VaultDisk } from './vault-disk';

/** A registered vault and whether its folder exists right now. */
export interface VaultSite extends RegisteredVault {
  readonly exists: boolean;
}

const baseOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

export class DiskToolVault implements ToolVault, RenameVault {
  constructor(
    private readonly sites: readonly VaultSite[],
    private readonly disk: VaultDisk,
  ) {}

  listVaults(): VaultStatus[] {
    return this.sites.map((site) => ({ id: site.id, name: site.name, path: site.path, exists: site.exists, active: site.id === this.getActiveVaultId() }));
  }

  getActiveVaultId(): string | null {
    const live = this.sites.filter((site) => site.exists);
    return (live.find((site) => site.active) ?? live[0])?.id ?? null;
  }

  async listFiles(vaultId?: string): Promise<VaultFileEntry[]> {
    const site = this.site(vaultId);
    return this.tree(site.path, '');
  }

  async listMarkdownFiles(vaultId?: string): Promise<string[]> {
    const out: string[] = [];
    const walk = (entries: readonly VaultFileEntry[]): void =>
      entries.forEach((e) => (e.type === 'directory' ? walk(e.children ?? []) : /\.md$/i.test(e.relativePath) && out.push(e.relativePath)));
    walk(await this.listFiles(vaultId));
    return out.sort();
  }

  async readFile(relativePath: string, vaultId?: string): Promise<{ content: string; modifiedMs: number }> {
    const abs = await this.resolve(relativePath, vaultId);
    const content = await this.disk.readText(abs);
    return { content, modifiedMs: (await this.disk.mtimeOf(abs)) ?? 0 };
  }

  async writeFile(relativePath: string, content: string, vaultId?: string): Promise<number> {
    const abs = await this.resolve(relativePath, vaultId);
    await this.disk.writeText(abs, content);
    return (await this.disk.mtimeOf(abs)) ?? 0;
  }

  /** Never offered to a worker (R5); the shared set refuses the call before it gets here. */
  deleteEntry(): Promise<{ trashed: boolean }> {
    return Promise.reject(new Error('deleting is not offered by the service'));
  }

  async renameEntry(fromRel: string, toRel: string, fromVaultId?: string, toVaultId?: string): Promise<string> {
    if ((toVaultId ?? fromVaultId) !== fromVaultId) {
      throw new Error('a move stays inside one vault');
    }
    await this.disk.rename(await this.resolve(fromRel, fromVaultId), await this.resolve(toRel, fromVaultId));
    return toRel;
  }

  async removeDirIfEmpty(relativePath: string, vaultId?: string): Promise<void> {
    if (relativePath !== '') {
      await this.disk.removeDirIfEmpty(await this.resolve(relativePath, vaultId));
    }
  }

  async copyEntry(srcRel: string, destDirRel: string, srcVaultId?: string, destVaultId?: string): Promise<string> {
    const target = destDirRel === '' ? baseOf(srcRel) : `${destDirRel}/${baseOf(srcRel)}`;
    await this.disk.copy(await this.resolve(srcRel, srcVaultId), await this.resolve(target, destVaultId ?? srcVaultId));
    return target;
  }

  /** The file's modification time now; null when it is missing or out of reach. */
  async mtimeOf(relativePath: string, vaultId: string): Promise<number | null> {
    return this.resolve(relativePath, vaultId).then((abs) => this.disk.mtimeOf(abs), () => null);
  }

  private site(vaultId: string | undefined): VaultSite {
    const id = vaultId ?? this.getActiveVaultId();
    const site = this.sites.find((entry) => entry.id === id && entry.exists);
    if (site === undefined) {
      throw new Error(`there is no vault "${id ?? ''}" here`);
    }
    return site;
  }

  /** The absolute path of a served vault path; rejects anything the rule keeps out. */
  private async resolve(rel: string, vaultId: string | undefined): Promise<string> {
    const site = this.site(vaultId);
    if (rel === '' || !isServedPath(rel) || !(await this.disk.staysServed(site.path, rel))) {
      throw new Error(`"${rel}" is out of reach — tickets/, chats/ and dot-folders are not served`);
    }
    return this.disk.join(site.path, rel);
  }

  private async tree(root: string, folder: string): Promise<VaultFileEntry[]> {
    const out: VaultFileEntry[] = [];
    const entries = await this.disk.list(folder === '' ? root : this.disk.join(root, folder));
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = folder === '' ? entry.name : `${folder}/${entry.name}`;
      if (!isServedChild(folder, entry.name) || entry.kind === 'other') {
        continue;
      }
      out.push(entry.kind === 'dir' ? { name: entry.name, relativePath: rel, type: 'directory', children: await this.tree(root, rel) } : { name: entry.name, relativePath: rel, type: 'file' });
    }
    return out;
  }
}

