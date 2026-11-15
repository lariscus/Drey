import { promises as fsp } from 'node:fs';
import type { PersonaJournalRemove, PersonaJournalReply, PersonaMemoryRemove, PersonaMemoryReply } from '../contracts/persona-records';
import { PERSONAS_DIR, personaRef, type Persona } from '../core/persona/persona';
import { JOURNAL_FILE } from '../core/persona/persona-journal';
import { journalFromFriction, parseJournal, withJournalEntries, withoutJournalEntry } from '../core/persona/persona-journal-file';
import { TicketsGit } from '../core/git/tickets-git';
import type { EngineHost, EngineVault } from './host';
import { PersonaCommitAges } from './persona-commit-age';
import { describeMemoryEntries, memoryPathFor, removeMemoryEntry } from './persona-store';

/** The board as the records need it: the vault and the personas. */
export interface PersonaRecordsBoard {
  detect(): Promise<EngineVault | null>;
  loadPersona(vault: EngineVault, id: string): Promise<Persona | null>;
  listPersonaIds(): Promise<readonly string[]>;
}

export interface PersonaRecordsDeps {
  readonly board: PersonaRecordsBoard;
  readonly host: EngineHost;
  readonly git?: TicketsGit;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

type Found = { readonly vault: EngineVault; readonly id: string } | { readonly error: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function journalPathFor(id: string): string {
  return `${PERSONAS_DIR}/${id}/${JOURNAL_FILE}`;
}

function frictionPathFor(id: string): string {
  return `${PERSONAS_DIR}/${id}/friction.md`;
}

/**
 * The Memory tab's writes on the board side (R14, req-169): the journal's
 * read and per-entry removal, the memory's per-line removal (the owner's
 * and the persona's lines alike), and the one-time migration of the
 * retired `friction.md` into `reviews.md` — each one write, one commit.
 * The runner appends journal entries and lessons itself; this service
 * never writes a finding.
 */
export class PersonaRecords {
  private readonly git: TicketsGit;
  private readonly ages: PersonaCommitAges;

  constructor(private readonly deps: PersonaRecordsDeps) {
    this.git = deps.git ?? new TicketsGit(() => 'git');
    this.ages = new PersonaCommitAges(deps.board, this.git);
  }

  /** When each persona's folder was last committed (req-239); the Persona page's `committed 2 days ago`. */
  commitAges(personaIds: readonly string[]): Promise<Readonly<Record<string, string>>> {
    return this.ages.of(personaIds);
  }

  /** The journal, oldest first; a left-over friction.md is migrated first. */
  async journal(personaId: string): Promise<PersonaJournalReply> {
    const found = await this.find(personaId);
    if ('error' in found) {
      return { ok: false, error: found.error };
    }
    await this.migrate(found.vault, found.id);
    const text = await this.read(found.vault, journalPathFor(found.id));
    return { ok: true, entries: parseJournal(text ?? '') };
  }

  async journalRemove(cmd: PersonaJournalRemove): Promise<PersonaJournalReply> {
    const found = await this.find(cmd.persona);
    if ('error' in found) {
      return { ok: false, error: found.error };
    }
    const path = journalPathFor(found.id);
    const updated = withoutJournalEntry((await this.read(found.vault, path)) ?? '', cmd.index, cmd.at);
    if (updated === null) {
      return { ok: false, error: `no journal entry ${cmd.at} at index ${cmd.index} — the journal changed, read it again` };
    }
    await this.writeAndCommit(found.vault, path, updated, `personas: ${found.id} journal entry removed (${cmd.at})`);
    return { ok: true, entries: parseJournal(updated) };
  }

  async memoryRemove(cmd: PersonaMemoryRemove): Promise<PersonaMemoryReply> {
    const found = await this.find(cmd.persona);
    if ('error' in found) {
      return { ok: false, error: found.error };
    }
    const path = memoryPathFor(found.id);
    const updated = removeMemoryEntry((await this.read(found.vault, path)) ?? '', cmd.index, cmd.text);
    if (updated === null) {
      return { ok: false, error: `no memory entry "${cmd.text}" at index ${cmd.index} — the memory changed, read it again` };
    }
    await this.writeAndCommit(found.vault, path, updated, `personas: ${found.id} memory entry removed`);
    return { ok: true, entries: describeMemoryEntries(updated) };
  }

  /** Every persona's friction.md into its journal (the engine's start); the count of personas migrated. */
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

  /**
   * friction.md goes up in the journal (req-169): its readable lines land
   * at the journal's start (older than any run's entry), the file is
   * removed, one logged commit. Absent file = nothing to do.
   */
  private async migrate(vault: EngineVault, id: string): Promise<boolean> {
    const friction = await this.read(vault, frictionPathFor(id));
    if (friction === null) {
      return false;
    }
    try {
      const entries = journalFromFriction(friction, id);
      const journal = journalPathFor(id);
      const touched = [frictionPathFor(id)];
      if (entries.length > 0) {
        await this.deps.host.write(vault.id, journal, withJournalEntries(await this.read(vault, journal), entries, 'start'));
        touched.unshift(journal);
      }
      const abs = this.deps.host.resolveAssetPath(vault.id, frictionPathFor(id));
      if (abs !== null) {
        await fsp.rm(abs, { force: true });
      }
      await this.commit(vault, touched, `personas: ${id} friction.md migrated into ${JOURNAL_FILE} (${entries.length} lines)`);
      this.deps.host.announceChanges(vault.id, entries.length > 0 ? [journal] : [], [frictionPathFor(id)]);
      this.deps.log(`persona ${id}: friction.md migrated into ${JOURNAL_FILE} (${entries.length} lines)`);
      return true;
    } catch (error) {
      this.deps.log(`persona ${id}: the friction.md migration failed — ${messageOf(error)}`, 'warn');
      return false;
    }
  }

  private async find(personaId: string): Promise<Found> {
    let id: string;
    try {
      id = personaRef(personaId);
    } catch (error) {
      return { error: messageOf(error) };
    }
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return { error: 'no tickets vault detected' };
    }
    if ((await this.deps.board.loadPersona(vault, id)) === null) {
      return { error: `persona "${id}" does not exist — create tickets/_meta/personas/${id}/persona.md first` };
    }
    return { vault, id };
  }

  private read(vault: EngineVault, path: string): Promise<string | null> {
    return this.deps.host.read(vault.id, path).catch(() => null);
  }

  private async writeAndCommit(vault: EngineVault, path: string, text: string, message: string): Promise<void> {
    await this.deps.host.write(vault.id, path, text);
    await this.commit(vault, [path], message);
    this.deps.host.announceChanges(vault.id, [path]);
  }

  /** One commit of exactly these paths, removals staged too; a failure logs, never throws. */
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
