import { describe, expect, it } from 'vitest';
import { MissionTools } from './mission-tools';
import type { EngineHost } from './host';

/**
 * Pia's read tools (req-315): persona files by pattern, one ticket's file,
 * and the shared vault reads over the host's registry — write: 'off', so no
 * write tool exists; results capped; refusals are `Error:` text the model
 * acts on, never throws.
 */

function hostOf(files: Record<string, string>): Pick<EngineHost, 'listVaults' | 'read' | 'listMarkdownFiles'> {
  return {
    listVaults: async () => [
      { id: 'vault', name: 'Notes', path: 'C:/v', exists: true, active: true },
      { id: 'gone', name: 'Gone', path: 'C:/g', exists: false, active: false },
    ],
    read: async (_vault: string, p: string) => {
      const hit = files[p];
      if (hit === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return hit;
    },
    listMarkdownFiles: async (vaultId: string) => (vaultId === 'vault' ? Object.keys(files) : []),
  };
}

describe('MissionTools', () => {
  it('offers the two engine tools and the vault reads — never a write tool', () => {
    const tools = new MissionTools({ host: hostOf({}), vaultId: async () => 'vault' });
    const names = tools.specs.map((spec) => spec.name);
    expect(names).toEqual(['persona_read', 'ticket_read', 'vault_list', 'vault_search', 'vault_read']);
    expect(names.some((name) => name.startsWith('vault_edit') || name.startsWith('vault_write') || name.startsWith('vault_delete'))).toBe(false);
  });

  it('persona_read reads a persona file through the host against the tickets vault', async () => {
    const tools = new MissionTools({
      host: hostOf({ 'tickets/_meta/personas/ben/prompt.md': '## Who Ben is' }),
      vaultId: async () => 'vault',
    });
    await expect(tools.call('persona_read', { path: 'tickets/_meta/personas/ben/prompt.md' })).resolves.toBe('## Who Ben is');
  });

  it('persona_read refuses a path beyond the three persona files', async () => {
    const tools = new MissionTools({ host: hostOf({}), vaultId: async () => 'vault' });
    await expect(tools.call('persona_read', { path: 'tickets/_meta/personas/ben/avatar.png' })).resolves.toContain('Error:');
    await expect(tools.call('persona_read', { path: '../../../etc/passwd' })).resolves.toContain('Error:');
    await expect(tools.call('persona_read', { path: 'tickets/_meta/chat/x.md' })).resolves.toContain('Error:');
    await expect(tools.call('persona_read', {})).resolves.toContain('Error:');
  });

  it('persona_read reports a missing file as Error text, and caps a long one', async () => {
    const long = 'x'.repeat(25_000);
    const tools = new MissionTools({
      host: hostOf({ 'tickets/_meta/personas/ben/memory.md': long }),
      vaultId: async () => 'vault',
    });
    await expect(tools.call('persona_read', { path: 'tickets/_meta/personas/ben/prompt.md' })).resolves.toContain('Error: ENOENT');
    const capped = await tools.call('persona_read', { path: 'tickets/_meta/personas/ben/memory.md' });
    expect(capped.length).toBeLessThan(long.length);
    expect(capped.endsWith('… (cut)')).toBe(true);
  });

  it('persona_read refuses without a tickets vault', async () => {
    const tools = new MissionTools({ host: hostOf({}), vaultId: async () => null });
    await expect(tools.call('persona_read', { path: 'tickets/_meta/personas/ben/prompt.md' })).resolves.toContain('Error: no tickets repository');
  });

  it('ticket_read reads one ticket through the board reader, wherever it sits', async () => {
    const tools = new MissionTools({
      host: hostOf({}),
      vaultId: async () => 'vault',
      readTicket: async (id: string) => (id === 'T-0042' ? { ok: true, text: `# ${id}` } : { ok: false, error: `${id} is not on the board` }),
    });
    await expect(tools.call('ticket_read', { id: 't-0042' })).resolves.toBe('# T-0042');
    await expect(tools.call('ticket_read', { id: 'T-9999' })).resolves.toBe('Error: T-9999 is not on the board');
    await expect(tools.call('ticket_read', { id: 't-42' })).resolves.toContain('Error: ticket_read needs a ticket id');
  });

  it('vault_read reads a note of a registered vault through the shared tool set', async () => {
    const tools = new MissionTools({
      host: hostOf({ 'daily/2026/11/2026-11-15.md': '# Today\n\nThe board is quiet.' }),
      vaultId: async () => 'vault',
    });
    await expect(tools.call('vault_read', { path: 'daily/2026/11/2026-11-15.md' })).resolves.toContain('1: # Today');
  });

  it('vault_search finds notes across the registered vaults', async () => {
    const tools = new MissionTools({
      host: hostOf({ 'a.md': 'work\n# Note\nThe board is quiet.', 'b.md': 'play' }),
      vaultId: async () => 'vault',
    });
    await expect(tools.call('vault_search', { query: 'quiet' })).resolves.toContain('a.md');
  });

  it('a write tool never runs and an excluded one reads as unknown', async () => {
    const tools = new MissionTools({ host: hostOf({ 'a.md': 'x' }), vaultId: async () => 'vault' });
    await expect(tools.call('vault_edit', { path: 'a.md', edits: [] })).resolves.toContain('Error:');
    await expect(tools.call('tasks_list', {})).resolves.toBe('Error: there is no tool "tasks_list".');
  });
});
