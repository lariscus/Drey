/**
 * Pia's entry in a ticket's chain (req-257, the persona board concept §14
 * reading 7; owner 2026-11-12 "Ja, so"): when the cursor reaches an entry
 * whose persona is Mission Control's (`entryWorkOf` = `mission-turn`), the
 * engine runs ONE ticket-scoped Mission Control turn — a chat session of its
 * own, her prompt + `mission.md` + the ticket in the board digest's place —
 * no session of the runner, no slot, no class, no budget (R9: Pia executes,
 * she does not work). The ticket then waits for the owner (`awaiting: you`,
 * a `needs-decision` in Needs you naming her chat): **confirming one of her
 * cards ends her entry** and moves the cursor on; a turn without a card, or
 * cards the owner dismisses, leaves the ticket at You with her reply — the
 * owner's Accept moves it on.
 */
import type { ChatTurnResult } from '../contracts/chat';

/** One ticket whose cursor stands on Mission Control's persona. */
export interface MissionEntry {
  readonly id: string;
  readonly position: number;
  readonly length: number;
  /** The persona's title (the session's and the card's name for her). */
  readonly persona: string;
}

/** What the turns need of the board (BoardService fits). */
export interface MissionEntryBoard {
  missionEntries(): Promise<readonly MissionEntry[]>;
  waitForOwner(input: { readonly id: string; readonly key: string; readonly text: string; readonly detail: string }): Promise<{ readonly ok: boolean; readonly error?: string }>;
  finishMissionEntry(input: { readonly id: string; readonly position: number }): Promise<{ readonly ok: boolean; readonly error?: string }>;
}

/** What the turns need of the chat (ChatService fits). */
export interface MissionEntryChat {
  /** A new session titled `missionEntryTitle` — the chat reads the ticket into the turn from that title. */
  start(input: { readonly title: string; readonly text: string }): Promise<ChatTurnResult>;
}

/** The Needs-you key a waiting Pia entry carries. */
export const MISSION_ENTRY_KEY = 'pia-turn';

const TITLE_RE = / — (T-\d+), position (\d+) of \d+$/;

/** The chat session's title for her entry: `Pia — T-0123, position 2 of 4`. */
export function missionEntryTitle(entry: Pick<MissionEntry, 'id' | 'position' | 'length' | 'persona'>): string {
  return `${entry.persona} — ${entry.id}, position ${entry.position} of ${entry.length}`;
}

/** The ticket and position a session title names, or null for any other session. */
export function missionEntryOfTitle(title: string): { readonly id: string; readonly position: number } | null {
  const match = TITLE_RE.exec(title);
  return match === null ? null : { id: match[1]!, position: Number(match[2]) };
}

/** The owner line the engine sends for her turn (it lands in the session like any line). */
function askOf(entry: MissionEntry): string {
  return `Your entry in the chain of ${entry.id} (position ${entry.position} of ${entry.length}): read the ticket below and do what your prompt says for it. Every change you want is a card I confirm; when nothing needs changing, say so.`;
}

export class MissionEntryTurns {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly board: MissionEntryBoard,
    private readonly chat: MissionEntryChat,
    private readonly log: (message: string, level?: 'info' | 'warn') => void,
  ) {}

  /** One pass over the board: a turn for every ticket her entry holds and no turn is running for. */
  async sweep(): Promise<void> {
    const entries = await this.board.missionEntries().catch(() => [] as readonly MissionEntry[]);
    for (const entry of entries.filter((e) => !this.inFlight.has(e.id))) {
      this.inFlight.add(entry.id);
      try {
        await this.turn(entry);
      } finally {
        this.inFlight.delete(entry.id);
      }
    }
  }

  /** A confirmed card of one of her entry sessions ends that entry (owner 2026-11-12, Q1a). */
  async confirmed(sessionTitle: string): Promise<void> {
    const entry = missionEntryOfTitle(sessionTitle);
    if (entry === null) {
      return;
    }
    const done = await this.board.finishMissionEntry(entry);
    if (!done.ok) {
      this.log(`mission entry: ${entry.id} stays at position ${entry.position} — ${done.error ?? 'not finished'}`, 'warn');
    }
  }

  private async turn(entry: MissionEntry): Promise<void> {
    const title = missionEntryTitle(entry);
    const result = await this.chat.start({ title, text: askOf(entry) }).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }) as ChatTurnResult);
    const cards = result.proposals?.length ?? 0;
    const say = (result.say ?? '').trim();
    const text = !result.ok
      ? `${entry.persona}'s turn did not run: ${result.error ?? 'no answer'}`
      : cards > 0
        ? `${entry.persona} proposes ${cards} change${cards === 1 ? '' : 's'} — confirm a card in her chat to move on`
        : `${entry.persona} proposes nothing: ${say.split('\n')[0] ?? ''}`.trim();
    const detail = `${title}${result.file !== undefined ? ` (${result.file})` : ''}\n\n${say}`;
    const parked = await this.board.waitForOwner({ id: entry.id, key: MISSION_ENTRY_KEY, text: text.slice(0, 200), detail });
    this.log(`mission entry: ${entry.id} at position ${entry.position} — ${text}${parked.ok ? '' : ` (the wait could not be written: ${parked.error ?? '?'})`}`);
  }
}
