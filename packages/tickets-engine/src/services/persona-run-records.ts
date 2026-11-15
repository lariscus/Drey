import * as path from 'node:path';
import type { ClosingRoundWrite, ClosingRoundWritten, RoundProposalWrite, RunJournalWrite, RunMemoryWrite, RunRecordReply } from '../contracts/persona-run-records';
import { holdsLesson, personaLessonLine } from '../core/persona/memory-line';
import { PERSONAS_DIR, personaRef, type Persona } from '../core/persona/persona';
import { JOURNAL_FILE, renderJournalEntry, RUN_JOURNAL_NOTE, type JournalEntry } from '../core/persona/persona-journal';
import { withJournalEntries, withRoundEntry } from '../core/persona/persona-journal-file';
import { withRoundProposal } from '../core/pipeline/round-proposal';
import type { TicketsGit } from '../core/git/tickets-git';
import type { EngineHost, EngineVault } from './host';
import { appendMemory, memoryPathFor } from './persona-store';

/** The board as the run's records need it: the vault and the personas. */
export interface PersonaRunRecordsBoard {
  detect(): Promise<EngineVault | null>;
  loadPersona(vault: EngineVault, id: string): Promise<Persona | null>;
}

export interface PersonaRunRecordsDeps {
  readonly board: PersonaRunRecordsBoard;
  readonly host: Pick<EngineHost, 'read' | 'write' | 'announceChanges' | 'log'>;
  /** The engine's one `TicketsGit`: its queue per repository serializes these commits with every other. */
  readonly git: Pick<TicketsGit, 'locate' | 'commitPaths'>;
  readonly now?: () => Date;
}

type Found = { readonly vault: EngineVault; readonly id: string } | { readonly error: string; readonly foreign?: true };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const isTicketId = (id: string): boolean => /^T-\d{4,}$/.test(id);
const journalPathOf = (id: string): string => `${PERSONAS_DIR}/${id}/${JOURNAL_FILE}`;
const sameFolder = (a: string, b: string): boolean => {
  const norm = (p: string): string => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

/**
 * The runs' writes into their persona's records (req-225, req-226), on the
 * engine side — the one writer of the tickets repository: a closing round's
 * journal entry, lesson and proposal as ONE commit `personas: <id> closing
 * round <ticket>`, and the worker's own `memory_write` / `journal_write`
 * during the run, one commit each. The runner and Drey Service's vault MCP
 * reach it over the invoke channel; writes run one at a time.
 */
export class PersonaRunRecords {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PersonaRunRecordsDeps) {}

  closingRound(write: ClosingRoundWrite): Promise<ClosingRoundWritten> {
    return this.serial(() => this.writeRound(write));
  }

  memoryWrite(write: RunMemoryWrite): Promise<RunRecordReply> {
    return this.serial(() => this.writeMemory(write));
  }

  journalWrite(write: RunJournalWrite): Promise<RunRecordReply> {
    return this.serial(() => this.writeJournal(write));
  }

  private async writeRound(write: ClosingRoundWrite): Promise<ClosingRoundWritten> {
    const found = await this.find(write.persona, write.vaultPath);
    if ('error' in found) {
      return { ok: false, error: found.error, ...(found.foreign === true ? { foreign: true as const } : {}) };
    }
    const { vault, id } = found;
    const journal = journalPathOf(id);
    await this.deps.host.write(vault.id, journal, withRoundEntry(await this.read(vault, journal), write.journal, write.runStartedAt));
    const touched = [journal];
    const lesson = write.lesson === null ? null : await this.appendLesson(found, write.lesson);
    if (lesson !== null) {
      touched.push(memoryPathFor(id));
    }
    const proposal = write.proposal === null ? null : await this.addProposal(found, write.proposal);
    if (proposal !== null) {
      touched.push(`${PERSONAS_DIR}/${id}/improvements.md`);
    }
    const warning = await this.commit(vault, touched, `personas: ${id} closing round ${write.ticket ?? 'run'}`);
    return { ok: true, lesson, proposal, ...(warning === null ? {} : { warning }) };
  }

  private async writeMemory(write: RunMemoryWrite): Promise<RunRecordReply> {
    const found = await this.find(write.persona, null);
    if ('error' in found) {
      return { ok: false, error: found.error };
    }
    const ticket = isTicketId(write.ticket) ? write.ticket : null;
    const line = personaLessonLine({ date: this.now().toISOString().slice(0, 10), ticket, persona: found.id, model: write.model, lesson: write.lesson });
    if ((await this.appendLesson(found, line)) === null) {
      return { ok: false, error: 'your memory already holds this lesson — nothing was written' };
    }
    const warning = await this.commit(found.vault, [memoryPathFor(found.id)], `personas: ${found.id} memory +1 (${ticket ?? 'run'})`);
    return { ok: true, line, ...(warning === null ? {} : { warning }) };
  }

  private async writeJournal(write: RunJournalWrite): Promise<RunRecordReply> {
    const found = await this.find(write.persona, null);
    if ('error' in found) {
      return { ok: false, error: found.error };
    }
    const ticket = isTicketId(write.ticket) ? write.ticket : null;
    const entry: JournalEntry = {
      at: this.now().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      ticket,
      persona: found.id,
      harness: write.harness,
      model: write.model,
      gate: 'none',
      costUsd: null,
      signals: [],
      friction: write.note,
      finding: null,
      note: RUN_JOURNAL_NOTE,
    };
    const journal = journalPathOf(found.id);
    await this.deps.host.write(found.vault.id, journal, withJournalEntries(await this.read(found.vault, journal), [entry]));
    const warning = await this.commit(found.vault, [journal], `personas: ${found.id} journal +1 (${ticket ?? 'run'})`);
    return { ok: true, line: renderJournalEntry(entry).join('\n'), ...(warning === null ? {} : { warning }) };
  }

  /** The line as written; null when the memory already holds the same lesson of this persona. */
  private async appendLesson(found: { vault: EngineVault; id: string }, line: string): Promise<string | null> {
    if (holdsLesson((await this.read(found.vault, memoryPathFor(found.id))) ?? '', line)) {
      return null;
    }
    const { host } = this.deps;
    await appendMemory((rel) => host.read(found.vault.id, rel), (rel, text) => host.write(found.vault.id, rel, text), found.id, line);
    return line;
  }

  /** The minted id; null (logged) when the proposal's edits do not apply. */
  private async addProposal(found: { vault: EngineVault; id: string }, proposal: RoundProposalWrite): Promise<string | null> {
    const folder = `${PERSONAS_DIR}/${found.id}`;
    const prompt = proposal.target === 'prompt.md' ? await this.read(found.vault, `${folder}/prompt.md`) : null;
    const written = withRoundProposal(await this.read(found.vault, `${folder}/improvements.md`), prompt, { persona: found.id, ...proposal, at: this.now().toISOString() });
    if (!written.ok) {
      this.deps.host.log(`persona ${found.id}: closing-round proposal dropped — ${written.error}`, 'warn');
      return null;
    }
    await this.deps.host.write(found.vault.id, `${folder}/improvements.md`, written.text);
    return written.id;
  }

  /** The persona in the engine's tickets vault; `vaultPath` (when given) must be that vault. */
  private async find(personaId: string, vaultPath: string | null): Promise<Found> {
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
    if (vaultPath !== null && !sameFolder(vaultPath, vault.path)) {
      return { error: `the run's tickets vault ${vaultPath} is not the engine's (${vault.path})`, foreign: true };
    }
    if ((await this.deps.board.loadPersona(vault, id)) === null) {
      return { error: `persona "${id}" does not exist` };
    }
    return { vault, id };
  }

  private read(vault: EngineVault, rel: string): Promise<string | null> {
    return this.deps.host.read(vault.id, rel).catch(() => null);
  }

  /** One commit of exactly these paths, then the vault's change round; a warning line instead of a failure. */
  private async commit(vault: EngineVault, vaultRelPaths: readonly string[], message: string): Promise<string | null> {
    this.deps.host.announceChanges(vault.id, vaultRelPaths);
    const location = await this.deps.git.locate(vault.path).catch(() => null);
    if (location === null) {
      return 'the tickets vault is not a git repository — the change is not versioned';
    }
    try {
      await this.deps.git.commitPaths(location.root, vaultRelPaths.map((p) => `${location.prefix}${p}`), message);
      return null;
    } catch (error) {
      this.deps.host.log(`git commit failed: ${messageOf(error)}`, 'warn');
      return `git commit failed: ${messageOf(error).split('\n')[0]}`;
    }
  }

  private now(): Date {
    return (this.deps.now ?? ((): Date => new Date()))();
  }

  /** One write at a time: two rounds of one persona never read the same file state. A failed write is a reply, never a rejection. */
  private serial<T>(work: () => Promise<T>): Promise<T | { ok: false; error: string }> {
    const result = this.queue.then(work).catch((error: unknown) => ({ ok: false as const, error: `the write failed: ${messageOf(error)}` }));
    this.queue = result;
    return result;
  }
}
