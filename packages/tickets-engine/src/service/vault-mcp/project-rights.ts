/**
 * A worker's vault rights (req-283, concept §3 — the owner's "Ja beide";
 * ADR-0094 later change, superseding req-167's persona list): it reads the
 * vaults and plain folders its project gives, and writes a vault only where
 * all three hold — the project says Write, its persona has `allowed:
 * write-notes`, and the run is not read-only (a review, a 1:1). Read at every
 * call, so a change to a project or a persona applies to the next call. No
 * project, an unknown one or an unreadable board: no vault. A move is a
 * write right; a plain folder is never written.
 */
import type { VaultWriteGrant } from '../../../../../shared/vault-tools';
import type { ProjectRecord } from '../../contracts/projects';
import type { VaultScope } from '../../fleet/orchestrate/worker-vault';
import type { VaultSite } from './disk-tool-vault';
import { folderSiteIds, projectAccess, reachedVaults, writableVaults } from './project-reach';
import type { VaultDisk } from './vault-disk';

/** Where the rights are read: the board's project records and personas. */
export interface RightsSource {
  /** The board's project records; rejects when the board cannot be read. */
  projects(): Promise<readonly ProjectRecord[]>;
  /** The persona's `allowed: write-notes`; false for an unknown persona. */
  writesNotes(personaId: string): Promise<boolean>;
}

/** Whose rights: the token's grant. */
export interface RightsHolder {
  readonly persona: string | null;
  readonly readOnly: boolean;
  readonly scope: VaultScope;
}

/** What one call reaches: the vaults and folders as sites, and the vaults it may change. */
export interface VaultReach {
  readonly sites: readonly VaultSite[];
  readonly grant: VaultWriteGrant;
}

export class ProjectRights {
  constructor(
    private readonly source: RightsSource,
    private readonly disk: Pick<VaultDisk, 'isFolder'>,
  ) {}

  async reachOf(holder: RightsHolder, registered: readonly VaultSite[]): Promise<VaultReach> {
    const who = holder.persona ?? 'this run';
    const projects = await this.source.projects().catch(() => [] as readonly ProjectRecord[]);
    const access = projectAccess(holder.scope, projects);
    const vaults = reachedVaults(access, registered);
    const ids = folderSiteIds(access.folders, registered.map((site) => site.id));
    const folders = await Promise.all(
      access.folders.map(async (folder, i): Promise<VaultSite> => ({ id: ids[i]!, name: folder, path: folder, active: false, exists: await this.disk.isFolder(folder) })),
    );
    const writes = holder.scope.kind === 'project' && !holder.readOnly && (await this.writesNotes(holder.persona));
    return { sites: [...vaults, ...folders], grant: { who, vaults: writes ? writableVaults(access, vaults) : [] } };
  }

  private async writesNotes(persona: string | null): Promise<boolean> {
    return persona === null ? false : this.source.writesNotes(persona).catch(() => false);
  }
}
