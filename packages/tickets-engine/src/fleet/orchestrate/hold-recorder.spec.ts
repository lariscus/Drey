import { describe, expect, it } from 'vitest';
import type { TicketHolder } from '../../core/chain-holder';
import type { LedgerWrite } from '../../core/ledger';
import type { HoldMark } from './chain-state';
import { HoldRecorder, holdMarkOf } from './hold-recorder';

/** req-274: the cursor's moves as `hold` ledger lines, observed per dispatch pass. */

const entry = (position: number, length: number) => ({ position, length, named: 'x', mode: null, notify: false });
const at = (persona: string, position: number, length: number): TicketHolder => ({ kind: 'entry', persona, entry: entry(position, length), work: 'run' });
const none: TicketHolder = { kind: 'none' };

function recorder(initial: Record<string, HoldMark> = {}) {
  const lines: LedgerWrite[] = [];
  let persisted = 0;
  const book = { holds: { ...initial } };
  const subject = new HoldRecorder({
    book,
    events: { ledger: (write) => lines.push(write) },
    persist: () => {
      persisted++;
      return Promise.resolve();
    },
  });
  return { subject, lines, book, persisted: () => persisted };
}

describe('holdMarkOf', () => {
  it('a lifecycle column has no hold; You stands at its position', () => {
    expect(holdMarkOf(none)).toBeNull();
    expect(holdMarkOf({ kind: 'awaiting', persona: 'you', entry: entry(3, 5) })).toEqual({ persona: 'you', position: 3, length: 5 });
    expect(holdMarkOf({ kind: 'no-persona', persona: 'you', entry: null, reason: 'no chain' })).toEqual({ persona: 'you', position: null, length: null });
  });
});

describe('HoldRecorder', () => {
  it('writes a line when a ticket arrives at a holder, and nothing while it stays', async () => {
    const r = recorder();
    await r.subject.observe(new Map([['T-1', at('ben', 2, 4)]]));
    await r.subject.observe(new Map([['T-1', at('ben', 2, 4)]]));
    expect(r.lines).toEqual([{ kind: 'hold', ticket: 'T-1', persona: 'ben', position: 2, length: 4 }]);
    expect(r.book.holds).toEqual({ 'T-1': { persona: 'ben', position: 2, length: 4 } });
    expect(r.persisted()).toBe(1);
  });

  it('a move to another position or another persona at the same position is a new hold', async () => {
    const r = recorder({ 'T-1': { persona: 'ben', position: 2, length: 4 } });
    await r.subject.observe(new Map([['T-1', at('ben', 3, 4)]]));
    await r.subject.observe(new Map([['T-1', at('tessa', 3, 4)]]));
    expect(r.lines.map((l) => [l.persona, l.position])).toEqual([
      ['ben', 3],
      ['tessa', 3],
    ]);
  });

  it('closes the hold when the ticket reaches a lifecycle column or leaves the board', async () => {
    const r = recorder({ 'T-1': { persona: 'you', position: 4, length: 4 }, 'T-2': { persona: 'ben', position: 1, length: 2 } });
    await r.subject.observe(new Map([['T-1', none]]));
    expect(r.lines).toEqual([
      { kind: 'hold', ticket: 'T-1' },
      { kind: 'hold', ticket: 'T-2' },
    ]);
    expect(r.book.holds).toEqual({});
  });

  it('a ticket in a lifecycle column that held nothing writes nothing', async () => {
    const r = recorder();
    await r.subject.observe(new Map([['T-9', none]]));
    expect(r.lines).toEqual([]);
    expect(r.persisted()).toBe(0);
  });

  it('a restarted runner writes nothing for a hold its book already recorded', async () => {
    const r = recorder({ 'T-1': { persona: 'ben', position: 2, length: 4 } });
    await r.subject.observe(new Map([['T-1', at('ben', 2, 4)]]));
    expect(r.lines).toEqual([]);
  });
});
