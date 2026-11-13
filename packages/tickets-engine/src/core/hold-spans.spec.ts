import { describe, expect, it } from 'vitest';
import { heldMsByPersona, heldMsByPosition, holdSpans } from './hold-spans';
import { parseLedger } from './ledger';

/** req-274: the time each holder held a ticket, read off the ledger's `hold` lines. */

const MIN = 60_000;

const ledger = (...lines: string[]) => parseLedger(lines.join('\n'));
const hold = (ts: string, ticket: string, persona?: string, position?: number, length?: number): string =>
  JSON.stringify({ v: 1, ts, event: 'hold', ticket, ...(persona !== undefined ? { persona } : {}), ...(position !== undefined ? { position, length } : {}) });

describe('holdSpans', () => {
  it('a hold runs until the ticket next moves', () => {
    const spans = holdSpans(
      ledger(hold('2026-11-13T09:00:00Z', 'T-1', 'paul', 1, 3), hold('2026-11-13T09:30:00Z', 'T-1', 'ben', 2, 3), hold('2026-11-13T10:30:00Z', 'T-1')),
      '2026-11-13T12:00:00Z',
    );
    expect(spans).toEqual([
      { ticket: 'T-1', persona: 'paul', position: 1, length: 3, from: '2026-11-13T09:00:00Z', to: '2026-11-13T09:30:00Z', ms: 30 * MIN },
      { ticket: 'T-1', persona: 'ben', position: 2, length: 3, from: '2026-11-13T09:30:00Z', to: '2026-11-13T10:30:00Z', ms: 60 * MIN },
    ]);
  });

  it('an open hold runs until now', () => {
    const spans = holdSpans(ledger(hold('2026-11-13T09:00:00Z', 'T-1', 'you', 4, 4)), '2026-11-13T09:45:00Z');
    expect(spans).toEqual([{ ticket: 'T-1', persona: 'you', position: 4, length: 4, from: '2026-11-13T09:00:00Z', to: null, ms: 45 * MIN }]);
  });

  it('tickets are kept apart, and other ledger lines do not count', () => {
    const spans = holdSpans(
      ledger(
        hold('2026-11-13T09:00:00Z', 'T-1', 'ben', 1, 2),
        hold('2026-11-13T09:10:00Z', 'T-2', 'ben', 1, 2),
        '{"v":1,"ts":"2026-11-13T09:15:00Z","event":"run_settled","ticket":"T-1","persona":"ben","tokensIn":1,"tokensOut":1}',
        hold('2026-11-13T09:20:00Z', 'T-1'),
        hold('2026-11-13T09:40:00Z', 'T-2'),
      ),
      '2026-11-13T10:00:00Z',
    );
    expect(spans.map((s) => [s.ticket, s.ms])).toEqual([
      ['T-1', 20 * MIN],
      ['T-2', 30 * MIN],
    ]);
  });

  it('a closing line without an open hold, and a clock that runs backwards, add nothing', () => {
    const spans = holdSpans(ledger(hold('2026-11-13T09:00:00Z', 'T-1'), hold('2026-11-13T09:00:00Z', 'T-2', 'ben', 1, 1), hold('2026-11-13T08:00:00Z', 'T-2')), '2026-11-13T10:00:00Z');
    expect(spans).toEqual([expect.objectContaining({ ticket: 'T-2', ms: 0 })]);
  });
});

describe('held time per persona and position', () => {
  const spans = holdSpans(
    ledger(
      hold('2026-11-13T09:00:00Z', 'T-1', 'paul', 1, 3),
      hold('2026-11-13T09:10:00Z', 'T-1', 'ben', 2, 3),
      hold('2026-11-13T09:40:00Z', 'T-1', 'you', 3, 3),
      hold('2026-11-13T09:00:00Z', 'T-2', 'ben', 1, 1),
      hold('2026-11-13T09:20:00Z', 'T-2', 'you'),
      hold('2026-11-13T10:00:00Z', 'T-2'),
    ),
    '2026-11-13T10:00:00Z',
  );

  it('sums every ticket per persona, the owner included', () => {
    expect(Object.fromEntries(heldMsByPersona(spans))).toEqual({ paul: 10 * MIN, ben: 50 * MIN, you: 60 * MIN });
  });

  it('sums every ticket per position and leaves a hold without a position out', () => {
    expect(Object.fromEntries(heldMsByPosition(spans))).toEqual({ 1: 30 * MIN, 2: 30 * MIN, 3: 20 * MIN });
  });
});
