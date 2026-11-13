import { describe, expect, it } from 'vitest';
import type { ProjectDraft } from '../contracts/project-commands';
import { parseProjectFile } from '../core/project-record';
import { parseRepos } from '../core/repos-file';
import type { EngineVault } from './host';
import { ProjectService } from './project-service';
import type { SkillFileSystem } from './skill-file-system';

const VAULT: EngineVault = { id: 'v1', name: 'tickets', path: '/t', exists: true, active: true };
const REPOS = '---\nrepos:\n  drey:\n    url: https://example.com/drey.git\n---\nRepositories.\n';

function rig(files: Record<string, string> = {}) {
  const disk = new Map(Object.entries(files));
  const commits: { paths: readonly string[]; message: string }[] = [];
  let changed = 0;
  const fs: SkillFileSystem = {
    readText: (rel) => Promise.resolve(disk.get(rel) ?? null),
    list: () => Promise.resolve([]),
    files: () => Promise.resolve([]),
    writeFile: (rel, data) => (disk.set(rel, String(data)), Promise.resolve()),
    remove: (rel) => (disk.delete(rel), Promise.resolve()),
  };
  const service = new ProjectService({
    board: { detect: () => Promise.resolve(VAULT) },
    host: {
      read: (_v, p) => (disk.has(p) ? Promise.resolve(disk.get(p)!) : Promise.reject(new Error('ENOENT'))),
      write: (_v, p, text) => (disk.set(p, text), Promise.resolve()),
      listMarkdownFiles: () => Promise.resolve([...disk.keys()].filter((p) => p.endsWith('.md'))),
      announceChanges: () => undefined,
      log: () => undefined,
    },
    git: {
      locate: () => Promise.resolve({ root: '/t', prefix: '' }),
      commitTree: (_root, paths, message) => (commits.push({ paths, message }), Promise.resolve()),
    },
    fsFor: () => fs,
    changed: () => {
      changed += 1;
    },
  });
  return { service, disk, commits, changedCount: () => changed };
}

const draft = (over: Partial<ProjectDraft> = {}): ProjectDraft => ({ name: 'Drey', color: '#8ecbef', repos: ['drey'], folders: [], vaults: { 'Drey notes': 'write' }, purpose: 'A note app.', ...over });

describe('ProjectService (req-284)', () => {
  it('creates a record with an id from its name, one commit', async () => {
    const r = rig();
    const reply = await r.service.projectSave({ project: draft() });
    expect(reply).toEqual({ ok: true, id: 'drey' });
    const saved = parseProjectFile('drey', r.disk.get('tickets/_meta/projects/drey.md')!).project;
    expect(saved).toMatchObject({ name: 'Drey', color: '#8ecbef', repos: ['drey'], vaults: { 'Drey notes': 'write' }, purpose: 'A note app.' });
    expect(r.commits).toEqual([{ paths: ['tickets/_meta/projects/drey.md'], message: 'projects: Drey created (req-284)' }]);
    expect(r.changedCount()).toBe(1);
  });

  it('mints a free id when the name is taken', async () => {
    const r = rig({ 'tickets/_meta/projects/drey.md': '---\nname: Drey\nrepos: []\n---\n' });
    expect(await r.service.projectSave({ project: draft() })).toEqual({ ok: true, id: 'drey-2' });
  });

  it('rewrites an existing record and keeps its id when the name changes', async () => {
    const r = rig({ 'tickets/_meta/projects/drey.md': '---\nname: Drey\nrepos: []\n---\n' });
    expect(await r.service.projectSave({ id: 'drey', project: draft({ name: 'Drey app' }) })).toEqual({ ok: true, id: 'drey' });
    expect(parseProjectFile('drey', r.disk.get('tickets/_meta/projects/drey.md')!).project.name).toBe('Drey app');
    expect(r.commits[0]!.message).toBe('projects: Drey app changed (req-284)');
  });

  it('commits nothing when the text is unchanged', async () => {
    const r = rig();
    await r.service.projectSave({ project: draft() });
    await r.service.projectSave({ id: 'drey', project: draft() });
    expect(r.commits).toHaveLength(1);
  });

  it('refuses a blank name, a bad colour, a bad access and an unknown id', async () => {
    const r = rig();
    expect(await r.service.projectSave({ project: draft({ name: '  ' }) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await r.service.projectSave({ project: draft({ color: 'blue' }) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await r.service.projectSave({ project: draft({ vaults: { X: 'all' as never } }) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await r.service.projectSave({ id: 'nope', project: draft() })).toMatchObject({ ok: false, code: 'no_project' });
    expect(r.commits).toHaveLength(0);
  });

  it('removes a record in one commit of the deletion', async () => {
    const r = rig({ 'tickets/_meta/projects/drey.md': '---\nname: Drey\nrepos: []\n---\n' });
    expect(await r.service.projectRemove({ id: 'drey' })).toEqual({ ok: true, id: 'drey' });
    expect(r.disk.has('tickets/_meta/projects/drey.md')).toBe(false);
    expect(r.commits).toEqual([{ paths: ['tickets/_meta/projects/drey.md'], message: 'projects: Drey removed (req-284)' }]);
  });

  it('adds a repository found in a folder to repos.md and the project in one commit', async () => {
    const r = rig({ 'tickets/_meta/repos.md': REPOS, 'tickets/_meta/projects/drey.md': '---\nname: Drey\nrepos:\n  - drey\n---\n' });
    const repo = { name: 'lariscus', url: 'https://example.com/l.git', branch: null, policy: null, path: 'E:/l', worker: null, worktrees: null, launch: null, instructions: null };
    expect(await r.service.projectAddRepo({ id: 'drey', repo })).toEqual({ ok: true, id: 'drey' });
    expect(parseRepos(r.disk.get('tickets/_meta/repos.md')!).repos.map((x) => x.name)).toEqual(['drey', 'lariscus']);
    expect(r.disk.get('tickets/_meta/repos.md')).toContain('Repositories.');
    expect(parseProjectFile('drey', r.disk.get('tickets/_meta/projects/drey.md')!).project.repos).toEqual(['drey', 'lariscus']);
    expect(r.commits).toEqual([{ paths: ['tickets/_meta/repos.md', 'tickets/_meta/projects/drey.md'], message: 'projects: Drey — repository lariscus added (req-284)' }]);
  });

  it('lists a repository repos.md already has without rewriting repos.md', async () => {
    const r = rig({ 'tickets/_meta/repos.md': REPOS, 'tickets/_meta/projects/home.md': '---\nname: Home\nrepos: []\n---\n' });
    const repo = { name: 'drey', url: 'https://example.com/drey.git', branch: null, policy: null, path: null, worker: null, worktrees: null, launch: null, instructions: null };
    await r.service.projectAddRepo({ id: 'home', repo });
    expect(r.commits[0]!.paths).toEqual(['tickets/_meta/projects/home.md']);
  });
});
