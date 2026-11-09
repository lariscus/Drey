import { describe, expect, it } from 'vitest';
import { ChangeCollector } from './change-collector';

describe('ChangeCollector (req-213)', () => {
  const folder = (id: string): string => `/v/${id}`;

  it('reports nothing when nothing was touched', () => {
    expect(new ChangeCollector().changes(folder)).toEqual([]);
  });

  it('reports one change per vault with the folder resolved', () => {
    const collector = new ChangeCollector();
    collector.add('notes', ['a.md'], []);
    collector.add('work', ['w.md'], ['old.md']);
    expect(collector.changes(folder)).toEqual([
      { vaultPath: '/v/notes', changed: ['a.md'], deleted: [] },
      { vaultPath: '/v/work', changed: ['w.md'], deleted: ['old.md'] },
    ]);
  });

  it('keeps the last state of a path', () => {
    const collector = new ChangeCollector();
    collector.add('notes', ['a.md'], []);
    collector.add('notes', [], ['a.md']);
    collector.add('notes', ['b.md'], ['c.md']);
    collector.add('notes', ['c.md'], []);
    expect(collector.changes(folder)).toEqual([{ vaultPath: '/v/notes', changed: ['b.md', 'c.md'], deleted: ['a.md'] }]);
  });

  it('a move is the new path changed and the old one deleted', () => {
    const collector = new ChangeCollector();
    collector.addMove('work', 'w.md', 'sub/w.md');
    expect(collector.changes(folder)).toEqual([{ vaultPath: '/v/work', changed: ['sub/w.md'], deleted: ['w.md'] }]);
  });
});
