import { describe, expect, it } from 'vitest';
import { isLifecycleStageSet, LIFECYCLE_STAGE_IDS, stageOfPhase, stayPutStagesOf } from './lifecycle-stages';

describe('the lifecycle stages (req-265)', () => {
  it('are inbox prioritized active running done, in board order', () => {
    expect(LIFECYCLE_STAGE_IDS).toEqual(['inbox', 'prioritized', 'active', 'running', 'done']);
  });

  it('place an edge column as its own stage and every other column as active, with no pin (req-257)', () => {
    expect(stageOfPhase('inbox')).toBe('inbox');
    expect(stageOfPhase('prioritized')).toBe('prioritized');
    expect(stageOfPhase('done')).toBe('done');
    expect(stageOfPhase('shaping')).toBe('active');
    expect(stageOfPhase('building')).toBe('active');
    expect(stageOfPhase('ready')).toBe('active');
  });

  it('recognise a lifecycle store only with active, running and running as the one claim stage', () => {
    expect(isLifecycleStageSet(LIFECYCLE_STAGE_IDS, ['running'])).toBe(true);
    expect(isLifecycleStageSet(['inbox', 'shaping', 'prioritized', 'building', 'ready', 'done'], ['building'])).toBe(false);
    expect(isLifecycleStageSet([...LIFECYCLE_STAGE_IDS, 'building'], ['building'])).toBe(false);
  });

  it('hand a run that moves nothing back where it sat, the claim stage itself to active', () => {
    expect(stayPutStagesOf('active')).toEqual(['active']);
    expect(stayPutStagesOf('running')).toEqual(['active']);
    expect(stayPutStagesOf(null)).toEqual(['active']);
    expect(stayPutStagesOf('inbox')).toEqual(['inbox', 'active']);
  });
});
