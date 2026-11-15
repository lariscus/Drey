import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';
import { captureProjectOf, chipOf, inScope, scopeOptionsOf } from './project-scope';

const project = (id: string, over: Partial<ProjectRecord> = {}): ProjectRecord => ({ id, name: id[0]!.toUpperCase() + id.slice(1), color: '', repos: [], folders: [], vaults: {}, purpose: '', ...over });
const DREY = project('drey', { color: '#8ecbef', folders: ['E:\\specs\\drey-shared'], vaults: { 'Drey notes': 'write', 'Work notes': 'read', Private: 'none' } });
const LARISCUS = project('lariscus', { color: '#f2cfae' });
const tickets = [{ meta: { project: 'drey' } }, { meta: {} }, { meta: { project: 'lariscus' } }, { meta: { project: 'gone' } }];

describe('the project filter (req-285, one active project since req-308)', () => {
  it('offers each project with its readable vaults and folders, and nothing else', () => {
    const options = scopeOptionsOf([DREY, LARISCUS]);
    expect(options[0]).toEqual({
      id: 'drey',
      label: 'Drey',
      color: '#8ecbef',
      sources: { vaults: [{ name: 'Drey notes', readOnly: false }, { name: 'Work notes', readOnly: true }], folders: ['E:\\specs\\drey-shared'] },
    });
    expect(options.map((o) => o.id)).toEqual(['drey', 'lariscus']);
    expect(scopeOptionsOf([DREY])).toHaveLength(1);
  });

  it('shows only the chosen project’s tickets; a ticket without one, or of a project the board no longer has, stays hidden', () => {
    const projects = [DREY, LARISCUS];
    expect(tickets.filter((t) => inScope(t, { id: 'drey' }, projects))).toEqual([tickets[0]]);
    expect(tickets.filter((t) => inScope(t, { id: 'lariscus' }, projects))).toEqual([tickets[2]]);
    expect(tickets.filter((t) => inScope(t, null, projects))).toHaveLength(4);
  });

  it('names a ticket’s own project from two projects on, none on a board with one', () => {
    expect(chipOf(tickets[0]!, [DREY, LARISCUS])).toEqual({ label: 'Drey', color: '#8ecbef' });
    expect(chipOf(tickets[2]!, [DREY, LARISCUS])).toEqual({ label: 'Lariscus', color: '#f2cfae' });
    expect(chipOf(tickets[1]!, [DREY, LARISCUS])).toBeNull();
    expect(chipOf(tickets[3]!, [DREY, LARISCUS])).toBeNull();
    expect(chipOf(tickets[0]!, [DREY])).toBeNull();
  });

  it('lands a capture in the chosen project', () => {
    expect(captureProjectOf({ id: 'drey' })).toBe('drey');
    expect(captureProjectOf(null)).toBeUndefined();
  });
});
