import { describe, expect, it } from 'vitest';
import type { ProjectDraft } from '../contracts/project-commands';
import { parseProjectFile } from '../core/projects/project-record';
import { parseRepos } from '../core/projects/repos-file';
import type { FolderProbeResult } from './folder-probe';
import type { EngineVault } from './host';
import { ProjectService } from './project-service';
import type { SkillFileSystem } from './skill-file-system';

const VAULT: EngineVault = { id: 'v1', name: 'tickets', path: '/t', exists: true, active: true };
const REPOS = '---\nrepos:\n  drey:\n    url: https://example.com/drey.git\n---\nRepositories.\n';
const EMPTY_PROJECT = (name: string): string => `---\nname: ${name}\nrepos: []\n---\n`;

function rig(files: Record<string, string> = {}, found: FolderProbeResult = { kind: 'plain', path: '/x' }) {
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
    probe: { probe: () => Promise.resolve(found) },
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
    const r = rig({ 'tickets/_meta/projects/drey.md': EMPTY_PROJECT('Drey') });
    expect(await r.service.projectSave({ project: draft() })).toEqual({ ok: true, id: 'drey-2' });
  });

  it('rewrites an existing record and keeps its id when the name changes', async () => {
    const r = rig({ 'tickets/_meta/projects/drey.md': EMPTY_PROJECT('Drey') });
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
    const r = rig({ 'tickets/_meta/projects/drey.md': EMPTY_PROJECT('Drey') });
    expect(await r.service.projectRemove({ id: 'drey' })).toEqual({ ok: true, id: 'drey' });
    expect(r.disk.has('tickets/_meta/projects/drey.md')).toBe(false);
    expect(r.commits).toEqual([{ paths: ['tickets/_meta/projects/drey.md'], message: 'projects: Drey removed (req-284)' }]);
  });
});

describe('ProjectService.projectAddFolder (req-304)', () => {
  it('lists a git repository found in a folder: repos.md gains its entry, the project lists it, one commit', async () => {
    const seed = { name: 'lariscus', url: 'https://example.com/l.git', branch: 'main', path: 'E:/l' };
    const r = rig({ 'tickets/_meta/repos.md': REPOS, 'tickets/_meta/projects/drey.md': '---\nname: Drey\nrepos:\n  - drey\n---\n' }, { kind: 'repository', seed });
    expect(await r.service.projectAddFolder({ id: 'drey', folder: 'E:/l/src' })).toEqual({ ok: true, id: 'drey', kind: 'repository', name: 'lariscus' });
    const repos = parseRepos(r.disk.get('tickets/_meta/repos.md')!).repos;
    expect(repos.map((x) => x.name)).toEqual(['drey', 'lariscus']);
    expect(repos[1]).toMatchObject({ url: 'https://example.com/l.git', branch: 'main', path: 'E:/l' });
    expect(r.disk.get('tickets/_meta/repos.md')).toContain('Repositories.');
    expect(parseProjectFile('drey', r.disk.get('tickets/_meta/projects/drey.md')!).project.repos).toEqual(['drey', 'lariscus']);
    expect(r.commits).toEqual([{ paths: ['tickets/_meta/repos.md', 'tickets/_meta/projects/drey.md'], message: 'projects: Drey — repository lariscus added (req-304)' }]);
  });

  it('lists a repository whose checkout repos.md already names without rewriting repos.md', async () => {
    const entry = '---\nrepos:\n  drey:\n    url: https://example.com/drey.git\n    path: E:/projects/drey\n---\nRepositories.\n';
    const seed = { name: 'drey', url: 'https://example.com/drey.git', branch: 'main', path: 'e:\\projects\\drey\\' };
    const r = rig({ 'tickets/_meta/repos.md': entry, 'tickets/_meta/projects/home.md': EMPTY_PROJECT('Home') }, { kind: 'repository', seed });
    expect(await r.service.projectAddFolder({ id: 'home', folder: 'E:/projects/drey' })).toMatchObject({ ok: true, kind: 'repository', name: 'drey' });
    expect(r.commits[0]!.paths).toEqual(['tickets/_meta/projects/home.md']);
  });

  it('gives a second checkout of the same name an entry of its own', async () => {
    const seed = { name: 'drey', url: 'https://example.com/drey.git', branch: null, path: 'E:/other/drey' };
    const held = REPOS.replace('drey.git\n', 'drey.git\n    path: E:/projects/drey\n');
    const r = rig({ 'tickets/_meta/repos.md': held, 'tickets/_meta/projects/home.md': EMPTY_PROJECT('Home') }, { kind: 'repository', seed });
    expect(await r.service.projectAddFolder({ id: 'home', folder: 'E:/other/drey' })).toMatchObject({ ok: true, name: 'drey-2' });
    expect(parseRepos(r.disk.get('tickets/_meta/repos.md')!).repos.map((x) => x.name)).toEqual(['drey', 'drey-2']);
  });

  it('adds a plain folder to the project, one commit, and nothing twice', async () => {
    const r = rig({ 'tickets/_meta/projects/drey.md': EMPTY_PROJECT('Drey') });
    expect(await r.service.projectAddFolder({ id: 'drey', folder: 'E:/specs' })).toEqual({ ok: true, id: 'drey', kind: 'folder', name: 'E:/specs' });
    await r.service.projectAddFolder({ id: 'drey', folder: 'E:/specs' });
    expect(parseProjectFile('drey', r.disk.get('tickets/_meta/projects/drey.md')!).project.folders).toEqual(['E:/specs']);
    expect(r.commits).toEqual([{ paths: ['tickets/_meta/projects/drey.md'], message: 'projects: Drey — folder E:/specs added (req-304)' }]);
  });

  it('refuses a plain folder when only a repository will do, and a folder that is not there', async () => {
    const files = { 'tickets/_meta/projects/drey.md': EMPTY_PROJECT('Drey') };
    expect(await rig(files).service.projectAddFolder({ id: 'drey', folder: 'E:/specs', repoOnly: true })).toMatchObject({ ok: false, code: 'not_a_repository' });
    const gone = rig(files, { kind: 'missing' });
    expect(await gone.service.projectAddFolder({ id: 'drey', folder: 'E:/nope' })).toMatchObject({ ok: false, code: 'not_a_folder' });
    expect(await gone.service.projectAddFolder({ id: 'drey', folder: '  ' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await gone.service.projectAddFolder({ id: 'nope', folder: 'E:/x' })).toMatchObject({ ok: false, code: 'no_project' });
    expect(gone.commits).toHaveLength(0);
  });
});
