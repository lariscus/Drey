import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DreyPresence } from '../../../packages/tickets-engine/src/server/drey-presence';
import { ChangeHub } from '../../../packages/tickets-engine/src/server/drey-port';
import { InvokeServer } from '../../../packages/tickets-engine/src/server/invoke-server';
import { InvokeTable } from '../../../packages/tickets-engine/src/server/invoke-table';
import { MemoryVaultDisk } from '../../../packages/tickets-engine/src/service/vault-mcp/memory-vault-disk.fake';
import { ProjectRights } from '../../../packages/tickets-engine/src/service/vault-mcp/project-rights';
import { RunTokens } from '../../../packages/tickets-engine/src/service/vault-mcp/run-tokens';
import { VaultCallAuditor } from '../../../packages/tickets-engine/src/service/vault-mcp/vault-call-auditor';
import { VaultMcpCalls } from '../../../packages/tickets-engine/src/service/vault-mcp/vault-mcp-calls';
import { EngineClient } from './engine-client';
import { PathAnnouncer, type PathAnnouncerDeps } from './path-announcer';

/**
 * req-213, the whole round trip with the IPC faked at its far end: a
 * worker's `vault_write` / `vault_edit` / `vault_move` through the service's
 * vault MCP calls → the hub's paths channel (what `Engine.emitPaths` feeds)
 * → the engine's real event stream over HTTP → the tickets plugin's real
 * `EngineClient` and `PathAnnouncer` → `ctx.vault.announceChanges` (a spy:
 * Drey's vault round, which reloads clean open tabs and refreshes the tag
 * index with the watcher on or off).
 */
const WORK = '/v/work';
const NOTES = '/v/notes';

let hub: ChangeHub;
let presence: DreyPresence;
let server: InvokeServer;
let stop: () => void;
let announce: Mock<PathAnnouncerDeps['announce']>;
let announcer: PathAnnouncer;
let call: (name: string, args: Record<string, unknown>) => Promise<unknown>;

beforeEach(async () => {
  hub = new ChangeHub();
  presence = new DreyPresence(() => undefined, 60_000);
  server = new InvokeServer({ token: 'tok', vaultPath: NOTES, table: new InvokeTable(), hub, presence, log: () => undefined });
  const invokeUrl = await server.listen(0);
  announce = vi.fn<PathAnnouncerDeps['announce']>();
  announcer = new PathAnnouncer({
    // Drey registers only the work vault under another id: the match is by folder.
    listVaults: async () => [{ id: 'drey-work', path: WORK, exists: true }],
    announce,
    debounceMs: 20,
    maxWaitMs: 100,
  });
  stop = new EngineClient({ invokeUrl, token: 'tok' }).onEvent(
    () => undefined,
    undefined,
    (event) => announcer.add(event),
  );
  for (let i = 0; i < 200 && presence.connected === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(presence.connected).toBe(1);

  const disk = new MemoryVaultDisk().seed(WORK, { 'w.md': 'work one\n', 'index.md': 'See [w](w.md).\n' }).seed(NOTES, { 'a.md': 'alpha\n' });
  const calls = new VaultMcpCalls({
    vaults: {
      current: async () => [
        { id: 'work', name: 'Work', path: WORK, active: false, exists: true },
        { id: 'notes', name: 'Notes', path: NOTES, active: true, exists: true },
      ],
    },
    disk,
    // req-283: the token's project gives Work to write and Notes to read; ben may change notes.
    rights: new ProjectRights(
      {
        projects: async () => [{ id: 'drey', name: 'Drey', color: '', repos: [], folders: [], vaults: { Work: 'write', Notes: 'read' }, purpose: '' }],
        writesNotes: async () => true,
      },
      disk,
    ),
    auditor: new VaultCallAuditor({ now: () => new Date(), log: () => undefined }),
    changed: (change) => hub.emitPaths(change), // exactly what the service host wires to `engine.emitPaths`
  });
  const tokens = new RunTokens({ token: () => 'wtok', hash: (t) => t });
  const session = tokens.resolve(tokens.mint({ runId: 'run-1', ticketId: 'T-1', persona: 'ben', readOnly: false, scope: { kind: 'project', project: 'drey' }, emit: () => undefined }))!;
  call = (name, args) => calls.call(session, name, args);
});

afterEach(async () => {
  stop();
  announcer.dispose();
  await server.close();
});

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(check()).toBe(true);
};

describe("a worker's vault write reaches Drey's vault round (req-213)", () => {
  it('announces a vault_write to the vault Drey registered for that folder', async () => {
    await call('vault_write', { path: 'n.md', content: 'new\n', mode: 'create', vault: 'work' });
    await until(() => announce.mock.calls.length > 0);
    expect(announce).toHaveBeenCalledWith({ vaultId: 'drey-work', changedPaths: ['n.md'] });
  });

  it('announces a vault_move as the new path changed and the old one deleted, links included, in one round', async () => {
    await call('vault_move', { from: 'w.md', to: 'done/w.md', vault: 'work' });
    await until(() => announce.mock.calls.length > 0);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith({ vaultId: 'drey-work', changedPaths: ['index.md', 'done/w.md'], deletedPaths: ['w.md'] });
  });

  it('a burst of edits is one round with the last state of each path', async () => {
    await call('vault_edit', { path: 'w.md', vault: 'work', edits: [{ old_text: 'one', new_text: 'two' }] });
    await call('vault_edit', { path: 'w.md', vault: 'work', edits: [{ old_text: 'two', new_text: 'three' }] });
    await until(() => announce.mock.calls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith({ vaultId: 'drey-work', changedPaths: ['w.md'] });
  });

  it('tells Drey nothing for a refused write or a read', async () => {
    await call('vault_read', { path: 'w.md', vault: 'work' });
    await call('vault_write', { path: 'x.md', content: 'x', mode: 'create', vault: 'notes' }); // ben may not write "notes"
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(announce).not.toHaveBeenCalled();
  });
});
