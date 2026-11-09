import { describe, expect, it } from 'vitest';
import type { EngineVault } from './host';
import { PersonaCommitAges, type CommitAgeGit } from './persona-commit-age';

const VAULT = { id: 'v', name: 'tickets', path: '/repo/vault', exists: true, active: true } as unknown as EngineVault;

/** A fake git that answers the three commands the service runs and counts them. */
function fakeGit(options: { head?: string | Error; logs?: Record<string, string>; located?: { root: string; prefix: string } | null } = {}): { git: CommitAgeGit; calls: string[][] } {
  const calls: string[][] = [];
  const located = options.located === undefined ? { root: '/repo', prefix: 'vault/' } : options.located;
  const git: CommitAgeGit = {
    locate: async () => located,
    run: async (_cwd, args) => {
      calls.push([...args]);
      if (args[0] === 'rev-parse') {
        if (options.head instanceof Error) {
          throw options.head;
        }
        return `${options.head ?? 'aaa'}\n`;
      }
      const dir = args[args.length - 1]!;
      return `${options.logs?.[dir] ?? ''}\n`;
    },
  };
  return { git, calls };
}

describe('PersonaCommitAges — when personas/<id>/ was last committed (req-239)', () => {
  it('asks git log -1 for each persona folder, path prefixed with where the vault sits in the repository', async () => {
    const { git, calls } = fakeGit({ logs: { 'vault/tickets/_meta/personas/ben': '2026-11-07T10:00:00+01:00' } });
    const ages = await new PersonaCommitAges({ detect: async () => VAULT }, git).of(['ben', 'pia']);
    expect(ages).toEqual({ ben: '2026-11-07T10:00:00+01:00' }); // pia has no commit yet: absent
    expect(calls).toContainEqual(['log', '-1', '--format=%cI', '--', 'vault/tickets/_meta/personas/ben']);
  });

  it('keeps an answer until HEAD moves: a quiet repository costs one rev-parse', async () => {
    const { git, calls } = fakeGit({ logs: { 'vault/tickets/_meta/personas/ben': '2026-11-07T10:00:00Z' } });
    const reader = new PersonaCommitAges({ detect: async () => VAULT }, git);
    await reader.of(['ben']);
    await reader.of(['ben']);
    expect(calls.filter((c) => c[0] === 'log')).toHaveLength(1);
    expect(calls.filter((c) => c[0] === 'rev-parse')).toHaveLength(2);
  });

  it('asks again once HEAD moved', async () => {
    let head = 'aaa';
    const logs: Record<string, string> = { 'vault/tickets/_meta/personas/ben': '2026-11-07T10:00:00Z' };
    const calls: string[][] = [];
    const git: CommitAgeGit = {
      locate: async () => ({ root: '/repo', prefix: 'vault/' }),
      run: async (_cwd, args) => {
        calls.push([...args]);
        return args[0] === 'rev-parse' ? head : logs[args[args.length - 1]!]!;
      },
    };
    const reader = new PersonaCommitAges({ detect: async () => VAULT }, git);
    expect((await reader.of(['ben']))['ben']).toBe('2026-11-07T10:00:00Z');
    head = 'bbb';
    logs['vault/tickets/_meta/personas/ben'] = '2026-11-09T08:00:00Z';
    expect((await reader.of(['ben']))['ben']).toBe('2026-11-09T08:00:00Z');
  });

  it('has no age without a vault, outside git, in an empty repository, or for a date git did not give', async () => {
    expect(await new PersonaCommitAges({ detect: async () => null }, fakeGit().git).of(['ben'])).toEqual({});
    expect(await new PersonaCommitAges({ detect: async () => VAULT }, fakeGit({ located: null }).git).of(['ben'])).toEqual({});
    expect(await new PersonaCommitAges({ detect: async () => VAULT }, fakeGit({ head: new Error('unknown revision HEAD') }).git).of(['ben'])).toEqual({});
    expect(await new PersonaCommitAges({ detect: async () => VAULT }, fakeGit({ logs: { 'vault/tickets/_meta/personas/ben': 'not a date' } }).git).of(['ben'])).toEqual({});
  });

  it('leaves a persona out whose log fails or whose id is no persona reference, and answers the others', async () => {
    const calls: string[][] = [];
    const git: CommitAgeGit = {
      locate: async () => ({ root: '/repo', prefix: '' }),
      run: async (_cwd, args) => {
        calls.push([...args]);
        if (args[0] === 'rev-parse') {
          return 'aaa';
        }
        if (args[args.length - 1]!.endsWith('/ben')) {
          throw new Error('fatal');
        }
        return '2026-11-08T10:00:00Z';
      },
    };
    const ages = await new PersonaCommitAges({ detect: async () => VAULT }, git).of(['ben', 'pia', '../x']);
    expect(ages).toEqual({ pia: '2026-11-08T10:00:00Z' });
  });
});
