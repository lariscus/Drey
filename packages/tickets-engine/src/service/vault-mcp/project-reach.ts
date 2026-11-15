/**
 * What a worker's token reaches (req-283, concept §2, §3, §10; ADR-0094
 * later change): the vaults and plain folders its project gives — by the
 * vault's registered NAME (ids are minted per device) — and which of those
 * vaults it may write. A ticket run and a free session take one project; a
 * 1:1 the union of every project's vaults and folders, read-only. A vault no
 * project in scope names is not reached; a plain folder is never written.
 * Pure: the records, the registered vaults and the folders' existence come in.
 */
import type { ProjectRecord } from '../../contracts/projects';
import type { VaultScope } from '../../fleet/runner/worker-vault';
import type { VaultSite } from './disk-tool-vault';

/** The vaults and folders one scope names: vault name → may it be written, and the folders as written. */
export interface ProjectAccess {
  readonly vaults: ReadonlyMap<string, boolean>;
  readonly folders: readonly string[];
}

const NOTHING: ProjectAccess = { vaults: new Map(), folders: [] };

/** A folder path written the way two spellings of one folder compare equal. */
function folderKey(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** A folder Drey can serve: an absolute path (a drive letter or a POSIX root); anything else names nothing. */
export function isAbsoluteFolder(path: string): boolean {
  return /^([a-zA-Z]:[\\/]|\/)/.test(path.trim());
}

/** What the scope's projects give. `write` is the project's word only — the persona and the run decide the rest. */
export function projectAccess(scope: VaultScope, projects: readonly ProjectRecord[]): ProjectAccess {
  const named = scope.kind === 'every-project' ? projects : projects.filter((p) => p.id === scope.project);
  if (named.length === 0) {
    return NOTHING;
  }
  const vaults = new Map<string, boolean>();
  const folders = new Map<string, string>();
  for (const project of named) {
    for (const [name, access] of Object.entries(project.vaults)) {
      if (access !== 'none') {
        vaults.set(name, (vaults.get(name) ?? false) || access === 'write');
      }
    }
    project.folders.filter(isAbsoluteFolder).forEach((folder) => folders.set(folderKey(folder), folder.trim()));
  }
  return { vaults, folders: [...folders.values()] };
}

/** The registered vaults the access names, in registry order. */
export function reachedVaults(access: ProjectAccess, registered: readonly VaultSite[]): VaultSite[] {
  return registered.filter((site) => access.vaults.has(site.name));
}

/** The ids of the reached vaults the project lets its runs write. */
export function writableVaults(access: ProjectAccess, reached: readonly VaultSite[]): string[] {
  return reached.filter((site) => access.vaults.get(site.name) === true).map((site) => site.id);
}

/** `folder-<last segment>`, made unique against the ids already taken — no colon, so `id:path` labels still parse. */
export function folderSiteIds(folders: readonly string[], taken: readonly string[]): string[] {
  const used = new Set(taken);
  return folders.map((folder) => {
    const last = folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
    const base = `folder-${last.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root'}`;
    let id = base;
    for (let n = 2; used.has(id); n++) {
      id = `${base}-${n}`;
    }
    used.add(id);
    return id;
  });
}
