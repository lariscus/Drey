/**
 * The first project of a board (req-282, the concept's §6): a board without
 * `_meta/projects/` gets one project holding every `repos.md` entry and every
 * registered vault as `read` — exactly what a worker could reach before,
 * now visible. Each persona's `allowed: write-vaults` (device ids) becomes
 * Write on that project for the vaults this device can resolve, plus
 * `allowed: write-notes: true` on the persona; an id this device does not
 * know is reported, never guessed. Tickets are not rewritten: one project
 * makes every ticket without `project:` read as it. Pure — the IO is
 * `services/project-migrator.ts`.
 */
import type { ProjectRecord, ProjectVaultAccess } from '../../contracts/projects';
import type { RegisteredVault } from '../../contracts/vaults';
import { projectIdOf } from './project-record';

/** The first project's colour: the first preset of Settings → Projects (board 7m). */
export const FIRST_PROJECT_COLOR = '#8ecbef';

export interface ProjectMigrationInput {
  /** The names of `repos.md`, in file order (the first is the project's primary). */
  readonly repos: readonly string[];
  /** The vaults this device has registered (the engine key `vaults.registered`). */
  readonly vaults: readonly RegisteredVault[];
  /** Each persona's `allowed: write-vaults` ids; a persona without the key need not be listed. */
  readonly personas: readonly { readonly id: string; readonly writeVaults: readonly string[] }[];
  /** The name when `repos.md` names no repo: the tickets vault's name. */
  readonly fallbackName: string;
}

/** A persona's `write-vaults` id this device has not registered. */
export interface UnresolvedVaultId {
  readonly persona: string;
  readonly vaultId: string;
}

export interface ProjectMigrationPlan {
  readonly project: ProjectRecord;
  /** The personas that get `allowed: write-notes: true` (every one that named a vault, resolvable or not). */
  readonly writeNotes: readonly string[];
  readonly unresolved: readonly UnresolvedVaultId[];
}

/** The project's name: the board's first repository, else the tickets vault's name. */
function firstName(input: ProjectMigrationInput): string {
  const name = input.repos[0] ?? input.fallbackName;
  return name.trim() === '' ? 'Project' : name.trim();
}

/** The registered vaults by name, each `read`; then a persona's resolvable ids lift theirs to `write`. */
function vaultGrants(input: ProjectMigrationInput, unresolved: UnresolvedVaultId[]): Record<string, ProjectVaultAccess> {
  const vaults: Record<string, ProjectVaultAccess> = {};
  for (const vault of input.vaults) {
    vaults[vault.name] = 'read';
  }
  for (const persona of input.personas) {
    for (const id of persona.writeVaults) {
      const vault = input.vaults.find((v) => v.id === id) ?? null;
      if (vault === null) {
        unresolved.push({ persona: persona.id, vaultId: id });
      } else {
        vaults[vault.name] = 'write';
      }
    }
  }
  return vaults;
}

export function planProjectMigration(input: ProjectMigrationInput): ProjectMigrationPlan {
  const name = firstName(input);
  const unresolved: UnresolvedVaultId[] = [];
  const vaults = vaultGrants(input, unresolved);
  const id = projectIdOf(name);
  return {
    project: { id: id === '' ? 'project' : id, name, color: FIRST_PROJECT_COLOR, repos: [...new Set(input.repos)], folders: [], vaults, purpose: '' },
    writeNotes: input.personas.filter((p) => p.writeVaults.length > 0).map((p) => p.id),
    unresolved,
  };
}
