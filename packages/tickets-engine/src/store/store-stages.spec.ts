import { describe, expect, it } from 'vitest';
import { isLifecycleStore, parseStoreStages, renderStageTable, withStageTable, writePlacement } from './store-stages';

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

  it('replaces the [stages] table and keeps every other line, the CRLF ending included', () => {
    const next = withStageTable(OLD, LIFECYCLE);
    expect(parseStoreStages(next)).toEqual(LIFECYCLE);
    expect(next).toContain('# dricket.toml - the protected configuration');
    expect(next).toContain('values = ["critical", "high", "normal", "low"]   # allowed');
    expect(next).toContain('[security]\nadmins = []');
    expect(next.endsWith('\n')).toBe(true);
    const crlf = withStageTable(OLD.replace(/\n/g, '\r\n'), LIFECYCLE);
    expect(crlf).toContain('[stages]\r\nvalues = ["inbox", "prioritized", "active", "running", "done"]\r\n');
    expect(crlf.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('appends a table to a config that has none', () => {
    const next = withStageTable('schema_version = 1\n', LIFECYCLE);
    expect(next).toBe(`schema_version = 1\n\n${renderStageTable(LIFECYCLE)}\n`);
  });

  it('places a board write: lifecycle store by column, phase store by the phase id (a pin kept in step)', () => {
    expect(writePlacement('building', LIFECYCLE, '')).toEqual({ stage: 'active', pin: null });
    expect(writePlacement('prioritized', LIFECYCLE, '')).toEqual({ stage: 'prioritized', pin: null });
    expect(writePlacement('building', parseStoreStages(OLD), '---\nstage: inbox\n---\n')).toEqual({ stage: 'building' });
    expect(writePlacement('building', null, '---\nstage: open\nx-phase: inbox\n---\n')).toEqual({ stage: 'building', pin: 'building' });
  });
});
