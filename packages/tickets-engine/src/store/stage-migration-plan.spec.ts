import { describe, expect, it } from 'vitest';
import { planStageMigration, type StagePlanRecord } from './stage-migration-plan';
import type { StoreStageSet } from './store-stages';

const OLD: StoreStageSet = {
  values: ['inbox', 'shaping', 'prioritized', 'building', 'ready', 'done'],
  initial: 'inbox',
  terminal: ['done'],
  claim: ['building'],
  cancelled: 'cancelled',
};
const BRIDGE: StoreStageSet = { ...OLD, values: ['inbox', 'prioritized', 'shaping', 'building', 'ready', 'active', 'running', 'done'], claim: ['running'] };
const LIFECYCLE: StoreStageSet = { ...OLD, values: ['inbox', 'prioritized', 'active', 'running', 'done'], claim: ['running'] };

const rec = (id: string, stage: string, over: Partial<StagePlanRecord> = {}): StagePlanRecord => ({ id, stage, owner: null, extensions: {}, ...over });

describe('the stage migration plan (req-265, concept §12 steps 1–2)', () => {
  it('a store on the six phase stages: add, move every ticket out of an old stage, remove', () => {
    const plan = planStageMigration(OLD, [rec('t-1', 'building'), rec('t-2', 'inbox'), rec('t-3', 'ready'), rec('t-4', 'done')]);
    expect(plan).toEqual({
      kind: 'needed',
      add: BRIDGE,
      moves: [
        { id: 't-1', from: 'building', pin: 'building' },
        { id: 't-3', from: 'ready', pin: 'ready' },
      ],
      remove: LIFECYCLE,
      legacy: ['shaping', 'building', 'ready'],
      claimed: [],
    });
  });

  it('resumes after step 1: no add, the moves left and the removal', () => {
    const plan = planStageMigration(BRIDGE, [rec('t-1', 'active'), rec('t-3', 'ready')]);
    expect(plan.kind === 'needed' && plan.add).toBeNull();
    expect(plan.kind === 'needed' && plan.moves.map((m) => m.id)).toEqual(['t-3']);
    expect(plan.kind === 'needed' && plan.remove).toEqual(LIFECYCLE);
  });

  it('a migrated store plans nothing; a store without inbox/done or without [stages] is left alone', () => {
    expect(planStageMigration(LIFECYCLE, [rec('t-1', 'active')])).toEqual({ kind: 'none' });
    expect(planStageMigration(null, [rec('t-1', 'open')])).toEqual({ kind: 'none' });
    expect(planStageMigration({ ...OLD, values: ['open', 'build', 'closed'] }, [])).toEqual({ kind: 'none' });
  });

  it('keeps a pin a ticket already has, keeps the park stages, and names claimed tickets', () => {
    const withPark: StoreStageSet = { ...OLD, values: [...OLD.values.slice(0, -1), 'blocked', 'done'] };
    const plan = planStageMigration(withPark, [rec('t-1', 'building', { extensions: { 'x-phase': 'ready' }, owner: 'agent-r-1@h' })]);
    expect(plan.kind === 'needed' && plan.moves).toEqual([{ id: 't-1', from: 'building', pin: 'ready' }]);
    expect(plan.kind === 'needed' && plan.remove?.values).toEqual(['inbox', 'prioritized', 'active', 'running', 'blocked', 'done']);
    expect(plan.kind === 'needed' && plan.claimed).toEqual([{ id: 't-1', owner: 'agent-r-1@h' }]);
  });
});
