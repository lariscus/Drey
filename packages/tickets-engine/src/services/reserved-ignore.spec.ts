import { describe, expect, it } from 'vitest';
import { reservedIgnoreEntries, withIgnoreEntries } from './reserved-ignore';

describe('reserved-ignore — the tickets repo ignores _worktrees/ and _workcopy/ (ADR-0080, req-183)', () => {
  it('names both folders, under the tickets repo prefix', () => {
    expect(reservedIgnoreEntries('')).toEqual(['/_worktrees/', '/_workcopy/']);
    expect(reservedIgnoreEntries('meta/')).toEqual(['/meta/_worktrees/', '/meta/_workcopy/']);
  });

  it('a new file gets both entries', () => {
    expect(withIgnoreEntries(null, reservedIgnoreEntries(''))).toBe('/_worktrees/\n/_workcopy/\n');
  });

  it('an older board that ignores only _worktrees/ gains _workcopy/', () => {
    expect(withIgnoreEntries('node_modules\n/_worktrees/', reservedIgnoreEntries(''))).toBe('node_modules\n/_worktrees/\n/_workcopy/\n');
  });

  it('nothing to do when both are there', () => {
    expect(withIgnoreEntries('/_workcopy/\r\n/_worktrees/\r\n', reservedIgnoreEntries(''))).toBeNull();
  });
});
