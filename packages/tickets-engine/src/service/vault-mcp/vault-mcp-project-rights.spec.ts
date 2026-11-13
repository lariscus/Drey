import { describe, expect, it } from 'vitest';
import { harness } from './vault-calls-harness.fake';

/**
 * req-283 (concept §2, §3, §10; ADR-0094 later change): the token carries the
 * project. drey gives Notes (read), Work (write) and the folder /f/specs;
 * lariscus Private (read) and /f/shared; Loose is in no project. ben has
 * `write-notes`, ralf has not.
 */
describe('VaultMcpCalls — vault rights per project (req-283)', () => {
  it("vault_list shows only the project's vaults and folders", async () => {
    const listing = (await harness().call('vault_list', {})).text;
    expect(listing).toContain('notes:a.md');
    expect(listing).toContain('work:w.md');
    expect(listing).toContain('folder-specs:spec.md');
    expect(listing).not.toMatch(/private|loose|shared|\.git/);
  });

  it('refuses a vault outside the project with the shared wording, audited as a refusal and logged', async () => {
    const h = harness();
    const result = await h.call('vault_read', { path: 'p.md', vault: 'private' });
    expect(result).toEqual({ isError: true, text: 'Error: vault "private" is not available to this call. Pass one of: "notes" (Notes), "work" (Work), "folder-specs" (/f/specs).' });
    expect(h.events.at(-1)!.audit).toEqual(expect.objectContaining({ vault: 'private', verdict: 'refused' }));
    expect(h.logged).toEqual([expect.stringContaining('run run-1 (ben): vault_read private:')]);
  });

  it('writes only where all three hold: the project says Write, the persona has write-notes, the run is not read-only', async () => {
    expect((await harness().call('vault_write', { path: 'n.md', content: 'n', mode: 'create', vault: 'work' })).isError).toBe(false);
    expect((await harness().call('vault_write', { path: 'n.md', content: 'n', mode: 'create', vault: 'notes' })).text).toBe('Error: ben may not write vault "notes" (allowed: read)');
    expect((await harness({ persona: 'ralf' }).call('vault_write', { path: 'n.md', content: 'n', mode: 'create', vault: 'work' })).text).toBe('Error: ralf may not write vault "work" (allowed: read)');
    expect((await harness({ readOnly: true }).call('vault_write', { path: 'n.md', content: 'n', mode: 'create', vault: 'work' })).text).toBe('Error: ben may not write vault "work" (allowed: read)');
  });

  it('a run without a project, or with one the board does not know, reaches no vault', async () => {
    for (const project of [null, 'gone']) {
      const h = harness({ scope: { kind: 'project', project } });
      expect((await h.call('vault_list', {})).text).toBe('Error: no vault is available to this call.');
      expect(h.events.at(-1)!.audit!.verdict).toBe('refused');
    }
  });

  it('an unreadable board gives no vault, never every vault', async () => {
    const h = harness();
    h.board.projectList = null;
    expect((await h.call('vault_read', { path: 'a.md', vault: 'notes' })).text).toBe('Error: no vault is available to this call.');
  });

  it('reads the records at every call: a vault the project stops naming is gone at the next call', async () => {
    const h = harness();
    expect((await h.call('vault_read', { path: 'a.md', vault: 'notes' })).isError).toBe(false);
    h.board.projectList = h.board.projectList!.map((p) => (p.id === 'drey' ? { ...p, vaults: { Work: 'write' } } : p));
    expect((await h.call('vault_read', { path: 'a.md', vault: 'notes' })).text).toMatch(/^Error: vault "notes" is not available to this call/);
  });

  it('a plain folder is read under the vault path rules and never written', async () => {
    const h = harness();
    expect((await h.call('vault_read', { path: 'spec.md', vault: 'folder-specs' })).text).toContain('the rule');
    expect((await h.call('vault_read', { path: '.git/HEAD', vault: 'folder-specs' })).isError).toBe(true);
    expect((await h.call('vault_write', { path: 'x.md', content: 'x', mode: 'create', vault: 'folder-specs' })).text).toBe('Error: ben may not write vault "folder-specs" (allowed: read)');
    expect(h.disk.files.has('/f/specs/x.md')).toBe(false);
  });
});

describe('VaultMcpCalls — a 1:1 reads every project (req-283)', () => {
  const ONE_ON_ONE = { scope: { kind: 'every-project' }, readOnly: true } as const;

  it("reads every project's vaults and folders, and no vault that no project names", async () => {
    const h = harness(ONE_ON_ONE);
    const listing = (await h.call('vault_list', {})).text;
    for (const shown of ['notes:a.md', 'work:w.md', 'private:p.md', 'folder-specs:spec.md', 'folder-shared:s.md']) {
      expect(listing).toContain(shown);
    }
    expect(listing).not.toContain('loose');
    expect((await h.call('vault_read', { path: 'l.md', vault: 'loose' })).text).toMatch(/^Error: vault "loose" is not available to this call/);
  });

  it('writes nothing, even where a project says Write and the persona may change notes', async () => {
    const h = harness({ scope: { kind: 'every-project' }, readOnly: false });
    expect((await h.call('vault_write', { path: 'x.md', content: 'x', mode: 'create', vault: 'work' })).text).toBe('Error: ben may not write vault "work" (allowed: read)');
    expect(h.disk.files.has('/v/work/x.md')).toBe(false);
  });
});
