import { describe, expect, it } from 'vitest';
import * as engine from '../../../../packages/tickets-engine/src/contracts/persona-board';
import { chainCellsOf, holdBadgeOf, holdLiveOf, holdOf, holdStatusOf, laneLoadOf, lanesOf, type HoldLive, type McHold, type McLane } from './hold';

const base: McHold = { holder: 'ben', why: 'entry', position: 3, length: 6, chain: ['paul', 'paul', 'ben', 'ralf', 'tessa', 'you'], mode: null, named: null, claimed: false, sentBack: null, questions: 0 };
const live = (patch: Partial<HoldLive> = {}): HoldLive => ({ running: false, minutes: null, activity: null, queued: null, waitsFor: null, held: false, ...patch });

/** One table both copies run against: the lib's copy may not drift from the engine's. */
const HOLDS: readonly McHold[] = [
  base,
  { ...base, sentBack: { from: 5, to: 3 } },
  { ...base, position: 4, sentBack: { from: 5, to: 3 } },
  { ...base, holder: 'you', why: 'question', named: 'ben', questions: 2 },
  { ...base, holder: 'you', why: 'second-send-back', position: 4 },
  { ...base, holder: 'you', why: 'no-persona', position: 4 },
  { ...base, holder: 'you', position: 6 },
  { ...base, holder: 'you', position: 2 },
  { ...base, holder: 'paul', position: 1, mode: 'shape' },
  { ...base, holder: 'pia', position: 1 },
];
const LIVES: readonly HoldLive[] = [live(), live({ running: true, minutes: 4 }), live({ running: true, activity: 'merging main · 2 files' }), live({ queued: 'waits for a B slot' }), live({ waitsFor: 'ben' }), live({ held: true })];
const kindOf = (persona: string): McLane['kind'] | null => (persona === 'you' ? 'human' : persona === 'pia' ? 'mission' : persona === 'ghost' ? null : 'agent');

describe('the lib copy of the persona board helpers', () => {
  it('agrees with the engine on cells, badges and statuses', () => {
    for (const hold of HOLDS) {
      expect(chainCellsOf(hold)).toEqual(engine.chainCellsOf(hold));
      expect(holdBadgeOf(hold)).toEqual(engine.holdBadgeOf(hold));
      for (const now of LIVES) {
        expect(holdStatusOf(hold, now, kindOf)).toEqual(engine.holdStatusOf(hold, now, kindOf));
      }
    }
  });

  it('agrees on the column load', () => {
    const lane: McLane = { persona: 'ben', title: 'Ben', kind: 'agent', color: '', parallel: 2, min: 0 };
    for (const [running, waiting] of [[0, 0], [2, 1], [3, 0]] as const) {
      expect(laneLoadOf(lane, running, waiting)).toEqual(engine.laneLoadOf(lane, running, waiting));
      expect(laneLoadOf({ ...lane, kind: 'human' }, running, waiting)).toEqual(engine.laneLoadOf({ ...lane, kind: 'human' }, running, waiting));
    }
  });
});

describe('tolerant reads', () => {
  it('reads lanes and holds, junk drops out', () => {
    expect(lanesOf({})).toBeNull();
    expect(lanesOf({ lanes: [{ persona: 'ben', title: 'Ben', kind: 'agent', color: '#fff', parallel: 2, min: 1 }, { title: 'no id' }] })).toEqual([{ persona: 'ben', title: 'Ben', kind: 'agent', color: '#fff', parallel: 2, min: 1 }]);
    expect(holdOf({ hold: { holder: 'ben', position: 0, length: 6 } })).toBeNull();
    expect(holdOf({ hold: { ...base, why: 'nonsense', sentBack: { from: 'x' } } })).toEqual({ ...base });
  });

  it('folds the runs and the chain block into the live half', () => {
    const now = Date.parse('2026-11-13T14:10:00Z');
    const runs = [{ ticketId: 'T-1', state: 'running', startedAt: '2026-11-13T14:00:00Z', activity: 'merging main' }, { ticketId: 'T-2', state: 'done' }];
    expect(holdLiveOf('T-1', runs, null, now)).toEqual(live({ running: true, minutes: 10, activity: 'merging main' }));
    expect(holdLiveOf('T-2', runs, { personaWaits: { 'T-2': 'ben' }, queued: { 'T-2': 'waits for a B slot' } }, now)).toEqual(live({ waitsFor: 'ben', queued: 'waits for a B slot' }));
  });
});
