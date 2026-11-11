import { describe, expect, it } from 'vitest';
import type { TicketCard } from '../contracts/tickets';
import type { PutOptions, TicketDetail } from '../ports/ticket-store';
import { detailFromContent } from '../store/dricket-ticket-store';
import type { WriteOutcome } from '../store/dricket-file-store';
import { StoreChainBoard, type ChainStoreIo } from './store-chain-board';

const DOC = '---\nid: t-7\ntitle: Seven\nstage: active\nrev: 2\nx-phase: building\n---\n\n## Description\n\nx\n';

/** One ticket in memory; `put` replaces it like dk would. */
class MemoryIo implements ChainStoreIo {
  text = DOC;
  readonly writes: string[] = [];
  readAll(): Promise<readonly TicketDetail[]> {
    return Promise.resolve([this.detail()]);
  }
  show(): Promise<TicketDetail> {
    return Promise.resolve(this.detail());
  }
  write(_id: string, text: string, _options: PutOptions): Promise<WriteOutcome> {
    this.writes.push(text);
    this.text = text;
    return Promise.resolve({ ok: true, result: { id: 'T-0007', rev: 3, commit: null, changedFields: [] } });
  }
  comment(): Promise<void> {
    return Promise.resolve();
  }
  private detail(): TicketDetail {
    return { ...detailFromContent(this.text), id: 'T-0007', rev: 2 };
  }
}

const NOW = new Date('2026-11-11T12:00:00Z');
const card = { id: 'T-0007', phase: 'building' } as unknown as TicketCard;

describe('the chain door on a lifecycle store (req-265)', () => {
  it("a chain move to the next column writes active + the pin, and moved() sees a pin change as a move", async () => {
    const io = new MemoryIo();
    const door = new StoreChainBoard(io, () => undefined, true);
    await door.board('C:/nowhere', 'opencode').catch(() => undefined); // reads the placements (the meta vault is absent here)
    expect(await door.patch(card, { toStage: 'ready', now: NOW, actor: 'chain@host' }, 'chain@host')).toBe(true);
    const written = detailFromContent(io.writes[0]!);
    expect(written.stage).toBe('active');
    expect(written.extensions['x-phase']).toBe('ready');
    expect(await door.moved(card)).toBe(false); // its own write is where it now stands

    io.text = DOC.replace('x-phase: building', 'x-phase: shaping'); // someone else moved it on the board
    expect(await door.moved(card)).toBe(true);
  });

  it('a move into an edge column drops the pin', async () => {
    const io = new MemoryIo();
    const door = new StoreChainBoard(io, () => undefined, true);
    expect(await door.patch(card, { toStage: 'prioritized', now: NOW, actor: 'chain@host' }, 'chain@host')).toBe(true);
    const written = detailFromContent(io.writes[0]!);
    expect(written.stage).toBe('prioritized');
    expect(written.extensions['x-phase']).toBeUndefined();
  });
});
