import { describe, expect, it } from 'vitest';
import { i18n } from './i18n';
import { trancheCardOf, trancheChipsOf, trancheProgressOf, trancheViewOf, type TrancheFormat } from './tranche';

const f: TrancheFormat = {
  t: (key, params) => i18n.t(key, params),
  money: (usd) => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`),
  personaName: (id) => id.charAt(0).toUpperCase() + id.slice(1),
};

/** Board 10t's On sample: tranche 4 of 10 runs, $4.10 of $15, 2 h 10 min left. */
const ON = { index: 1, of: 3, done: 4, total: 10, spent: 4.1, budget: 5, startedAt: '2026-11-09T12:00:00.000Z', endsAt: '2026-11-09T16:00:00.000Z', checkpoint: null, report: null };
const NOW = new Date('2026-11-09T13:50:00.000Z');

/** Board 10u part 1. */
const REPORT = {
  kind: 'end',
  at: '2026-11-09T14:02:00.000Z',
  endedBy: 'runs',
  runs: 10,
  spent: 4.1,
  minutes: 130,
  gates: { green: 7, total: 8 },
  change: { added: 212, removed: 40 },
  cost: { median: 0.41, max: 1.2 },
  repeated: { ticket: 'T-0119', runs: 2 },
  earlyStop: null,
};

describe('trancheViewOf', () => {
  it('reads the chain block and nothing without one', () => {
    expect(trancheViewOf({ tranche: ON })).toMatchObject({ index: 1, done: 4, total: 10, checkpoint: null, report: null });
    expect(trancheViewOf({})).toBeNull();
    expect(trancheViewOf(null)).toBeNull();
    expect(trancheViewOf({ tranche: { index: 'x' } })).toBeNull();
  });

  it('keeps the report only while the checkpoint waits', () => {
    expect(trancheViewOf({ tranche: { ...ON, checkpoint: 'waiting', report: REPORT } })?.report).toMatchObject({ runs: 10, gates: { green: 7, total: 8 } });
    expect(trancheViewOf({ tranche: { ...ON, checkpoint: null, report: REPORT } })?.report).toBeNull();
  });
});

describe('the popover chips', () => {
  it("says board 10t's words", () => {
    const view = trancheViewOf({ tranche: ON })!;
    expect(trancheChipsOf(view, NOW, f.t)).toEqual({ runs: 'Tranche 4 of 10 runs', left: '2 h 10 min left' });
    expect(trancheChipsOf({ ...view, endsAt: null, total: null }, NOW, f.t)).toEqual({ runs: 'Tranche 1 · 4 runs', left: null });
  });

  it('fills the bar to the limit nearest its end', () => {
    const view = trancheViewOf({ tranche: ON })!;
    expect(trancheProgressOf(view, NOW)).toBeCloseTo(0.82); // $4.10 of $5 beats 4 of 10 and 110 of 240 min
    expect(trancheProgressOf({ ...view, budget: null, endsAt: null }, NOW)).toBeCloseTo(0.4);
  });
});

describe('trancheCardOf', () => {
  it('draws the checkpoint card of board 10u part 1', () => {
    const card = trancheCardOf(trancheViewOf({ tranche: { ...ON, done: 10, checkpoint: 'waiting', report: REPORT } })!, f);
    expect(card).toMatchObject({ kind: 'checkpoint', tone: 'attention', title: 'Checkpoint · tranche 1 of 3 done', body: null, summary: 'Autopilot paused · 10 runs · $4.10 · 2 h 10 min' });
    expect(card?.metrics).toEqual([
      { label: 'Gate rate', value: '7 of 8', sub: 'green', inline: true },
      { label: 'Change size', value: '+212 −40', sub: 'median lines', inline: false },
      { label: 'Cost per run', value: '$0.41', sub: 'median · $1.20 max', inline: false },
      { label: 'Repeated', value: 'T-0119', sub: 'ran twice', inline: true },
    ]);
    expect(card?.actions.map((a) => a.label)).toEqual(['Release next tranche', 'Adjust…']);
  });

  it('draws the early stop of board 10u part 6', () => {
    const early = {
      ...REPORT,
      kind: 'early',
      endedBy: null,
      earlyStop: {
        rule: 'gate_rate',
        red: 3,
        window: 6,
        runsLeft: 6,
        ticket: null,
        value: null,
        median: null,
        tickets: [
          { ticket: 'T-0119', phase: 'build', persona: 'ben', red: 2 },
          { ticket: 'T-0124', phase: 'test', persona: 'tessa', red: 1 },
          { ticket: 'T-0125', phase: 'review', persona: 'ralf', red: 1 },
        ],
      },
    };
    const view = trancheViewOf({ tranche: { ...ON, checkpoint: 'waiting', report: early } })!;
    const card = trancheCardOf(view, f);
    expect(card).toMatchObject({ kind: 'early', tone: 'negative', title: 'Stopped early · gate rate fell', summary: null, metrics: [] });
    expect(card?.body).toBe('3 of the last 6 gates were red; the tranche had 6 runs left. Nothing new starts until you release it.');
    expect(card?.rows).toEqual(['T-0119 · build · Ben · red twice', 'T-0124 · test · Tessa', 'T-0125 · review · Ralf']);
    expect(card?.actions.map((a) => a.label)).toEqual(['Open report', 'Release anyway']);
    expect(trancheCardOf(view, f, true)?.metrics).toHaveLength(4);
  });

  it('draws nothing while no checkpoint waits', () => {
    expect(trancheCardOf(trancheViewOf({ tranche: ON })!, f)).toBeNull();
  });
});
