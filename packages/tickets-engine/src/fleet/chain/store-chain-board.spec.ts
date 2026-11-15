import { describe, expect, it } from 'vitest';
import type { TicketCard } from '../../contracts/tickets';
import type { TicketDetail } from '../../ports/ticket-store';
import { detailFromContent } from '../../store/dricket-ticket-store';
import { StoreChainBoard, type ChainStoreIo } from './store-chain-board';

const DOC = '---\nid: t-7\ntitle: Seven\nstage: active\nrev: 2\n---\n\n## Description\n\nWhat seven is.\n';

/** One ticket in memory; the chain door only reads it and comments. */
class MemoryIo implements ChainStoreIo {
  readonly comments: { id: string; text: string; actor: string }[] = [];
  readAll(): Promise<readonly TicketDetail[]> {
    return Promise.resolve([this.detail()]);
  }
  show(): Promise<TicketDetail> {
    return Promise.resolve(this.detail());
  }
  comment(id: string, text: string, options: { readonly actor: string }): Promise<void> {
    this.comments.push({ id, text, actor: options.actor });
    return Promise.resolve();
  }
  private detail(): TicketDetail {
    return { ...detailFromContent(DOC), id: 'T-0007', rev: 2 };
  }
}

/** req-307: the chain door reads the board and comments; it writes and moves nothing (the run's own release is the one write). */
describe('the chain door on a store (req-265, req-307)', () => {
  it('reads the board from the store files (the meta vault is absent here: defaults), and a card text from the record', async () => {
    const door = new StoreChainBoard(new MemoryIo(), () => undefined);
    const board = await door.board('C:/nowhere', 'opencode');
    expect(board.defaultWorker).toBe('opencode');
    expect(board.columns.flatMap((c) => c.tickets).map((t) => t.id)).toEqual(['T-0007']);
    expect(await door.cardText({ id: 'T-0007', phase: 'active' } as unknown as TicketCard)).toContain('What seven is.');
  });

  it('comments through the store as the given actor, and a missing checkout is no error', async () => {
    const io = new MemoryIo();
    await new StoreChainBoard(io, () => undefined).comment('T-0007', 'parked', 'chain@host');
    expect(io.comments).toEqual([{ id: 'T-0007', text: 'parked', actor: 'chain@host' }]);
    const none = new StoreChainBoard(null, () => undefined);
    await expect(none.comment('T-0007', 'x', 'chain@host')).resolves.toBeUndefined();
    await expect(none.board('C:/nowhere', 'opencode')).rejects.toThrow('no ticket checkout configured');
  });
});
