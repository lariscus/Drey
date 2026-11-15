import { describe, expect, it } from 'vitest';
import { ticketProject, ticketProjectId } from '../../contracts/projects';
import { parseProjectFile, parseProjects, projectFileText, projectIdOf, projectIdOfPath } from './project-record';
import { planProjectMigration } from './project-migration';

/** req-282: the project record, its canonical text, the ticket's project and the first project's plan. */

const DREY = `---
name: Drey
color: "#8ECBEF"
repos: [drey, shared-lib]
folders:
  - E:/specs
vaults:
  Drey notes: write
  Work notes: read
  Private: none
---
A local, topic-based note app and its Crew.
`;

describe('parseProjectFile', () => {
  it('reads every key and the body as the purpose', () => {
    const { project, warnings } = parseProjectFile('drey', DREY);
    expect(warnings).toEqual([]);
    expect(project).toEqual({
      id: 'drey',
      name: 'Drey',
      color: '#8ecbef',
      repos: ['drey', 'shared-lib'],
      folders: ['E:/specs'],
      vaults: { 'Drey notes': 'write', 'Work notes': 'read', Private: 'none' },
      purpose: 'A local, topic-based note app and its Crew.',
    });
  });

  it('tolerates what does not parse: the name falls back to the id, a bad access reads as none, each with a warning', () => {
    const { project, warnings } = parseProjectFile('x', '---\ncolor: red\nvaults:\n  Notes: admin\n---\n');
    expect(project).toMatchObject({ name: 'x', color: '', repos: [], vaults: { Notes: 'none' }, purpose: '' });
    expect(warnings).toHaveLength(2);
    expect(parseProjectFile('y', 'no fence').warnings[0]).toContain('no frontmatter fence');
  });

  it('round-trips byte-stable through the canonical text', () => {
    const text = projectFileText(parseProjectFile('drey', DREY).project);
    expect(parseProjectFile('drey', text).project).toEqual(parseProjectFile('drey', DREY).project);
    expect(projectFileText(parseProjectFile('drey', text).project)).toBe(text);
    expect(text).toContain('Drey notes: write');
  });
});

describe('parseProjects and the paths', () => {
  it('reads the project files only, sorted by id, and warns about a stray name', () => {
    const parsed = parseProjects([
      { path: 'tickets/_meta/projects/zeta.md', text: '---\nname: Zeta\n---\n' },
      { path: 'tickets/_meta/projects/drey.md', text: DREY },
      { path: 'tickets/_meta/projects/Bad Name.md', text: '---\n---\n' },
      { path: 'tickets/_meta/repos.md', text: '---\n---\n' },
    ]);
    expect(parsed.projects.map((p) => p.id)).toEqual(['drey', 'zeta']);
    expect(parsed.warnings).toHaveLength(1);
    expect(projectIdOfPath('tickets/_meta/projects/a-1.md')).toBe('a-1');
    expect(projectIdOfPath('tickets/_meta/projects/sub/a.md')).toBeNull();
    expect(projectIdOf('Drey Notes & Co.')).toBe('drey-notes-co');
  });
});

describe('ticketProjectId', () => {
  const one = [{ id: 'drey' }];
  const two = [{ id: 'drey' }, { id: 'lariscus' }];

  it('reads a ticket without project: as the only project, and as Unassigned once there are two', () => {
    expect(ticketProjectId(undefined, one)).toBe('drey');
    expect(ticketProjectId(null, two)).toBeNull();
    expect(ticketProjectId('', [])).toBeNull();
  });

  it('keeps a named project, known or not; ticketProject resolves only a known one', () => {
    expect(ticketProjectId('lariscus', one)).toBe('lariscus');
    expect(ticketProject('lariscus', one)).toBeNull();
    expect(ticketProject('lariscus', two)).toEqual({ id: 'lariscus' });
  });
});

describe('planProjectMigration', () => {
  const vaults = [
    { id: 'v1', name: 'Drey notes', path: '/a', active: true },
    { id: 'v2', name: 'Work notes', path: '/b', active: false },
  ];

  it('names the project after the first repo, holds every repo and every vault as read, lifts write-vaults to write', () => {
    const plan = planProjectMigration({
      repos: ['drey', 'lariscus'],
      vaults,
      personas: [
        { id: 'ben', writeVaults: ['v1', 'v9'] },
        { id: 'ralf', writeVaults: [] },
      ],
      fallbackName: 'drey-tickets',
    });
    expect(plan.project).toMatchObject({ id: 'drey', name: 'drey', repos: ['drey', 'lariscus'], folders: [], vaults: { 'Drey notes': 'write', 'Work notes': 'read' }, purpose: '' });
    expect(plan.writeNotes).toEqual(['ben']);
    expect(plan.unresolved).toEqual([{ persona: 'ben', vaultId: 'v9' }]);
  });

  it('falls back to the tickets vault name without repos', () => {
    expect(planProjectMigration({ repos: [], vaults: [], personas: [], fallbackName: 'My Board' }).project).toMatchObject({ id: 'my-board', name: 'My Board', repos: [] });
  });
});
