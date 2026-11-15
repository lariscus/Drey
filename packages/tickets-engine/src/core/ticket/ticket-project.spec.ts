import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '../../contracts/projects';
import { assembleBoard } from './ticket-board';
import { ticketProjectIssues } from './ticket-project';

/** req-282: the board's project checks of a ticket, alone and through the board's assembly. */

const project = (id: string, repos: string[]): ProjectRecord => ({ id, name: id.toUpperCase(), color: '', repos, folders: [], vaults: {}, purpose: '' });
const DREY = project('drey', ['drey']);
const LARISCUS = project('lariscus', ['lariscus']);

describe('ticketProjectIssues', () => {
  it('checks nothing on a board without projects', () => {
    expect(ticketProjectIssues({ repos: ['anything'] }, true, [])).toEqual([]);
  });

  it('reads no project: as the only project, so its repos are checked against it', () => {
    expect(ticketProjectIssues({ repos: ['drey'] }, true, [DREY])).toEqual([]);
    expect(ticketProjectIssues({ repos: ['lariscus'] }, true, [DREY])[0]?.message).toBe('repo "lariscus" is not a repo of project "DREY"');
  });

  it('lets an inbox or finished ticket stay Unassigned once there are two projects, never a working one', () => {
    expect(ticketProjectIssues({ repos: [] }, false, [DREY, LARISCUS])).toEqual([]);
    expect(ticketProjectIssues({ repos: [] }, true, [DREY, LARISCUS])[0]?.message).toBe('a working ticket needs a project (project:)');
    expect(ticketProjectIssues({ project: 'lariscus', repos: ['lariscus'] }, true, [DREY, LARISCUS])).toEqual([]);
  });

  it('reports a project the board does not know', () => {
    expect(ticketProjectIssues({ project: 'nope', repos: [] }, true, [DREY])[0]?.message).toBe('project "nope" is not in _meta/projects/');
  });
});

describe('assembleBoard with projects', () => {
  const pipelineText = '---\nphases:\n  - id: inbox\n  - id: build\n  - id: done\n---\n';
  const reposText = '---\nrepos:\n  drey:\n    url: u\n  lariscus:\n    url: v\n---\n';
  const ticket = (id: string, phase: string, extra: string): { path: string; text: string } => ({
    path: `tickets/${phase}/${id}.md`,
    text: `---\nid: ${id}\ntitle: t\npriority: normal\nentered-inbox: 2026-11-13T00:00:00Z\n${extra}---\n`,
  });
  const projectFiles = [
    { path: 'tickets/_meta/projects/drey.md', text: '---\nname: Drey\nrepos: [drey]\n---\nThe app.\n' },
    { path: 'tickets/_meta/projects/lariscus.md', text: '---\nname: Lariscus\nrepos: [lariscus]\n---\n' },
  ];
  const board = (files: { path: string; text: string }[], projects = projectFiles) =>
    assembleBoard({ vaultId: 'v', vaultName: 'v', activeVaultName: null, isGitRepo: false, defaultWorker: 'opencode', pipelineText, reposText, projectFiles: projects, files });
  const issuesOf = (snap: ReturnType<typeof board>, id: string): string[] =>
    snap.columns.flatMap((c) => c.tickets).find((t) => t.id === id)!.issues.map((i) => i.message);

  it('carries the projects and the project field, and badges a working ticket without one', () => {
    const snap = board([ticket('T-0001', 'inbox', ''), ticket('T-0002', 'build', 'repos: [drey]\n'), ticket('T-0003', 'build', 'project: drey\nrepos: [drey]\n')]);
    expect(snap.projects?.map((p) => [p.id, p.purpose])).toEqual([['drey', 'The app.'], ['lariscus', '']]);
    expect(issuesOf(snap, 'T-0001')).not.toContain('a working ticket needs a project (project:)');
    expect(issuesOf(snap, 'T-0002')).toContain('a working ticket needs a project (project:)');
    expect(snap.columns[1]!.tickets.find((t) => t.id === 'T-0003')!.meta.project).toBe('drey');
    expect(issuesOf(snap, 'T-0003')).toEqual([]);
  });

  it('leaves a board without project records as it was', () => {
    const snap = board([ticket('T-0002', 'build', 'repos: [drey]\n')], []);
    expect(snap.projects).toBeUndefined();
    expect(issuesOf(snap, 'T-0002')).toEqual([]);
  });
});
