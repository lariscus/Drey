import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TicketsGit } from '../core/tickets-git';
import type { EngineVault } from './host';
import { PersonaCommitAges } from './persona-commit-age';

/** req-239 against a real repository: the vault is a folder inside it, and only the persona's own folder counts. */

let dir = '';
const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
};
const commit = (date: string, message: string): void => {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir, env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
};

describe('PersonaCommitAges over a real git repository', () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'drey-commit-age-'));
    git('init', '-q');
    git('config', 'user.name', 'Spec');
    git('config', 'user.email', 'spec@example.test');
    git('config', 'core.autocrlf', 'false');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the date of the last commit that touched personas/<id>/, not of a later commit elsewhere', async () => {
    write('vault/tickets/_meta/personas/ben/persona.md', 'ben\n');
    commit('2026-11-01T10:00:00Z', 'ben');
    write('vault/tickets/_meta/personas/pia/persona.md', 'pia\n');
    commit('2026-11-05T10:00:00Z', 'pia');
    write('vault/tickets/T-1.md', 'unrelated\n');
    commit('2026-11-08T10:00:00Z', 'ticket');
    const vault: EngineVault = { id: 'v', name: 'tickets', path: path.join(dir, 'vault'), exists: true, active: true };
    const ages = new PersonaCommitAges({ detect: async () => vault }, new TicketsGit(() => 'git'));
    const result = await ages.of(['ben', 'pia', 'ghost']);
    expect(Date.parse(result['ben']!)).toBe(Date.parse('2026-11-01T10:00:00Z'));
    expect(Date.parse(result['pia']!)).toBe(Date.parse('2026-11-05T10:00:00Z'));
    expect(result['ghost']).toBeUndefined();
    // A new commit to Ben's folder moves HEAD: the answer follows.
    write('vault/tickets/_meta/personas/ben/prompt.md', 'prompt\n');
    commit('2026-11-09T09:00:00Z', 'ben again');
    expect(Date.parse((await ages.of(['ben']))['ben']!)).toBe(Date.parse('2026-11-09T09:00:00Z'));
  });

  it('has no age in an empty repository', async () => {
    const vault: EngineVault = { id: 'v', name: 'tickets', path: dir, exists: true, active: true };
    expect(await new PersonaCommitAges({ detect: async () => vault }, new TicketsGit(() => 'git')).of(['ben'])).toEqual({});
  });
});
