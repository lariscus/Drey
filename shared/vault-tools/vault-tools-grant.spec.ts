import { describe, expect, it } from 'vitest';
import type { VaultFileEntry, VaultStatus } from '../ipc-api';
import type { ToolVault, VaultCallOptions, VaultToolDeps } from './types';
import { VaultTools } from './vault-tools';

/**
 * req-167: the two options Drey Service hands every worker call — the
 * per-vault write grant (R5) and the tools left out (`vault_delete`).
 * Drey's own callers set neither; their behaviour is the electron spec's.
 */
function harness(): { tools: VaultTools; store: Record<string, Record<string, string>> } {
  const store: Record<string, Record<string, string>> = { notes: { 'a.md': 'alpha\n' }, work: { 'b.md': 'beta\n' } };
  const vault: ToolVault = {
    listVaults: () => Object.keys(store).map((id) => ({ id, name: id, path: `/v/${id}`, exists: true, active: id === 'notes' }) as VaultStatus),
    getActiveVaultId: () => 'notes',
    listFiles: async (id) => Object.keys(store[id ?? 'notes'] ?? {}).map((p): VaultFileEntry => ({ name: p, relativePath: p, type: 'file' })),
    listMarkdownFiles: async (id) => Object.keys(store[id ?? 'notes'] ?? {}),
    readFile: async (p, id) => {
      const content = store[id ?? 'notes']?.[p];
      if (content === undefined) {
        throw new Error('missing');
      }
      return { content, modifiedMs: 1 };
    },
    writeFile: async (p, content, id) => {
      store[id ?? 'notes']![p] = content;
      return 2;
    },
    deleteEntry: async () => ({ trashed: false }),
  };
  const deps: VaultToolDeps = {
    vault,
    getSearchProvider: () => null,
    getTaskProvider: () => null,
    getConfig: () => ({ mcp: { yolo: false } }),
    confirmWrite: async () => true,
    approve: async () => true,
    rename: async (request) => ({ path: request.toRel, written: [], buffers: [], assets: [], failed: [] }),
    announce: () => undefined,
    announceRefresh: () => undefined,
  };
  return { tools: new VaultTools(deps), store };
}

const WORKER: VaultCallOptions = {
  write: 'auto',
  grant: { who: 'ben', vaults: ['work'] },
  exclude: ['vault_delete', 'tasks_list'],
  protectAppFolders: true,
};

const textOf = (result: { content: { text: string }[] }): string => result.content.map((c) => c.text).join('\n');

describe('the per-vault write grant (req-167, R5)', () => {
  it('refuses a write to a vault the grant leaves read-only, in the words the model acts on', async () => {
    const { tools, store } = harness();
    const result = await tools.call('vault_write', { path: 'x.md', content: 'x', mode: 'create', vault: 'notes' }, WORKER);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Error: ben may not write vault "notes" (allowed: read)');
    expect(store['notes']!['x.md']).toBeUndefined();
  });

  it('refuses an edit and a move there too — a move is a write right', async () => {
    const { tools } = harness();
    const edit = await tools.call('vault_edit', { path: 'a.md', edits: [{ old_text: 'alpha', new_text: 'A' }], vault: 'notes' }, WORKER);
    const move = await tools.call('vault_move', { from: 'a.md', to: 'c.md', vault: 'notes' }, WORKER);
    expect(textOf(edit)).toContain('may not write vault "notes"');
    expect(textOf(move)).toContain('may not write vault "notes"');
  });

  it('writes where the grant allows, unasked', async () => {
    const { tools, store } = harness();
    const result = await tools.call('vault_edit', { path: 'b.md', edits: [{ old_text: 'beta', new_text: 'BETA' }], vault: 'work' }, WORKER);
    expect(result.isError).not.toBe(true);
    expect(store['work']!['b.md']).toBe('BETA\n');
  });

  it('reads every vault whatever the grant says', async () => {
    const { tools } = harness();
    const result = await tools.call('vault_read', { path: 'a.md', vault: 'notes' }, WORKER);
    expect(textOf(result)).toContain('1: alpha');
  });
});

describe('the tools a caller leaves out (req-167)', () => {
  it('neither lists nor runs vault_delete', async () => {
    const { tools } = harness();
    expect(tools.list(WORKER).map((t) => t.name)).toEqual(['vault_list', 'vault_search', 'vault_read', 'vault_edit', 'vault_write', 'vault_move']);
    const result = await tools.call('vault_delete', { path: 'b.md', vault: 'work' }, WORKER);
    expect(textOf(result)).toBe('Error: there is no tool "vault_delete".');
  });
});
