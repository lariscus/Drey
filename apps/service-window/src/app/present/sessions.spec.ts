import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, createI18n, loadCatalog } from '../../../../../shared/i18n';
import type { StreamEvent } from '../../../../../shared/service-window/contract';
import { demoRuns, demoSnapshot, demoStream } from '../api/demo-data';
import { idLine, processRows, sessionFacts } from './session-facts';
import { sessionList, sessionTitle } from './session-list';
import { mcpStats, rawRows, streamRows, toolRows } from './stream-rows';

const i18n = createI18n({ locale: DEFAULT_LOCALE, catalog: loadCatalog(DEFAULT_LOCALE) });
const runs = demoRuns();
const ben = runs[1]!;

describe('sessionList', () => {
  const list = sessionList(i18n, runs, Date.now());

  it('summarises sessions, runs and held', () => {
    expect(list.summary).toBe('3 sessions · 2 runs · 1 held');
    expect(list.endedCount).toBe(7);
  });
  it('titles and details the live rows', () => {
    expect(list.live.map((row) => row.title)).toEqual(['T-0126 · test · Tessa', 'T-0121 · build · Ben', '1:1 · Ben']);
    expect(list.live[0]?.detail).toBe('opencode · qwen3-coder · turn 6 · 9 min quiet');
    expect(list.live[1]?.detail).toBe('claude-code · sonnet · turn 3 · writing');
    expect(list.live[2]?.detail).toBe('claude-code · sonnet · held');
    expect(list.live.map((row) => row.dot)).toEqual(['running', 'running', 'held']);
    expect(list.live[2]?.buttonLabel).toBe('Release 1:1 · Ben');
  });
  it('marks failed ended runs red', () => {
    expect(list.ended.some((row) => row.dot === 'failed')).toBe(true);
  });
  it('titles an interactive run without a persona by its ticket', () => {
    expect(sessionTitle(i18n, { ...ben, interactive: true, persona: null })).toBe('T-0121');
  });
});

describe('sessionFacts', () => {
  const events = demoStream();
  const facts = sessionFacts(i18n, ben, demoSnapshot(), events);
  const byLabel = (label: string) => facts.find((fact) => fact.label === label);

  it('reads the fact grid', () => {
    expect(byLabel('Harness · model')?.value).toBe('claude-code · sonnet · permission auto');
    expect(byLabel('Session ref')).toMatchObject({ mono: 'e4b9…71c0', value: 'resumable' });
    expect(byLabel('Tokens')?.value).toBe('112k in (98k cached) · 4.1k out · $0.61');
    expect(byLabel('MCP')?.value).toBe('drey · 2 calls, 1 refused');
    expect(byLabel('Slot')?.value).toBe('Claude A · class B · q 1.4');
    expect(byLabel('Seats')?.value).toBe('light');
  });
  it('omits what is missing', () => {
    const bare = sessionFacts(i18n, { ...ben, permission: null, model: null, sessionRef: null, costUsd: null, slot: null, cacheReadTokens: 0 }, null, []);
    expect(bare[0]?.value).toBe('claude-code');
    expect(bare[1]).toMatchObject({ mono: null, value: '' });
    expect(bare[2]?.value).toBe('112k in · 4.1k out');
    expect(bare[3]?.value).toBe('');
  });
  it('builds the id line', () => {
    expect(idLine(i18n, ben)).toBe('R-20261107T0833-c02e · pid 19877 · origin chain · fresh');
  });
  it('lists the process facts', () => {
    const rows = processRows(i18n, ben);
    expect(rows.map((row) => row.label)).toEqual(['pid', 'State', 'Harness', 'Started', 'Ended', 'Worktree', 'Session ref', 'Origin']);
    expect(rows[0]?.value).toBe('19877');
  });
});

describe('stream rows', () => {
  const events = demoStream();
  it('maps the board 8b stream', () => {
    const rows = streamRows(i18n, events, ben);
    expect(rows.map((row) => row.kind)).toEqual([
      'system', 'user', 'assistant', 'tool', 'tool', 'tool', 'tool', 'tool', 'assistant', 'usage',
    ]);
    expect(rows[1]?.text).toBe('[instruction, 9.8k tokens — open under Instruction]');
    expect(rows[5]?.tone).toBe('error');
    expect(rows[9]?.text).toBe('turn 3 · input 41k (38k cached) · output 1.4k');
    expect(rows[0]?.time).toBe('08:33:09');
  });
  it('skips running tools, partial deltas and plain usage events', () => {
    const more: StreamEvent[] = [
      { ts: '2026-11-09T09:00:00', kind: 'tool', tool: 'Read', detail: 'running', text: 'Read x' },
      { ts: '2026-11-09T09:00:01', kind: 'text-delta', detail: 'start', text: 'par' },
      { ts: '2026-11-09T09:00:02', kind: 'text-delta', detail: 'end', text: 'whole' },
      { ts: '2026-11-09T09:00:03', kind: 'usage', tokensIn: 5 },
      { ts: '2026-11-09T09:00:04', kind: 'error', text: 'boom' },
      { ts: '2026-11-09T09:00:05', kind: 'result', text: 'done' },
    ];
    const rows = streamRows(i18n, more, null);
    expect(rows.map((row) => [row.kind, row.text])).toEqual([
      ['assistant', 'whole'],
      ['error', 'boom'],
      ['result', 'done'],
    ]);
    expect(rows[1]?.tone).toBe('error');
  });
  it('keeps only tool rows for Tool calls and one-line JSON for Raw', () => {
    expect(toolRows(i18n, events, ben)).toHaveLength(5);
    expect(rawRows(events)).toHaveLength(10);
    expect(JSON.parse(rawRows(events)[2]!)).toMatchObject({ kind: 'text' });
  });
  it('counts MCP calls, refusals and servers', () => {
    expect(mcpStats(demoStream())).toEqual({ calls: 2, refused: 1, servers: ['drey'] });
  });
});
