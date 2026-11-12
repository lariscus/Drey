/**
 * req-266: the three places a chain is read from besides the flow editor —
 * a ticket's `chain:` / `at:` / `sent-back:`, pipeline.md's `flow:` and the
 * plan's `### Chain` — plus the creation write that copies the flow in.
 */
import { describe, expect, it } from 'vitest';
import type { TicketIssue } from '../contracts/tickets';
import { parsePipeline } from './ticket-board';
import { parsePlanChain } from './plan-chain';
import { parsePipelineFlow } from './pipeline-flow';
import { parseTicketChainFields } from './ticket-chain-fields';
import { newTicketFileText, parseTicketFile } from './ticket-files';

describe('a ticket\'s chain fields', () => {
  it('reads the list, the cursor and the send-back', () => {
    const issues: TicketIssue[] = [];
    expect(parseTicketChainFields({ chain: ['paul:shape', 'ben', 'you'], at: 2, 'sent-back': '3>2' }, issues, false)).toEqual({
      chain: [
        { persona: 'paul', mode: 'shape', notify: false },
        { persona: 'ben', mode: null, notify: false },
        { persona: 'you', mode: null, notify: false },
      ],
      at: 2,
      sentBack: { from: 3, to: 2 },
    });
    expect(issues).toEqual([]);
  });

  it('reads the store\'s strings the same', () => {
    expect(parseTicketChainFields({ chain: ['ben'], at: '1' }, [], false)).toEqual({ chain: [{ persona: 'ben', mode: null, notify: false }], at: 1 });
  });

  it('reads an old delta as no chain — with a warning on an open ticket, silently on a done one', () => {
    const open: TicketIssue[] = [];
    expect(parseTicketChainFields({ chain: ['skip verify'], at: 1 }, open, false)).toEqual({});
    expect(open).toEqual([{ level: 'warning', message: expect.stringContaining('the chain is read as absent') }]);
    const done: TicketIssue[] = [];
    expect(parseTicketChainFields({ chain: ['insert security after review'] }, done, true)).toEqual({});
    expect(done).toEqual([]);
  });

  it('warns about a cursor or a send-back it cannot read', () => {
    const issues: TicketIssue[] = [];
    expect(parseTicketChainFields({ chain: ['ben'], at: 'two', 'sent-back': 'back' }, issues, false)).toEqual({ chain: [{ persona: 'ben', mode: null, notify: false }] });
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining('at must be a position'), expect.stringContaining('sent-back must read')]);
  });
});

describe('the standard flow in pipeline.md', () => {
  const PIPELINE = (flow: string): string => `---\nphases:\n  - { id: inbox, title: Inbox }\n  - { id: done, title: Done }\n${flow}---\n`;

  it('reads a ;-line or a list', () => {
    expect(parsePipeline(PIPELINE('flow: paul:shape; ben; you\n')).flow?.map((e) => e.persona)).toEqual(['paul', 'ben', 'you']);
    expect(parsePipeline(PIPELINE('flow: [paul, ben]\n')).flow?.map((e) => e.persona)).toEqual(['paul', 'ben']);
    expect(parsePipeline(PIPELINE('')).flow).toEqual([]);
  });

  it('drops an unreadable flow whole, with a warning', () => {
    const issues: TicketIssue[] = [];
    expect(parsePipelineFlow('paul; skip verify', issues)).toEqual([]);
    expect(issues[0]!.message).toContain('no standard flow');
  });
});

describe('the plan\'s ### Chain', () => {
  const ticket = (plan: string): string => `---\nid: T-0001\n---\n\n## Plan\n\n${plan}\n## Log\n`;

  it('reads one line or a list, inside the Plan only', () => {
    expect(parsePlanChain(ticket('### Goal\n\nx\n\n### Chain\n\npaul; ben; ralf(notify)\n\n### Acceptance criteria\n\n- [ ] `x`\n'))).toEqual({
      kind: 'chain',
      entries: [
        { persona: 'paul', mode: null, notify: false },
        { persona: 'ben', mode: null, notify: false },
        { persona: 'ralf', mode: null, notify: true },
      ],
    });
    expect(parsePlanChain(ticket('### Chain\n\n- paul:shape\n- `ben`\n'))).toMatchObject({ kind: 'chain', entries: [{ persona: 'paul', mode: 'shape' }, { persona: 'ben' }] });
    expect(parsePlanChain('---\nid: T-0001\n---\n\n## Notes\n\n### Chain\n\nben\n')).toEqual({ kind: 'none' });
    expect(parsePlanChain(ticket('### Goal\n\nx\n'))).toEqual({ kind: 'none' });
  });

  it('says why a chain does not read', () => {
    expect(parsePlanChain(ticket('### Chain\n\nben; skip verify\n'))).toMatchObject({ kind: 'unreadable', error: expect.stringContaining('"skip verify"') });
  });
});

describe('the creation write', () => {
  it('copies the chain in with the cursor at 1, and the reader takes it back', () => {
    const text = newTicketFileText({
      id: 'T-0001',
      title: 'Idea',
      repo: null,
      priority: 'normal',
      rank: 5000,
      firstPhase: 'inbox',
      now: new Date('2026-11-12T10:00:00Z'),
      actor: 'owner@test',
      description: 'x',
      chain: ['paul:shape', 'ben', 'ralf(notify)'],
    });
    expect(text).toContain('chain: [paul:shape, ben, ralf(notify)]\nat: 1\n');
    const { meta, issues } = parseTicketFile(text, 'tickets/inbox/T-0001.md');
    expect(meta.chain?.map((e) => e.persona)).toEqual(['paul', 'ben', 'ralf']);
    expect(meta.at).toBe(1);
    expect(issues.filter((i) => i.level !== 'noise')).toEqual([]);
  });
});
