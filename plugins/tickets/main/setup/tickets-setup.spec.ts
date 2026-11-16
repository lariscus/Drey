import { mkdtempSync, promises as fsp, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTicketsVault, type SetupDeps } from './tickets-setup';

/**
 * D-74: the setup's decisions — what becomes a repository, what is
 * refused, and the order of register → start → initialize. The folders
 * are real (the emptiness check reads them); git, the vault registry and
 * the engine are fakes.
 */
describe('setupTicketsVault', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'tickets-setup-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** An existing, empty folder of the scratch root (what the picker hands over). */
  const make = async (name: string): Promise<string> => {
    const folder = path.join(root, name);
    await fsp.mkdir(folder, { recursive: true });
    return folder;
  };

  interface Calls {
    readonly gitInit: string[];
    readonly register: string[];
    readonly startEngine: unknown[];
    readonly initialize: string[];
  }

  const makeDeps = (calls: Calls, overrides: Partial<SetupDeps> = {}): SetupDeps => ({
    listVaults: async () => [],
    register: async (folder) => {
      calls.register.push(folder);
      return { id: 'v-new', name: path.basename(folder), path: folder };
    },
    hasBoard: async () => false,
    startEngine: async (startVault) => {
      calls.startEngine.push(startVault);
    },
    initialize: async (vaultId) => {
      calls.initialize.push(vaultId);
      return { ok: true };
    },
    gitInit: async (folder) => {
      calls.gitInit.push(folder);
    },
    entries: (folder) => fsp.readdir(folder),
    log: () => undefined,
    ...overrides,
  });

  it('refuses a payload without a folder', async () => {
    const calls: Calls = { gitInit: [], register: [], startEngine: [], initialize: [] };
    expect(await setupTicketsVault(makeDeps(calls), undefined)).toMatchObject({ ok: false });
    expect(await setupTicketsVault(makeDeps(calls), '   ')).toMatchObject({ ok: false });
    expect(calls).toEqual({ gitInit: [], register: [], startEngine: [], initialize: [] });
  });

  it('refuses a folder that is neither empty nor a repository', async () => {
    const folder = await make('notes-vault');
    writeFileSync(path.join(folder, 'a.md'), 'x', 'utf8');
    const calls: Calls = { gitInit: [], register: [], startEngine: [], initialize: [] };
    expect(await setupTicketsVault(makeDeps(calls), folder)).toMatchObject({ ok: false, error: /neither empty nor a git repository/ });
    expect(calls.gitInit).toHaveLength(0);
  });

  it('creates a repository in an empty folder, registers it, starts the engine, initializes the board', async () => {
    const folder = await make('fresh-tickets');
    const calls: Calls = { gitInit: [], register: [], startEngine: [], initialize: [] };
    expect(await setupTicketsVault(makeDeps(calls), folder)).toEqual({ ok: true });
    expect(calls.gitInit).toEqual([folder]);
    expect(calls.register).toEqual([folder]);
    expect(calls.startEngine).toEqual([{ id: 'v-new', name: 'fresh-tickets', path: folder }]);
    expect(calls.initialize).toEqual(['v-new']);
  });

  it('takes an existing repository as it is', async () => {
    const folder = await make('existing-repo');
    const calls: Calls = { gitInit: [], register: [], startEngine: [], initialize: [] };
    expect(await setupTicketsVault(makeDeps(calls, { entries: async () => ['src', '.git'] }), folder)).toEqual({ ok: true });
    expect(calls.gitInit).toHaveLength(0);
    expect(calls.initialize).toEqual(['v-new']);
  });

  it('reuses a vault that is already registered for the folder', async () => {
    const folder = await make('registered');
    const calls: Calls = { gitInit: [], register: [], startEngine: [], initialize: [] };
    const deps = makeDeps(calls, { listVaults: async () => [{ id: 'v-known', name: 'registered', path: folder, exists: true }] });
    expect(await setupTicketsVault(deps, folder)).toEqual({ ok: true });
    expect(calls.register).toHaveLength(0);
    expect(calls.startEngine).toEqual([{ id: 'v-known', name: 'registered', path: folder }]);
    expect(calls.initialize).toEqual(['v-known']);
  });

  it('adopts a board that already exists instead of initializing again', async () => {
    const folder = await make('has-board');
    const calls: Calls = { gitInit: [], register: [], startEngine: [], initialize: [] };
    expect(await setupTicketsVault(makeDeps(calls, { hasBoard: async () => true }), folder)).toMatchObject({ ok: true, note: /already exists/ });
    expect(calls.initialize).toHaveLength(0);
  });

  it('answers a failed initialize with its error', async () => {
    const folder = await make('init-fails');
    const calls: Calls = { gitInit: [], register: [], startEngine: [], initialize: [] };
    expect(await setupTicketsVault(makeDeps(calls, { initialize: async () => ({ ok: false, error: 'write failed: disk full' }) }), folder)).toEqual({
      ok: false,
      error: 'write failed: disk full',
    });
  });

  it('answers a failed engine start with its message', async () => {
    const folder = await make('start-fails');
    const calls: Calls = { gitInit: [], register: [], startEngine: [], initialize: [] };
    expect(
      await setupTicketsVault(makeDeps(calls, { startEngine: async () => Promise.reject(new Error('Drey Service did not come up within 60 s')) }), folder),
    ).toEqual({ ok: false, error: 'Drey Service did not come up within 60 s' });
  });

  it('refuses a folder that cannot be read', async () => {
    const calls: Calls = { gitInit: [], register: [], startEngine: [], initialize: [] };
    const deps = makeDeps(calls, { entries: async () => null });
    expect(await setupTicketsVault(deps, path.join(root, 'gone'))).toMatchObject({ ok: false, error: /does not exist/ });
    expect(calls.gitInit).toHaveLength(0);
  });
});
