import { describe, expect, it } from 'vitest';
import { isLifecycleStore, parseStoreStages } from './store-stages';

const OLD = [
  '# dricket.toml - the protected configuration of this ticket store.',
  'schema_version = 1',
  '',
  '[priorities]',
  'values = ["critical", "high", "normal", "low"]   # allowed',
  'default = "normal"',
  '',
  '[stages]',
  'values = ["inbox", "shaping", "prioritized", "building", "ready", "done"]',
  'initial = "inbox"',
  'terminal = ["done"]',
  'claim = ["building"]',
  'cancelled = "cancelled"',
  '',
  '[security]',
  'admins = []',
  '',
].join('\n');

const LIFECYCLE = { values: ['inbox', 'prioritized', 'active', 'running', 'done'], initial: 'inbox', terminal: ['done'], claim: ['running'], cancelled: 'cancelled' };

describe('the store stage vocabulary (req-265)', () => {
  it('reads [stages], other tables aside', () => {
    expect(parseStoreStages(OLD)).toEqual({
      values: ['inbox', 'shaping', 'prioritized', 'building', 'ready', 'done'],
      initial: 'inbox',
      terminal: ['done'],
      claim: ['building'],
      cancelled: 'cancelled',
    });
    expect(parseStoreStages('schema_version = 1\n')).toBeNull();
  });

  it('tells a lifecycle store from one on phase stages', () => {
    expect(isLifecycleStore(parseStoreStages(OLD))).toBe(false);
    expect(isLifecycleStore(LIFECYCLE)).toBe(true);
    expect(isLifecycleStore(null)).toBe(false);
  });
});
