import { splitFrontmatter } from '../../../../shared/frontmatter';
import { parsePersonaFile, personaFileText, PERSONAS_DIR, type Persona } from '../core/persona/persona';
import { migratedModelOf, shippedClassRank, type MigrationClassTable } from '../core/persona/persona-model-migration';
import { TicketsGit } from '../core/git/tickets-git';
import type { ModelRow } from '../fleet/protocol';
import type { EngineHost, EngineVault } from './host';
import type { PersonaRecordsBoard } from './persona-records';
import type { ModelTablePort } from './service-model-table';

/** The commit message of the migration's one commit. */
export const PERSONA_MODEL_MIGRATION_COMMIT = 'personas: class and model replace worker and models (req-288)';

export interface PersonaModelMigratorDeps {
  readonly board: Pick<PersonaRecordsBoard, 'detect' | 'listPersonaIds'>;
  readonly host: Pick<EngineHost, 'read' | 'write' | 'announceChanges'>;
  /** The machine's model table (`service.json`): the class of each old default. */
  readonly table: ModelTablePort;
  readonly git?: Pick<TicketsGit, 'locate' | 'commitPaths'>;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

/** One record the migration rewrites: its path and the new text. */
interface Rewrite {
  readonly id: string;
  readonly path: string;
  readonly text: string;
  readonly why: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The table as the rule reads it: a model's class by its first row (on the named harness when the entry names one). */
function classTableOf(rows: readonly ModelRow[]): MigrationClassTable {
  return {
    classOf: (provider, model) => rows.find((row) => row.model === model && (provider === null || row.provider === provider))?.class ?? null,
    rank: shippedClassRank,
  };
}

/**
 * The one-time move onto Persona v3 (req-288): every agent record that still
 * names `worker:` / `models:` (and maybe `min-class:`) instead of `class:`
 * gets the class of its old default — the model table's row, the floor
 * folded in — and the old default pinned only when its pool held that one
 * model ({@link migratedModelOf}). One logged commit for every record it
 * rewrites. Idempotent: a record that names a `class:` is skipped, so every
 * start can run it.
 */
export class PersonaModelMigrator {
  private readonly git: Pick<TicketsGit, 'locate' | 'commitPaths'>;

  constructor(private readonly deps: PersonaModelMigratorDeps) {
    this.git = deps.git ?? new TicketsGit(() => 'git');
  }

  /** The ids it rewrote; [] when every record is migrated already. */
  async migrateAll(): Promise<readonly string[]> {
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return [];
    }
    const table = classTableOf((await this.deps.table.rows().catch(() => null)) ?? []);
    const rewrites: Rewrite[] = [];
    for (const id of await this.deps.board.listPersonaIds()) {
      const rewrite = await this.rewriteOf(vault, id, table);
      if (rewrite !== null) {
        rewrites.push(rewrite);
      }
    }
    if (rewrites.length === 0) {
      return [];
    }
    for (const rewrite of rewrites) {
      await this.deps.host.write(vault.id, rewrite.path, rewrite.text);
      this.deps.log(`persona ${rewrite.id}: ${rewrite.why} (req-288)`);
    }
    const paths = rewrites.map((rewrite) => rewrite.path);
    await this.commit(vault, paths);
    this.deps.host.announceChanges(vault.id, paths);
    return rewrites.map((rewrite) => rewrite.id);
  }

  private async rewriteOf(vault: EngineVault, id: string, table: MigrationClassTable): Promise<Rewrite | null> {
    const path = `${PERSONAS_DIR}/${id}/persona.md`;
    try {
      const text = await this.deps.host.read(vault.id, path).catch(() => null);
      const persona = text === null ? null : parsePersonaFile(id, text);
      if (text === null || persona === null || persona.kind !== 'agent' || persona.class !== null || persona.legacy === undefined) {
        return null;
      }
      const migrated = migratedModelOf(persona.legacy, table);
      const { legacy: _legacy, ...rest } = persona;
      const next: Persona = { ...rest, class: migrated.class, model: migrated.model };
      const { body, hadFence } = splitFrontmatter(text);
      return { id, path, text: personaFileText(next, hadFence ? body : undefined), why: migrated.why };
    } catch (error) {
      this.deps.log(`persona ${id}: the class migration failed — ${messageOf(error)}`, 'warn');
      return null;
    }
  }

  /** One commit of exactly these paths; a vault outside git keeps the write unversioned, a failed commit logs. */
  private async commit(vault: EngineVault, vaultRelPaths: readonly string[]): Promise<void> {
    const location = await this.git.locate(vault.path).catch(() => null);
    if (location === null) {
      return;
    }
    await this.git.commitPaths(location.root, vaultRelPaths.map((p) => `${location.prefix}${p}`), PERSONA_MODEL_MIGRATION_COMMIT).catch((error: unknown) => this.deps.log(`git commit failed: ${messageOf(error)}`, 'warn'));
  }
}
