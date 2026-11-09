import { PERSONAS_DIR } from '../core/persona';
import { proseMigrationOf } from '../core/persona-prose';
import { TicketsGit } from '../core/tickets-git';
import type { EngineHost, EngineVault } from './host';
import type { PersonaRecordsBoard } from './persona-records';

export interface PersonaProseMigratorDeps {
  readonly board: PersonaRecordsBoard;
  readonly host: EngineHost;
  readonly git?: TicketsGit;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The one-time move of R11 (req-171): the prose below a `persona.md` fence
 * goes to the top of the persona's `prompt.md`, one logged commit per
 * persona; the engine's old placeholder sentence is dropped. Idempotent — a
 * `persona.md` without a body is skipped, so every start can run it.
 */
export class PersonaProseMigrator {
  private readonly git: TicketsGit;

  constructor(private readonly deps: PersonaProseMigratorDeps) {
    this.git = deps.git ?? new TicketsGit(() => 'git');
  }

  /** Every persona of the tickets vault; the count of personas whose files changed. */
  async migrateAll(): Promise<number> {
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return 0;
    }
    let migrated = 0;
    for (const id of await this.deps.board.listPersonaIds()) {
      migrated += (await this.migrate(vault, id)) ? 1 : 0;
    }
    return migrated;
  }

  private async migrate(vault: EngineVault, id: string): Promise<boolean> {
    const personaPath = `${PERSONAS_DIR}/${id}/persona.md`;
    const promptPath = `${PERSONAS_DIR}/${id}/prompt.md`;
    try {
      const personaText = await this.read(vault, personaPath);
      const migration = personaText === null ? null : proseMigrationOf(id, personaText, await this.read(vault, promptPath));
      if (migration === null) {
        return false;
      }
      const touched = [personaPath];
      if (migration.prompt !== null) {
        await this.deps.host.write(vault.id, promptPath, migration.prompt);
        touched.push(promptPath);
      }
      await this.deps.host.write(vault.id, personaPath, migration.persona);
      await this.commit(vault, touched, `personas: ${id} prose moves from persona.md into prompt.md (req-171)`);
      this.deps.host.announceChanges(vault.id, touched);
      this.deps.log(`persona ${id}: persona.md prose moved into prompt.md (${migration.lines} lines)`);
      return true;
    } catch (error) {
      this.deps.log(`persona ${id}: the prose migration failed — ${messageOf(error)}`, 'warn');
      return false;
    }
  }

  private read(vault: EngineVault, path: string): Promise<string | null> {
    return this.deps.host.read(vault.id, path).catch(() => null);
  }

  /** One commit of exactly these paths; a failure logs, never throws. */
  private async commit(vault: EngineVault, vaultRelPaths: readonly string[], message: string): Promise<void> {
    const location = await this.git.locate(vault.path).catch(() => null);
    if (location === null) {
      return;
    }
    const paths = vaultRelPaths.map((p) => `${location.prefix}${p}`);
    try {
      await this.git.commitTree(location.root, paths, message);
    } catch (error) {
      await this.git.commitPaths(location.root, paths, message).catch(() => this.deps.log(`git commit failed: ${messageOf(error)}`, 'warn'));
    }
  }
}
