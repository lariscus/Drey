import { describe, expect, it } from 'vitest';
import { harness } from './vault-calls-harness.fake';

/**
 * req-167: a worker's vault calls end to end over a memory disk — the shared
 * tool set, the grant (req-283: the token's project — here drey, Notes read and
 * Work write — and the persona's write-notes), no `vault_delete`, ADR-0060's
 * guard and the audit line on the run's stream.
 */
describe('VaultMcpCalls (req-167)', () => {
  it('offers the six tools, never vault_delete', async () => {
    const names = (await harness().calls.list()).map((t) => t.name);
    expect(names).toEqual(['vault_list', 'vault_search', 'vault_read', 'vault_edit', 'vault_write', 'vault_move']);
    expect((await harness().call('vault_delete', { path: 'w.md', vault: 'work' })).text).toBe('Error: there is no tool "vault_delete".');
  });

  it("reads its project's vaults, and audits the call on the run stream", async () => {
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

  it('refuses a write where the project says Read, with the words the model acts on — audited and logged, nothing written', async () => {
    const h = harness();
    const result = await h.call('vault_write', { path: 'x.md', content: 'x', mode: 'create', vault: 'notes' });
    expect(result).toEqual({ isError: true, text: 'Error: ben may not write vault "notes" (allowed: read)' });
    expect(h.disk.files.has('/v/notes/x.md')).toBe(false);
    expect(h.events[0]).toEqual(expect.objectContaining({ audit: expect.objectContaining({ verdict: 'refused', vault: 'notes', path: 'x.md' }) }));
    expect(h.events[0]!.text).toContain('→ Error: ben may not write vault "notes" (allowed: read)');
    expect(h.logged).toEqual([expect.stringContaining('run run-1 (ben): vault_write notes:x.md refused')]);
  });

  it('writes where the project says Write and the persona may change notes, unasked', async () => {
    const h = harness();
    const result = await h.call('vault_edit', { path: 'w.md', vault: 'work', edits: [{ old_text: 'one', new_text: 'two' }] });
    expect(result.isError).toBe(false);
    expect(h.disk.files.get('/v/work/w.md')!.text).toBe('work two\n');
  });

  it('a run without a persona, and a read-only run, write nowhere', async () => {
    expect((await harness({ persona: null }).call('vault_write', { path: 'n.md', content: 'n', mode: 'create', vault: 'work' })).text).toBe(
      'Error: this run may not write vault "work" (allowed: read)',
    );
    expect((await harness({ readOnly: true }).call('vault_write', { path: 'n.md', content: 'n', mode: 'create', vault: 'work' })).text).toContain('may not write vault "work"');
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

  it("announces a worker's write, edit and move with the vault's folder, and nothing for a read or a refusal (req-213)", async () => {
    const h = harness();
    await h.call('vault_read', { path: 'w.md', vault: 'work' });
    await h.call('vault_write', { path: 'x.md', content: 'x', mode: 'create', vault: 'notes' }); // refused
    expect(h.changes).toEqual([]);
    await h.call('vault_edit', { path: 'w.md', vault: 'work', edits: [{ old_text: 'one', new_text: 'two' }] });
    await h.call('vault_write', { path: 'new.md', content: 'n', mode: 'create', vault: 'work' });
    await h.call('vault_move', { from: 'w.md', to: 'done/w.md', vault: 'work' });
    expect(h.changes).toEqual([
      { vaultPath: '/v/work', changed: ['w.md'], deleted: [] },
      { vaultPath: '/v/work', changed: ['new.md'], deleted: [] },
      // the old path is gone, the new one is there, the note whose link was rewritten changed
      { vaultPath: '/v/work', changed: ['index.md', 'done/w.md'], deleted: ['w.md'] },
    ]);
  });
});

describe('VaultMcpCalls — a tool cut (a 1:1, req-217)', () => {
  const READ = ['vault_list', 'vault_search', 'vault_read'];

  it('offers only the cut and calls nothing outside it', async () => {
    const h = harness({ readOnly: true, tools: READ });
    expect((await h.calls.list(h.session)).map((t) => t.name)).toEqual(READ);
    expect((await h.call('vault_read', { path: 'a.md', vault: 'notes' })).text).toContain('3: alpha');
    expect((await h.call('vault_write', { path: 'x.md', content: 'x', mode: 'create', vault: 'work' })).text).toBe('Error: there is no tool "vault_write".');
    expect((await h.call('vault_move', { from: 'w.md', to: 'z.md', vault: 'work' })).isError).toBe(true);
    expect(h.disk.files.has('/v/work/x.md')).toBe(false);
    expect(h.changes).toEqual([]);
  });

  it('is read-only in the grant itself: even with the write tools offered, a 1:1 token changes nothing', async () => {
    const h = harness({ readOnly: true }); // drey lets ben write "work", but this token is read-only
    const result = await h.call('vault_write', { path: 'x.md', content: 'x', mode: 'create', vault: 'work' });
    expect(result.text).toBe('Error: ben may not write vault "work" (allowed: read)');
    expect(h.disk.files.has('/v/work/x.md')).toBe(false);
  });

  it('audits a refused call on the stream like any other', async () => {
    const h = harness({ readOnly: true, tools: READ });
    await h.call('vault_write', { path: 'x.md', content: 'x', mode: 'create', vault: 'work' });
    expect(h.events.at(-1)).toEqual(expect.objectContaining({ kind: 'tool', tool: 'mcp__drey__vault_write', detail: 'audit' }));
  });

  it('a session without a cut sees all six tools', async () => {
    const h = harness();
    expect((await h.calls.list(h.session)).map((t) => t.name)).toEqual(['vault_list', 'vault_search', 'vault_read', 'vault_edit', 'vault_write', 'vault_move']);
  });
});
