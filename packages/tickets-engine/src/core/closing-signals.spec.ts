import { describe, expect, it } from 'vitest';
import type { TicketIssue } from '../contracts/tickets';
import { ALL_CLOSING_SIGNALS, parseClosingSignals } from './closing-signals';
import { parsePipeline } from './ticket-board';

describe('parseClosingSignals (req-169)', () => {
  it('absent means all five; none or an empty list means no round at all', () => {
    expect(parseClosingSignals(undefined, [])).toEqual(ALL_CLOSING_SIGNALS);
    expect(parseClosingSignals('none', [])).toEqual([]);
    expect(parseClosingSignals([], [])).toEqual([]);
  });

  it('keeps the named signals once, drops an unknown name with a noise finding', () => {
    const issues: TicketIssue[] = [];
    expect(parseClosingSignals(['red-gate', 'cost', 'red-gate', 'mood'], issues)).toEqual(['red-gate', 'cost']);
    expect(issues).toEqual([{ level: 'noise', message: 'pipeline.md: closing-signals "mood" is not a signal — ignored' }]);
  });

  it('a value that is no list keeps the default, visibly', () => {
    const issues: TicketIssue[] = [];
    expect(parseClosingSignals('cost', issues)).toEqual(ALL_CLOSING_SIGNALS);
    expect(issues).toHaveLength(1);
  });

  it('pipeline.md carries the key at the top level', () => {
    const parsed = parsePipeline('---\nclosing-signals: [red-gate, friction]\nphases:\n  - id: build\n---\n');
    expect(parsed.closingSignals).toEqual(['red-gate', 'friction']);
  });
});
