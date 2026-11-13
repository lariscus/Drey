import { execFileSync } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VAULTS_KEY } from '../contracts/vaults';
import { parsePersonaFile } from '../core/persona';
import { parseProjectFile } from '../core/project-record';
import { TicketsGit } from '../core/tickets-git';
import { ChangeHub } from '../server/drey-port';
import { FileConfigStore } from '../server/file-config';
import { FsEngineHost } from '../server/standalone-host';
import type { EngineVault } from './host';
import { ProjectMigrator } from './project-migrator';

/**
 * req-282 at the engine's start, on a temp vault inside a real repository and
 * a temp engine home (the registered vaults are the home's config key, as Drey
 * keeps it): one project, write-notes, one commit, and nothing on a second start.
 */

let root = '';
let repo = '';
let home = '';
const logs: string[] = [];
const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const vaultDir = (): string => path.join(repo, 'board');

async function put(rel: string, text: string): Promise<void> {
  const abs = path.join(vaultDir(), ...rel.split('/'));
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, text, 'utf8');
}

const REPOS = `---
repos:
  drey:
    url: https://example.test/drey.git
    branch: main
  lariscus:
    url: https://example.test/lariscus.git
---
Work repositories.
`;

const BEN = `---
title: Ben
role: builder
worker: opencode
models:
  default: opus
  pool: [opus]
color: '#a78bfa'
skills: []
allowed:
  write-vaults: [vnotes, vgone]
---
`;

const RALF = `---
title: Ralf
role: reviewer
worker: opencode
models:
  default: opus
  pool: [opus]
color: '#a78bfa'
skills: []
---
`;

async function migrator(registered: unknown): Promise<{ migrator: ProjectMigrator; host: FsEngineHost }> {
  const config = new FileConfigStore(path.join(home, 'config.json'));
  if (registered !== undefined) {
    await config.set(VAULTS_KEY, registered);
  }
  const host = new FsEngineHost(vaultDir(), config, new ChangeHub(), () => undefined, home);
  const board = {
    detect: async (): Promise<EngineVault | null> => (await host.listVaults())[0] ?? null,
    listPersonaIds: async () => (await fsp.readdir(path.join(vaultDir(), 'tickets', '_meta', 'personas')).catch(() => [])).sort(),
  };
  return { migrator: new ProjectMigrator({ board, host, git: new TicketsGit(() => 'git'), log: (m) => void logs.push(m) }), host };
}

const REGISTERED = [
  { id: 'vnotes', name: 'Drey notes', path: 'C:/notes', active: true },
  { id: 'vwork', name: 'Work notes', path: 'C:/work', active: false },
];

describe('ProjectMigrator over a temp vault and home (req-282)', () => {
  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-projects-'));
    repo = path.join(root, 'repo');
    home = path.join(root, 'home');
    await fsp.mkdir(repo, { recursive: true });
    await fsp.mkdir(home, { recursive: true });
    logs.length = 0;
    git('init', '-q');
    git('config', 'user.name', 'Spec');
    git('config', 'user.email', 'spec@example.test');
    git('config', 'core.autocrlf', 'false');
    await put('tickets/_meta/pipeline.md', '---\nphases: [inbox, done]\n---\n');
    await put('tickets/_meta/repos.md', REPOS);
    await put('tickets/_meta/personas/ben/persona.md', BEN);
    await put('tickets/_meta/personas/ralf/persona.md', RALF);
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('writes one project from repos.md and the registered vaults, write-notes for the persona that named vaults, in one commit', async () => {
    const { migrator: m } = await migrator(REGISTERED);
    const result = await m.migrate();
    expect(result?.plan.project.id).toBe('drey');

    const project = parseProjectFile('drey', await fsp.readFile(path.join(vaultDir(), 'tickets/_meta/projects/drey.md'), 'utf8')).project;
    expect(project).toMatchObject({ name: 'drey', repos: ['drey', 'lariscus'], vaults: { 'Drey notes': 'write', 'Work notes': 'read' }, purpose: '' });

    const ben = parsePersonaFile('ben', await fsp.readFile(path.join(vaultDir(), 'tickets/_meta/personas/ben/persona.md'), 'utf8'));
    expect(ben.allowed).toMatchObject({ writeNotes: true, writeVaults: ['vnotes', 'vgone'] });
    const ralf = await fsp.readFile(path.join(vaultDir(), 'tickets/_meta/personas/ralf/persona.md'), 'utf8');
    expect(ralf).toBe(RALF);

    const shown = git('show', '--name-only', '--format=%s', 'HEAD').split('\n').filter((line) => line !== '');
    expect(shown[0]).toBe('projects: the first project "drey" from repos.md and the registered vaults (req-282)');
    expect(shown.slice(1).sort()).toEqual(['board/tickets/_meta/personas/ben/persona.md', 'board/tickets/_meta/projects/drey.md']);
    expect(git('status', '--porcelain')).toBe('');
    expect(logs.some((line) => line.includes('vgone') && line.includes('has not registered'))).toBe(true);
  });

  it('does nothing on the next start, or on a board that already has a project', async () => {
    const { migrator: m } = await migrator(REGISTERED);
    await m.migrate();
    const head = git('rev-parse', 'HEAD');
    expect(await m.migrate()).toBeNull();
    expect(git('rev-parse', 'HEAD')).toBe(head);
  });

  it('writes the project without vaults when the device has registered none, and waits for a broken repos.md', async () => {
    const { migrator: m } = await migrator(undefined);
    await put('tickets/_meta/repos.md', '---\nrepos: [drey]\n---\n');
    expect(await m.migrate()).toBeNull();
    expect(logs.some((line) => line.includes('waits for a readable repos.md'))).toBe(true);

    await put('tickets/_meta/repos.md', REPOS);
    const result = await m.migrate();
    expect(result?.plan.project.vaults).toEqual({});
    expect(result?.plan.writeNotes).toEqual(['ben']);
    expect(result?.plan.unresolved.map((u) => u.vaultId)).toEqual(['vnotes', 'vgone']);
  });
});
