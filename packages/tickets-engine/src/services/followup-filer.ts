/**
 * Files a run's follow-up proposals as pending Mission Control cards
 * (req-299). It writes exactly one thing — the session file
 * `tickets/_meta/chat/<stamp>-follow-ups-from-t-….md` — and commits it on
 * the engine's one `TicketsGit` queue, so it meets no other writer of the
 * tickets repository (the closing round's persona commits, milestone 272,
 * ride the same queue). The iron rule of the chat holds: nothing reaches
 * the board here; a ticket exists once the owner confirms a card, through
 * `ChatService`'s one decision path.
 *
 * Idempotent per run: a session of the ticket's follow-up title that
 * already names the run is left alone (the engine restarts and the fleet's
 * change notices repeat). A title the ticket's earlier follow-up sessions
 * already proposed — confirmed, dismissed or still pending — is not
 * proposed again, so a send-back loop never asks the same question twice.
 */
import type { BoardSnapshot } from '../contracts/tickets';
import { CHAT_DIR, chatFileName, parseSessionFile } from '../core/chat/chat-session';
import { followupSessionText, followupsTitle, runLinePrefix, type FollowupContext } from '../core/ticket/followup-cards';
import type { FollowupDraft } from '../core/ticket/followups';
import { TicketsGit } from '../core/git/tickets-git';
import type { EngineHost, EngineVault } from './host';

/** The session files the chat owns — direct children of its folder only. */
const CHAT_FILE_PATTERN = /^tickets\/_meta\/chat\/[^/]+\.md$/;

/** What filing a run's proposals did: the session written (null when there was nothing to file) and how many cards. */
export type FollowupFiling =
  | { readonly ok: true; readonly file: string | null; readonly filed: number }
  | { readonly ok: false; readonly error: string };

/** What the filer needs of the board (BoardService fits). */
export interface FollowupBoard {
  snapshot(): Promise<BoardSnapshot>;
}

export interface FollowupFilerDeps {
  readonly board: FollowupBoard;
  readonly host: EngineHost;
  readonly git?: TicketsGit;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
  /** The clock; the specs pin it for deterministic stamps and file names. */
  readonly now?: () => Date;
}

/** One run's proposals as the filer takes them. */
export interface FollowupInput {
  readonly ticket: string;
  readonly runId: string;
  readonly drafts: readonly FollowupDraft[];
}

/** What the ticket's earlier follow-up sessions already hold. */
interface EarlierSessions {
  /** A session already names this run. */
  readonly filedFor: string | null;
  /** The titles proposed so far, lowercased. */
  readonly titles: ReadonlySet<string>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class FollowupFiler {
  private readonly git: TicketsGit;

  constructor(private readonly deps: FollowupFilerDeps) {
    this.git = deps.git ?? new TicketsGit(() => 'git');
  }

  async file(input: FollowupInput): Promise<FollowupFiling> {
    if (input.drafts.length === 0) {
      return { ok: true, file: null, filed: 0 };
    }
    const snap = await this.deps.board.snapshot();
    const vault = snap.vaultId === null ? null : ((await this.deps.host.listVaults()).find((v) => v.id === snap.vaultId) ?? null);
    const phase = snap.pipeline[0]?.id ?? null;
    if (vault === null) {
      return { ok: false, error: 'no tickets vault detected' };
    }
    if (phase === null) {
      return { ok: false, error: snap.pipelineError ?? 'the pipeline is empty' };
    }
    const earlier = await this.earlier(vault, snap, input);
    if (earlier.filedFor !== null) {
      return { ok: true, file: earlier.filedFor, filed: 0 };
    }
    const drafts = input.drafts.filter((d) => !earlier.titles.has(d.title.toLowerCase()));
    if (drafts.length === 0) {
      return { ok: true, file: null, filed: 0 };
    }
    return this.write(vault, drafts, this.contextOf(snap, input, phase));
  }

  /** What the source ticket and the board hand every card. */
  private contextOf(snap: BoardSnapshot, input: FollowupInput, phase: string): FollowupContext {
    const source = snap.columns.flatMap((c) => c.tickets).find((t) => t.id === input.ticket) ?? null;
    const repo = source?.meta.repo?.trim() ?? '';
    return {
      ticket: input.ticket,
      runId: input.runId,
      sourceTitle: source?.meta.title ?? null,
      phase,
      priorities: snap.priorities,
      repo: repo === '' ? null : repo,
      project: source?.meta.project ?? null,
      projects: snap.projects ?? [],
    };
  }

  private async write(vault: EngineVault, drafts: readonly FollowupDraft[], context: FollowupContext): Promise<FollowupFiling> {
    const stamp = this.deps.now?.() ?? new Date();
    const file = `${CHAT_DIR}/${chatFileName(stamp, followupsTitle(context.ticket))}`;
    await this.deps.host.write(vault.id, file, followupSessionText(drafts, context, stamp));
    await this.commit(vault, file, `tickets: follow-ups of ${context.ticket} proposed (${context.runId})`);
    this.deps.host.announceChanges(vault.id, [file]);
    return { ok: true, file, filed: drafts.length };
  }

  /** The ticket's earlier follow-up sessions: the file that names this run, and every title proposed so far. */
  private async earlier(vault: EngineVault, snap: BoardSnapshot, input: FollowupInput): Promise<EarlierSessions> {
    const title = followupsTitle(input.ticket);
    const line = runLinePrefix(input.runId, input.ticket);
    const titles = new Set<string>();
    let filedFor: string | null = null;
    for (const file of (await this.deps.host.listMarkdownFiles(vault.id)).filter((f) => CHAT_FILE_PATTERN.test(f))) {
      const text = await this.deps.host.read(vault.id, file).catch(() => null);
      const session = text === null ? null : parseSessionFile(text, file, snap.priorities);
      if (session === null || session.title !== title) {
        continue;
      }
      if (session.messages.some((m) => m.text.startsWith(line))) {
        filedFor = file;
      }
      for (const proposal of session.proposals) {
        if (proposal.command.kind === 'createTicket') {
          titles.add(proposal.command.title.toLowerCase());
        }
      }
    }
    return { filedFor, titles };
  }

  /** One commit for exactly this path; failures log, never throw. */
  private async commit(vault: EngineVault, file: string, message: string): Promise<void> {
    const location = await this.git.locate(vault.path);
    if (location === null) {
      this.deps.log('the tickets vault is not a git repository — the follow-up cards are not versioned', 'info');
      return;
    }
    try {
      await this.git.commitPaths(location.root, [`${location.prefix}${file}`], message);
    } catch (error) {
      this.deps.log(`git commit failed: ${messageOf(error)}`, 'warn');
    }
  }
}

