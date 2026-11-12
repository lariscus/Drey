import { execFileSync } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TicketsGit } from '../core/tickets-git';
import { CREW_SEED_COMMIT } from './crew-seeder';
import { CrewSeederRig, modelRow } from './crew-seeder-rig.fake';

/** req-256 against a real repository: the vault is a folder inside it, and the seeding is exactly one commit. */

let repo = '';
let rig: CrewSeederRig;
const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

describe('CrewSeeder over a real git repository', () => {
  beforeEach(async () => {
    repo = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-crew-git-'));
    git('init', '-q');
    git('config', 'user.name', 'Spec');
    git('config', 'user.email', 'spec@example.test');
    git('config', 'core.autocrlf', 'false');
    await fsp.mkdir(path.join(repo, 'vault', 'tickets', '_meta'), { recursive: true });
    await fsp.writeFile(path.join(repo, 'vault', 'tickets', '_meta', 'pipeline.md'), '---\n---\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
  });

  afterEach(async () => {
    await rig?.dispose();
    await fsp.rm(repo, { recursive: true, force: true });
  });

  async function seed(): Promise<string[]> {
    rig = CrewSeederRig.createAt(path.join(repo, 'vault'), { rows: [modelRow('glm-big', 'opencode', 'A')], git: new TicketsGit(() => 'git') });
    expect(await rig.seeder.seed(rig.vault)).toMatchObject({ kind: 'seeded' });
    return git('show', '--name-only', '--format=%s', 'HEAD').split('\n').filter((line) => line !== '');
  }

  it('commits the five personas and crew.md in one commit with the agreed message, and nothing else', async () => {
    const shown = await seed();
    expect(shown[0]).toBe(CREW_SEED_COMMIT);
    expect(shown.slice(1).sort()).toEqual([
      'vault/tickets/_meta/crew.md',
      ...['ben', 'paul', 'pia', 'ralf', 'tessa'].flatMap((id) => [`vault/tickets/_meta/personas/${id}/persona.md`, `vault/tickets/_meta/personas/${id}/prompt.md`]),
    ].sort());
    expect(git('rev-list', '--count', 'HEAD')).toBe('2');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('stores LF blobs and a second seeding makes no further commit', async () => {
    await seed();
    const blob = execFileSync('git', ['cat-file', '-p', 'HEAD:vault/tickets/_meta/personas/ben/prompt.md'], { cwd: repo, encoding: 'utf8' });
    expect(blob).not.toContain('\r');
    expect(blob.startsWith('## Who Ben is\n')).toBe(true);
    expect(await rig.seeder.seed(rig.vault)).toEqual({ kind: 'nothing' });
    expect(git('rev-list', '--count', 'HEAD')).toBe('2');
  });
});
