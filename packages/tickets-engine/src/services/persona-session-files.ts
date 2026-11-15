import { promises as fsp } from 'node:fs';
import type { PersonaSessionFile } from '../contracts/persona-session';
import { CHAT_DIR, chatFileName, decideProposal } from '../core/chat/chat-session';
import type { Persona } from '../core/persona/persona';
import { appendPersonaAnswer, appendPersonaOwner, appendPersonaProposal, migrateThread, newPersonaSessionText, personaSessionTitle } from '../core/persona/persona-session-file';
import { extractProposals, parsePersonaSession } from '../core/persona/persona-session-parse';
import { threadPathFor } from '../core/persona/persona-thread';
import { TicketsGit } from '../core/git/tickets-git';
import type { EngineHost, EngineVault } from './host';

export interface PersonaSessionFilesDeps {
  readonly host: EngineHost;
  readonly git?: TicketsGit;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
  readonly now?: () => Date;
}

/** One session file as read: its path, its text, its parse. */
export interface OpenSession {
  readonly file: string;
  readonly text: string;
  readonly session: PersonaSessionFile;
}

const SESSION_FILE = new RegExp(`^${CHAT_DIR}/[^/]+\\.md$`);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The persona 1:1's session files (req-168, ADR-0093, R3): the newest
 * chat session file with the persona's `persona:` key is its 1:1; the
 * first one is created with `thread.md`'s lines migrated into it (once —
 * the thread file goes in the same commit). Every round is one write and
 * one commit, like a Mission Control session's.
 */
export class PersonaSessionFiles {
  private readonly git: TicketsGit;

  constructor(private readonly deps: PersonaSessionFilesDeps) {
    this.git = deps.git ?? new TicketsGit(() => 'git');
  }

  /** The persona's current 1:1 session; null while it has none. */
  async current(vault: EngineVault, persona: string): Promise<OpenSession | null> {
    const files = (await this.deps.host.listMarkdownFiles(vault.id)).filter((f) => SESSION_FILE.test(f)).sort().reverse();
    for (const file of files) {
      const text = await this.deps.host.read(vault.id, file).catch(() => null);
      const session = text === null ? null : parsePersonaSession(text, file);
      if (session !== null && session.persona === persona) {
        return { file, text: text!, session };
      }
    }
    return null;
  }

  /** The current session, or the first one — `thread.md` migrated into it once. */
  async open(vault: EngineVault, persona: Persona): Promise<OpenSession> {
    const found = await this.current(vault, persona.id);
    return found ?? this.create(vault, persona);
  }

  /** The owner's line: one write, one commit. */
  appendOwner(vault: EngineVault, open: OpenSession, message: string): Promise<OpenSession> {
    return this.write(vault, open.file, appendPersonaOwner(open.text, this.now(), message));
  }

  /** The persona's answer, its proposal blocks turned into pending cards: one write, one commit. */
  async appendAnswer(vault: EngineVault, file: string, answer: string): Promise<OpenSession> {
    const text = await this.deps.host.read(vault.id, file);
    const extracted = extractProposals(answer);
    const stamp = this.now();
    let next = appendPersonaAnswer(text, stamp, extracted.text);
    for (const proposal of extracted.proposals) {
      next = appendPersonaProposal(next, stamp, proposal.summary, proposal.command).text;
    }
    return this.write(vault, file, next);
  }

  /** A card's decision line; null when the card is not pending. */
  async decide(vault: EngineVault, open: OpenSession, decision: { readonly id: string; readonly state: 'confirmed' | 'dismissed'; readonly outcome: string | null }): Promise<OpenSession | null> {
    const decided = decideProposal(open.text, this.now(), decision.id, decision.state, decision.outcome);
    return decided === null ? null : this.write(vault, open.file, decided);
  }

  private async create(vault: EngineVault, persona: Persona): Promise<OpenSession> {
    const stamp = this.now();
    const file = `${CHAT_DIR}/${chatFileName(stamp, personaSessionTitle(persona.title))}`;
    const thread = await this.deps.host.read(vault.id, threadPathFor(persona.id)).catch(() => null);
    const migrated = migrateThread(newPersonaSessionText(persona.title, stamp, persona.id), thread ?? '', stamp);
    await this.deps.host.write(vault.id, file, migrated.text);
    if (thread === null) {
      await this.commit(vault, [file], `tickets: 1:1 with ${persona.id} started ${file}`);
    } else {
      await this.removeThread(vault, persona.id);
      await this.commit(vault, [file, threadPathFor(persona.id)], `personas: ${persona.id} thread.md migrated into ${file} (${migrated.count} lines)`);
      this.deps.log(`persona ${persona.id}: thread.md migrated into ${file} (${migrated.count} lines) and removed`, 'info');
    }
    this.deps.host.announceChanges(vault.id, [file], thread === null ? [] : [threadPathFor(persona.id)]);
    return { file, text: migrated.text, session: parsePersonaSession(migrated.text, file)! };
  }

  private async removeThread(vault: EngineVault, persona: string): Promise<void> {
    const abs = this.deps.host.resolveAssetPath(vault.id, threadPathFor(persona));
    if (abs !== null) {
      await fsp.rm(abs, { force: true });
    }
  }

  private async write(vault: EngineVault, file: string, text: string): Promise<OpenSession> {
    await this.deps.host.write(vault.id, file, text);
    await this.commit(vault, [file], `tickets: 1:1 ${file}`);
    this.deps.host.announceChanges(vault.id, [file]);
    return { file, text, session: parsePersonaSession(text, file)! };
  }

  /** One commit of exactly these paths, removals staged too; a failure logs, never throws. */
  private async commit(vault: EngineVault, vaultRelPaths: readonly string[], message: string): Promise<void> {
    const location = await this.git.locate(vault.path);
    if (location === null) {
      return;
    }
    const paths = vaultRelPaths.map((p) => `${location.prefix}${p}`);
    try {
      await this.git.commitTree(location.root, paths, message);
    } catch (error) {
      // An untracked thread.md never reached git: its removal has nothing to stage — the session file still commits.
      await this.git.commitPaths(location.root, paths, message).catch(() => this.deps.log(`git commit failed: ${messageOf(error)}`, 'warn'));
    }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
