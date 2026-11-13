import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';
import { captureProjectOf, chipOf, inScope, scopeOptionsOf, UNASSIGNED_SCOPE } from './project-scope';

const project = (id: string, over: Partial<ProjectRecord> = {}): ProjectRecord => ({ id, name: id[0]!.toUpperCase() + id.slice(1), color: '', repos: [], folders: [], vaults: {}, purpose: '', ...over });
const DREY = project('drey', { color: '#8ecbef', folders: ['E:\\specs\\drey-shared'], vaults: { 'Drey notes': 'write', 'Work notes': 'read', Private: 'none' } });
const LARISCUS = project('lariscus', { color: '#f2cfae' });
const tickets = [{ meta: { project: 'drey' } }, { meta: {} }, { meta: { project: 'lariscus' } }, { meta: {} }];

describe('the project filter (req-285)', () => {
  it('offers each project with its readable vaults and folders, then Unassigned with its count', () => {
    const options = scopeOptionsOf([DREY, LARISCUS], tickets, 'Unassigned');
    expect(options[0]).toEqual({
      id: 'drey',
      label: 'Drey',
      color: '#8ecbef',
      sources: { vaults: [{ name: 'Drey notes', readOnly: false }, { name: 'Work notes', readOnly: true }], folders: ['E:\\specs\\drey-shared'] },
    });
    expect(options[1]!.color).toBe('#f2cfae');
    expect(options[2]).toEqual({ id: UNASSIGNED_SCOPE, label: 'Unassigned', color: '', count: 2, sources: null });
  });

  it('has no Unassigned choice on a board with exactly one project (every ticket is its)', () => {
    expect(scopeOptionsOf([DREY], tickets, 'Unassigned').map((o) => o.id)).toEqual(['drey']);
  });

  it('shows a project’s tickets, the unassigned ones, or all', () => {
    const projects = [DREY, LARISCUS];
    expect(tickets.filter((t) => inScope(t, { id: 'drey' }, projects))).toEqual([tickets[0]]);
    expect(tickets.filter((t) => inScope(t, { id: UNASSIGNED_SCOPE }, projects))).toEqual([tickets[1], tickets[3]]);
    expect(tickets.filter((t) => inScope(t, null, projects))).toHaveLength(4);
  });

  it('gives a card its project chip only under All projects on a board with several projects', () => {
    expect(chipOf(tickets[0]!, null, [DREY, LARISCUS])).toEqual({ label: 'Drey', color: '#8ecbef' });
    expect(chipOf(tickets[1]!, null, [DREY, LARISCUS])).toBeNull();
    expect(chipOf(tickets[0]!, { id: 'drey' }, [DREY, LARISCUS])).toBeNull();
    expect(chipOf(tickets[0]!, null, [DREY])).toBeNull();
  });

  it('lands a capture in the filtered project, in none under All or Unassigned', () => {
    expect(captureProjectOf({ id: 'drey' })).toBe('drey');
    expect(captureProjectOf(null)).toBeUndefined();
    expect(captureProjectOf({ id: UNASSIGNED_SCOPE })).toBeUndefined();
  });
});
