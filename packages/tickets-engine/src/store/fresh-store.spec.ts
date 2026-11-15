import { execFileSync } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TicketsGit } from '../core/git/tickets-git';
import { assertDkVersion, MIN_DK_VERSION } from './dk-process';
import { isLifecycleStore, parseStoreStages } from './store-stages';
import { defaultStorePathOf, initLifecycleStore, lifecycleStoreToml } from './fresh-store';

/** E14-9b item 6: the fresh install's store — the toml swap is pure, the creation runs the real `dk`. */
const bin = process.env['DREY_DK_BIN'] ?? 'dk';

function probe(): { ok: true } | { ok: false; reason: string } {
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
    assertDkVersion(/version:\s*(\S+)/.exec(out)?.[1] ?? out.trim(), bin);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : `dk was not found ("${bin}"); set DREY_DK_BIN to a dk >= ${MIN_DK_VERSION}` };
  }
}
const found = probe();
if (!found.ok) {
  console.warn(`[fresh store] SKIPPED: ${found.reason}`);
}

describe('defaultStorePathOf', () => {
  it('the store goes beside the meta vault, named after it', () => {
    expect(defaultStorePathOf('E:\\notes\\drey-tickets')).toBe('E:\\notes\\drey-tickets-tickets-store');
    expect(path.basename(defaultStorePathOf('/x/Notes'))).toBe('Notes-tickets-store');
  });
});

describe('lifecycleStoreToml', () => {
  const INIT_TOML = [
    '[store]',
    'prefix = "t"',
    '',
    '[priorities]',
    'values = ["critical", "high", "normal", "low"]',
    '',
    '[transitions.agent]',
    'todo = "in-progress"',
    'in-progress = "done"',
    '',
    '[transitions.human]',
    'todo = "done"',
    '',
  ].join('\n');

  it('drops dk\'s built-in agent transitions and writes the lifecycle stages', () => {
    const toml = lifecycleStoreToml(INIT_TOML);
    expect(toml).not.toContain('[transitions.agent]');
    expect(toml).toContain('[transitions.human]');
    const stages = parseStoreStages(toml);
    expect(stages).not.toBeNull();
    expect(isLifecycleStore(stages)).toBe(true);
    expect(stages).toMatchObject({ initial: 'inbox', terminal: ['done'], claim: ['running'], cancelled: 'cancelled' });
  });

  it('swaps the priority vocabulary to the board\'s', () => {
    expect(lifecycleStoreToml(INIT_TOML)).toContain('values = ["urgent", "high", "normal", "low"]');
  });

  it('keeps a toml without the built-ins intact and still appends the stages', () => {
    const toml = lifecycleStoreToml('[store]\nprefix = "t"\n');
    expect(toml.startsWith('[store]\nprefix = "t"\n')).toBe(true);
    expect(isLifecycleStore(parseStoreStages(toml))).toBe(true);
  });
});

describe.skipIf(!found.ok)('initLifecycleStore over the real dk', { timeout: 120_000 }, () => {
  it('creates a store on the lifecycle stages, its working copy on the tickets branch', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-fresh-store-'));
    try {
      const dir = path.join(root, 'vault-tickets-store');
      const git = new TicketsGit(() => 'git');
      const log = vi.fn();
      await initLifecycleStore(dir, { dkPath: bin, git: (cwd, args) => git.run(cwd, args), log });
      // The toml lives on main; the working copy is the tickets branch the board reads.
      const toml = await git.run(dir, ['show', 'main:dricket.toml']);
      expect(isLifecycleStore(parseStoreStages(toml))).toBe(true);
      expect((await git.run(dir, ['branch', '--show-current'])).trim()).toBe('tickets');
      // The swap is one commit of its own, on top of dk's scaffold.
      const subjects = await git.run(dir, ['log', '--format=%s', 'main']);
      expect(subjects.trim().split('\n')[0]).toBe('the lifecycle stages');
      expect(subjects).not.toContain('transitions');
      expect(log).toHaveBeenCalledWith(expect.stringContaining(dir));
    } finally {
      await fsp.rm(root, { recursive: true, force: true, maxRetries: 20 }).catch(() => undefined);
    }
  });

  it('sets a local git identity only when none resolves', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-fresh-store-'));
    try {
      const dir = path.join(root, 'vault-tickets-store');
      const git = new TicketsGit(() => 'git');
      const calls: string[][] = [];
      await initLifecycleStore(dir, {
        dkPath: bin,
        // A real git everywhere except the identity probes, which answer "unset".
        git: async (cwd, args) => {
          if (args[0] === 'config' && args.length === 2) {
            calls.push([...args]);
            throw new Error('unset');
          }
          calls.push([...args]);
          return git.run(cwd, args);
        },
      });
      const first = calls.findIndex((args) => args[0] === 'config');
      expect(calls.slice(first, first + 2)).toEqual([['config', 'user.email'], ['config', 'user.email', 'drey@localhost']]);
      expect(calls).toContainEqual(['config', 'user.name', 'Drey']);
    } finally {
      await fsp.rm(root, { recursive: true, force: true, maxRetries: 20 }).catch(() => undefined);
    }
  });
});

