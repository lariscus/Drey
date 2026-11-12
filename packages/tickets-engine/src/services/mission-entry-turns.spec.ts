import { describe, expect, it, vi } from 'vitest';
import type { ChatTurnResult } from '../contracts/chat';
import { MISSION_ENTRY_KEY, MissionEntryTurns, missionEntryOfTitle, missionEntryTitle, type MissionEntry, type MissionEntryBoard, type MissionEntryChat } from './mission-entry-turns';

const ENTRY: MissionEntry = { id: 'T-0123', position: 2, length: 4, persona: 'Pia' };

function setup(result: ChatTurnResult, entries: readonly MissionEntry[] = [ENTRY]) {
  const board = {
    missionEntries: vi.fn(async () => entries),
    waitForOwner: vi.fn(async () => ({ ok: true })),
    finishMissionEntry: vi.fn(async () => ({ ok: true })),
  } satisfies MissionEntryBoard;
  const chat = { start: vi.fn(async () => result) } satisfies MissionEntryChat;
  return { board, chat, turns: new MissionEntryTurns(board, chat, () => undefined) };
}

describe("Pia's entry in a ticket's chain (req-257)", () => {
  it('names her session after the ticket and the position, and reads it back', () => {
    expect(missionEntryTitle(ENTRY)).toBe('Pia — T-0123, position 2 of 4');
    expect(missionEntryOfTitle('Pia — T-0123, position 2 of 4')).toEqual({ id: 'T-0123', position: 2 });
    expect(missionEntryOfTitle('Planning the week')).toBeNull();
  });

  it('runs one ticket-scoped turn and parks the ticket for the owner with her cards', async () => {
    const { board, chat, turns } = setup({ ok: true, file: 'tickets/_meta/chat/x.md', say: 'Two changes.', proposals: [{}, {}] as never });
    await turns.sweep();
    expect(chat.start).toHaveBeenCalledWith({ title: 'Pia — T-0123, position 2 of 4', text: expect.stringContaining('Your entry in the chain of T-0123 (position 2 of 4)') as string });
    expect(board.waitForOwner).toHaveBeenCalledWith({ id: 'T-0123', key: MISSION_ENTRY_KEY, text: 'Pia proposes 2 changes — confirm a card in her chat to move on', detail: expect.stringContaining('Two changes.') as string });
  });

  it('a turn without a card leaves the ticket at You with her reply; a failed turn says so', async () => {
    const quiet = setup({ ok: true, say: 'Nothing to change here.', proposals: [] });
    await quiet.turns.sweep();
    expect(quiet.board.waitForOwner).toHaveBeenCalledWith(expect.objectContaining({ text: 'Pia proposes nothing: Nothing to change here.' }));
    const down = setup({ ok: false, error: 'no model answered' });
    await down.turns.sweep();
    expect(down.board.waitForOwner).toHaveBeenCalledWith(expect.objectContaining({ text: "Pia's turn did not run: no model answered" }));
  });

  it('a confirmed card of her entry session ends the entry; any other session does nothing', async () => {
    const { board, turns } = setup({ ok: true });
    await turns.confirmed('Pia — T-0123, position 2 of 4');
    expect(board.finishMissionEntry).toHaveBeenCalledWith({ id: 'T-0123', position: 2 });
    await turns.confirmed('A chat about the week');
    expect(board.finishMissionEntry).toHaveBeenCalledTimes(1);
  });
});
