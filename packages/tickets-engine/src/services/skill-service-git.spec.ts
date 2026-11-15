import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePersonaFile } from '../core/persona/persona';
import { TicketsGit } from '../core/git/tickets-git';
import type { EngineVault } from './host';
import { SkillService, type SkillsBoard } from './skill-service';

/**
 * req-172 against a real git repository: the migration, an upload and a
 * delete each leave exactly one commit of exactly their files, removals
 * included, and a clean tree behind them.
 */

const SKILL = '---\nname: review\ndescription: Reviews a diff\n---\n\nLook at the diff.\n';
let dir = '';

const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
};

function service(): SkillService {
  const vault: EngineVault = { id: 'v', name: 'tickets', path: dir, exists: true, active: true };
  const board: SkillsBoard = {
    detect: async () => vault,
    loadPersona: async (_v, id) => (id === 'ben' ? parsePersonaFile('ben', '---\ntitle: Ben\nworker: claude-code\nmodels:\n  default: opus\n---\n') : null),
    listPersonaIds: async () => ['ben'],
    personaPatch: async () => ({ ok: true }),
  };
  return new SkillService({ board, host: { announceChanges: vi.fn(), log: vi.fn() }, git: new TicketsGit(() => 'git') });
}

describe('SkillService over a real git repository', () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'drey-skills-'));
    git('init', '-q');
    git('config', 'user.name', 'Spec');
    git('config', 'user.email', 'spec@example.test');
    git('config', 'core.autocrlf', 'false');
    write('tickets/_meta/skills/flat.md', '# Flat skill\n\nbody\n');
    write('tickets/_meta/personas/ben/skills/own.md', 'Own flat skill.\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'initial');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('the migration is one commit that adds the folders and removes the flat files; the tree is clean after it', async () => {
    await service().migrateAll();
    expect(git('log', '--format=%s')).toBe('skills: migrate flat skill files to Agent Skills folders\ninitial');
    const changed = git('show', '--name-status', '--format=', 'HEAD').split('\n').map((line) => line.replaceAll('\t', ' ')).sort();
    expect(changed).toEqual([
      'A tickets/_meta/personas/ben/skills/own/SKILL.md',
      'A tickets/_meta/skills/flat/SKILL.md',
      'D tickets/_meta/personas/ben/skills/own.md',
      'D tickets/_meta/skills/flat.md',
    ]);
    expect(git('status', '--porcelain')).toBe('');
  });

  it('an upload commits its files, an overwrite also the removals, a delete the whole folder', async () => {
    const skills = service();
    await skills.migrateAll();
    await skills.skillUpload({ scope: 'own', persona: 'ben', format: 'markdown', text: SKILL });
    expect(git('log', '-1', '--format=%s')).toBe('skills: review added in ben');
    write('tickets/_meta/personas/ben/skills/review/old.txt', 'stale');
    git('add', '-A');
    git('commit', '-q', '-m', 'stale file');
    await skills.skillUpload({ scope: 'own', persona: 'ben', format: 'markdown', text: SKILL, overwrite: true });
    expect(git('log', '-1', '--format=%s')).toBe('skills: review replaced in ben');
    expect(git('show', '--name-status', '--format=', 'HEAD').replaceAll('\t', ' ')).toBe('D tickets/_meta/personas/ben/skills/review/old.txt');
    await skills.personaSkillRemove({ persona: 'ben', name: 'review' });
    expect(git('log', '-1', '--format=%s')).toBe('skills: ben own skill review removed');
    expect(existsSync(path.join(dir, 'tickets/_meta/personas/ben/skills/review'))).toBe(false);
    expect(git('status', '--porcelain')).toBe('');
  });
});
