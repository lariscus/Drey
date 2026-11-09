import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../../fleet/harness/contract';
import type { VaultSite } from './disk-tool-vault';
import { MemoryVaultDisk } from './memory-vault-disk.fake';
import { PersonaRights } from './persona-rights';
import { RunTokens, type TokenSession } from './run-tokens';
import { VaultCallAuditor } from './vault-call-auditor';
import { VaultMcpCalls } from './vault-mcp-calls';

/**
 * req-167: a worker's vault calls end to end over a memory disk — the shared
 * tool set, the persona's grant (R5), no `vault_delete`, ADR-0060's guard and
 * the audit line on the run's stream.
 */
const SITES: VaultSite[] = [
  { id: 'notes', name: 'Notes', path: '/v/notes', active: true, exists: true },
  { id: 'work', name: 'Work', path: '/v/work', active: false, exists: true },
];

function harness(persona: string | null = 'ben', readOnly = false) {
  const disk = new MemoryVaultDisk()
    .seed('/v/notes', { 'a.md': '# A\n\nalpha\n', 'tickets/T-1.md': 'ticket\n' })
    .seed('/v/work', { 'w.md': 'work one\n', 'index.md': 'See [w](w.md).\n' });
  const events: NormalizedEvent[] = [];
  const logged: string[] = [];
  let clock = 0;
  const calls = new VaultMcpCalls({
    vaults: { current: async () => SITES },
    disk,
    rights: new PersonaRights({ writeVaultsOf: async (id) => (id === 'ben' ? ['work'] : null) }),
    auditor: new VaultCallAuditor({ now: () => new Date(Date.UTC(2026, 10, 9, 12, 0, 0, (clock += 5))), log: (m) => logged.push(m) }),
  });
  const tokens = new RunTokens({ token: () => 'tok', hash: (t) => t });
  const session: TokenSession = tokens.resolve(tokens.mint({ runId: 'run-1', ticketId: 'T-9', persona, readOnly, emit: (e) => events.push(e) }))!;
  const call = async (name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> => {
    const result = await calls.call(session, name, args);
    return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError === true };
  };
  return { calls, disk, events, logged, call };
}

describe('VaultMcpCalls (req-167)', () => {
  it('offers the six tools, never vault_delete', async () => {
    const names = (await harness().calls.list()).map((t) => t.name);
    expect(names).toEqual(['vault_list', 'vault_search', 'vault_read', 'vault_edit', 'vault_write', 'vault_move']);
    expect((await harness().call('vault_delete', { path: 'w.md', vault: 'work' })).text).toBe('Error: there is no tool "vault_delete".');
  });

  it('reads every registered vault, and audits the call on the run stream', async () => {
    const h = harness();
    expect((await h.call('vault_read', { path: 'a.md', vault: 'notes' })).text).toContain('3: alpha');
    expect(h.events).toEqual([
      expect.objectContaining({
        kind: 'tool',
        tool: 'mcp__drey__vault_read',
        detail: 'audit',
        text: 'vault › vault_read notes:a.md · 5 ms',
        audit: { persona: 'ben', vault: 'notes', path: 'a.md', verdict: 'allowed', ms: 5 },
      }),
    ]);
  });

  it('refuses a write where the persona may not, with the words the model acts on — audited and logged, nothing written', async () => {
    const h = harness();
    const result = await h.call('vault_write', { path: 'x.md', content: 'x', mode: 'create', vault: 'notes' });
    expect(result).toEqual({ isError: true, text: 'Error: ben may not write vault "notes" (allowed: read)' });
    expect(h.disk.files.has('/v/notes/x.md')).toBe(false);
    expect(h.events[0]).toEqual(expect.objectContaining({ audit: expect.objectContaining({ verdict: 'refused', vault: 'notes', path: 'x.md' }) }));
    expect(h.events[0]!.text).toContain('→ Error: ben may not write vault "notes" (allowed: read)');
    expect(h.logged).toEqual([expect.stringContaining('run run-1 (ben): vault_write notes:x.md refused')]);
  });

  it('writes where the persona may, unasked', async () => {
    const h = harness();
    const result = await h.call('vault_edit', { path: 'w.md', vault: 'work', edits: [{ old_text: 'one', new_text: 'two' }] });
    expect(result.isError).toBe(false);
    expect(h.disk.files.get('/v/work/w.md')!.text).toBe('work two\n');
  });

  it('a run without a persona, and a read-only run, write nowhere', async () => {
    expect((await harness(null).call('vault_write', { path: 'n.md', content: 'n', mode: 'create', vault: 'work' })).text).toBe(
      'Error: this run may not write vault "work" (allowed: read)',
    );
    expect((await harness('ben', true).call('vault_write', { path: 'n.md', content: 'n', mode: 'create', vault: 'work' })).text).toContain('may not write vault "work"');
  });

  it('refuses an overwrite or edit made from a read the disk has moved past (ADR-0060)', async () => {
    const h = harness();
    await h.call('vault_read', { path: 'w.md', vault: 'work' });
    h.disk.touch('/v/work/w.md', 'the owner saved this\n');
    const overwrite = await h.call('vault_write', { path: 'w.md', content: 'mine', mode: 'overwrite', vault: 'work' });
    expect(overwrite.text).toMatch(/^Error: w\.md changed on disk since you read it/);
    expect(h.disk.files.get('/v/work/w.md')!.text).toBe('the owner saved this\n');
    expect(h.events.at(-1)!.audit!.verdict).toBe('refused');
    await h.call('vault_read', { path: 'w.md', vault: 'work' });
    expect((await h.call('vault_write', { path: 'w.md', content: 'mine', mode: 'overwrite', vault: 'work' })).isError).toBe(false);
  });

  it('its own writes do not count as stale: two edits in a row go through', async () => {
    const h = harness();
    await h.call('vault_read', { path: 'w.md', vault: 'work' });
    expect((await h.call('vault_edit', { path: 'w.md', vault: 'work', edits: [{ old_text: 'one', new_text: 'two' }] })).isError).toBe(false);
    expect((await h.call('vault_edit', { path: 'w.md', vault: 'work', edits: [{ old_text: 'two', new_text: 'three' }] })).isError).toBe(false);
  });

  it('the tickets folder is reached by no tool', async () => {
    const h = harness();
    expect((await h.call('vault_read', { path: 'tickets/T-1.md', vault: 'notes' })).isError).toBe(true);
    expect((await h.call('vault_list', { vault: 'notes' })).text).not.toContain('tickets');
    expect(h.events.at(-2)!.audit!.verdict).toBe('failed');
  });

  it('a move is a write right, and keeps the links of other notes', async () => {
    const h = harness();
    expect((await h.call('vault_move', { from: 'a.md', to: 'b.md', vault: 'notes' })).text).toContain('may not write vault "notes"');
    const moved = await h.call('vault_move', { from: 'w.md', to: 'done/w.md', vault: 'work' });
    expect(moved.text).toContain('Moved w.md → done/w.md.');
    expect(h.disk.files.get('/v/work/index.md')!.text).toBe('See [w](done/w.md).\n');
    expect(h.events.at(-1)!.audit).toEqual(expect.objectContaining({ path: 'w.md → done/w.md', verdict: 'allowed' }));
  });
});
