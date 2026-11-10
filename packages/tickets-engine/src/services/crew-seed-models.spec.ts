import { describe, expect, it } from 'vitest';
import { CrewSeedModels } from './crew-seed-models';
import { modelRow } from './crew-seeder-rig.fake';

const rule = new CrewSeedModels();
const TABLE = [modelRow('small', 'opencode', 'C'), modelRow('big', 'opencode', 'A'), modelRow('mid', 'opencode', 'B'), modelRow('other', 'claude-code', 'A'), modelRow('mid2', 'opencode', 'B'), modelRow('big', 'opencode', 'A')];

describe('CrewSeedModels — the models a seeded persona gets (req-256)', () => {
  it('takes the worker\'s provider rows, strongest class first, the table\'s order within a class, each model once', () => {
    expect(rule.pick('opencode', TABLE)).toEqual({ default: 'big', pool: ['big', 'mid', 'mid2', 'small'] });
    expect(rule.pick('claude-code', TABLE)).toEqual({ default: 'other', pool: ['other'] });
  });

  it('puts a model the worker pins first when the table holds it, and ignores one it does not', () => {
    expect(rule.pick('opencode/mid2', TABLE)).toEqual({ default: 'mid2', pool: ['mid2', 'big', 'mid', 'small'] });
    expect(rule.pick('opencode/ghost', TABLE)).toEqual({ default: 'big', pool: ['big', 'mid', 'mid2', 'small'] });
  });

  it('has no models without a table, without rows for the provider, or for a worker that is no provider', () => {
    expect(rule.pick('opencode', null)).toBeNull();
    expect(rule.pick('opencode', [])).toBeNull();
    expect(rule.pick('kimi', TABLE)).toBeNull();
    expect(rule.pick('api', TABLE)).toBeNull();
  });
});
