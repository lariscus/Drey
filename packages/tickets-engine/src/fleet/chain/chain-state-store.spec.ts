import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import { ChainState } from './chain-state';
import { ChainStatePaths } from './chain-state-paths';
import { ChainStateStore } from './chain-state-store';

/** req-173 (R13, ADR-0077 later change): one runtime-only chain.json per tickets vault. */

const clock = { now: () => new Date('2026-11-09T12:00:00Z') };
const A = { ticketsVaultPath: 'E:\\tickets-a', git: 'git' };
const B = { ticketsVaultPath: 'E:\\tickets-b', git: 'git' };

function setup(): { fs: MemoryFileSystem; store: ChainStateStore; logs: string[] } {
  const fs = new MemoryFileSystem();
  const logs: string[] = [];
  return { fs, store: new ChainStateStore('/fleet', fs, clock, (m) => logs.push(m)), logs };
}

describe('ChainStatePaths', () => {
  it('keys a vault by its folder name and a hash of its normalized path', () => {
    expect(ChainStatePaths.keyOf('E:\\Projects\\Drey Tickets\\')).toMatch(/^drey-tickets-[0-9a-f]{8}$/);
    expect(ChainStatePaths.keyOf('E:/projects/drey tickets')).toBe(ChainStatePaths.keyOf('E:\\Projects\\Drey Tickets'));
    expect(ChainStatePaths.keyOf('E:\\a\\tickets')).not.toBe(ChainStatePaths.keyOf('E:\\b\\tickets'));
  });
});

describe('ChainStateStore per vault', () => {
  it('writes runtime state only — no config — under the vault key, and the pointer', async () => {
    const { fs, store } = setup();
    const state = new ChainState();
    state.vault = A;
    state.config = { ...A, defaultWorker: 'kimi', permissionMode: 'bypass' };
    state.columns['build'] = 'held';
    await store.persist(state);
    const file = JSON.parse((await fs.readTextOrNull(store.fileFor(A.ticketsVaultPath)))!) as Record<string, unknown>;
    expect(file['config']).toBeUndefined();
    expect(file['vault']).toEqual(A);
    expect(file['columns']).toEqual({ build: 'held' });
    expect(JSON.parse((await fs.readTextOrNull('/fleet/chain-vault.json'))!)).toEqual({ vault: A });
  });

  it('boots from the pointer into the vault served last', async () => {
    const { fs, store } = setup();
    const state = new ChainState();
    state.vault = B;
    state.pausedPersonas.add('ben');
    await store.persist(state);
    const restored = new ChainState();
    await new ChainStateStore('/fleet', fs, clock, () => undefined).load(restored);
    expect(restored.vault).toEqual(B);
    expect([...restored.pausedPersonas]).toEqual(['ben']);
    expect(restored.config).toBeNull();
  });

  it('req-274: the last recorded holds come back, a broken entry is dropped', async () => {
    const { fs, store } = setup();
    const state = new ChainState();
    state.vault = A;
    state.holds['T-1'] = { persona: 'ben', position: 2, length: 4 };
    state.holds['T-2'] = { persona: 'you', position: null, length: null };
    state.holds['T-3'] = { persona: 'ben', position: 0, length: 4 };
    await store.persist(state);
    const restored = new ChainState();
    await new ChainStateStore('/fleet', fs, clock, () => undefined).load(restored);
    expect(restored.holds).toEqual({ 'T-1': { persona: 'ben', position: 2, length: 4 }, 'T-2': { persona: 'you', position: null, length: null } });
    restored.reset();
    expect(restored.holds).toEqual({});
  });

  it('moves a pre-req-173 chain.json into its vault file and keeps it as chain.legacy.json', async () => {
    const { fs, store, logs } = setup();
    const old = { version: 1, config: { ...A, defaultWorker: 'claude-code', permissionMode: 'accept-edits' }, master: 'halted', columns: { review: 'held' } };
    await fs.writeText('/fleet/chain.json', JSON.stringify(old));
    const state = new ChainState();
    await store.load(state);
    expect(await fs.exists('/fleet/chain.json')).toBe(false);
    expect(JSON.parse((await fs.readTextOrNull('/fleet/chain.legacy.json'))!)).toEqual(old);
    expect(state.vault).toEqual(A);
    expect(state.config).toBeNull();
    expect(state.columns).toEqual({ review: 'held' });
    const moved = JSON.parse((await fs.readTextOrNull(store.fileFor(A.ticketsVaultPath)))!) as Record<string, unknown>;
    expect(moved['config']).toBeUndefined();
    expect(logs.some((l) => l.includes('moved to the vault'))).toBe(true);
  });

  it('two vaults never share a master: a switch writes A away, loads B empty, and A comes back Off', async () => {
    const { store } = setup();
    const state = new ChainState();
    expect(await store.switchTo(state, A)).toBe(true); // the first vault adopts the state
    state.autopilot = { state: 'on' };
    state.columns['build'] = 'held';
    expect(await store.switchTo(state, A)).toBe(false);
    expect(await store.switchTo(state, B)).toBe(true);
    expect(state.vault).toEqual(B);
    expect(state.autopilot.state).toBe('off');
    expect(state.columns).toEqual({});
    await store.switchTo(state, A);
    expect(state.columns).toEqual({ build: 'held' });
    expect(state.autopilot.state).toBe('off'); // the boot rule on every switch
  });
});
