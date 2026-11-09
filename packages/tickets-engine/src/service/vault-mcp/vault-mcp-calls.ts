/**
 * One worker's vault tool calls (req-167, ADR-0094): the shared tool set
 * (`shared/vault-tools`, ADR-0071 — the one implementation) over the
 * registered vaults on disk, with the worker's rights (R5: reads everything,
 * writes where its persona allows), no `vault_delete`, the app's own folders
 * protected, ADR-0060's stale-write guard, and every call audited on the
 * run's stream. A refusal is the tool's `Error:` text the model acts on —
 * no dialog: a detached run cannot wait for a click.
 */
import { LinkRewriter } from '../../../../../shared/link-rewriter';
import { fail, VaultTools, type McpToolDef, type McpToolResult, type VaultCallOptions, type VaultToolDeps } from '../../../../../shared/vault-tools';
import { DiskToolVault, type VaultSite } from './disk-tool-vault';
import type { PersonaRights } from './persona-rights';
import type { TokenSession } from './run-tokens';
import { VaultCallAuditor } from './vault-call-auditor';
import { vaultCallTarget, type VaultCallTarget } from './vault-call-target';
import type { VaultDisk } from './vault-disk';

/** What every worker call is allowed beside its grant. */
const WORKER_OPTIONS: VaultCallOptions = { write: 'auto', exclude: ['vault_delete', 'tasks_list'], protectAppFolders: true };
const GUARDED = (name: string, args: Readonly<Record<string, unknown>>): boolean => name === 'vault_edit' || (name === 'vault_write' && args['mode'] === 'overwrite');
const TOUCHES_FILE = new Set(['vault_read', 'vault_edit', 'vault_write']);

export interface VaultMcpCallsDeps {
  readonly vaults: { current(): Promise<VaultSite[]> };
  readonly disk: VaultDisk;
  readonly rights: PersonaRights;
  readonly auditor: VaultCallAuditor;
  /** A worker changed files: the vault's paths, for whoever listens (Drey's paths channel — a follow-up). */
  readonly changed?: (vaultPath: string, paths: readonly string[]) => void;
}

export class VaultMcpCalls {
  constructor(private readonly deps: VaultMcpCallsDeps) {}

  /** What a worker is offered: the six tools, never `vault_delete`. */
  async list(): Promise<McpToolDef[]> {
    return this.toolsOver(new DiskToolVault(await this.deps.vaults.current(), this.deps.disk)).list(WORKER_OPTIONS);
  }

  async call(session: TokenSession, name: string, args: Readonly<Record<string, unknown>>): Promise<McpToolResult> {
    const timer = this.deps.auditor.start();
    const vault = new DiskToolVault(await this.deps.vaults.current(), this.deps.disk);
    const grant = await this.deps.rights.grantFor(session.grant);
    const options: VaultCallOptions = { ...WORKER_OPTIONS, grant };
    const target = vaultCallTarget(vault, options, name, args);
    const stale = await this.staleRefusal(session, vault, { name, args, target, writable: grant.vaults });
    const result = stale ?? (await this.toolsOver(vault).call(name, { ...args }, options));
    if (result.isError !== true) {
      await this.remember(session, vault, name, target);
    }
    this.deps.auditor.audit(session, { name, target, result, timer });
    return result;
  }

  private async staleRefusal(
    session: TokenSession,
    vault: DiskToolVault,
    call: { name: string; args: Readonly<Record<string, unknown>>; target: VaultCallTarget; writable: readonly string[] },
  ): Promise<McpToolResult | null> {
    const { vault: id, path } = call.target;
    if (id === null || path === null || !call.writable.includes(id) || !GUARDED(call.name, call.args)) {
      return null;
    }
    const refusal = session.reads.refusal(id, path, await vault.mtimeOf(path, id));
    return refusal === null ? null : fail(refusal);
  }

  /** A read (or the worker's own write) is the state its next change is made from. */
  private async remember(session: TokenSession, vault: DiskToolVault, name: string, target: VaultCallTarget): Promise<void> {
    if (!TOUCHES_FILE.has(name) || target.vault === null || target.path === null) {
      return;
    }
    const mtime = await vault.mtimeOf(target.path, target.vault);
    if (mtime !== null) {
      session.reads.saw(target.vault, target.path, mtime);
    }
  }

  private toolsOver(vault: DiskToolVault): VaultTools {
    const sites = new Map(vault.listVaults().map((site) => [site.id, site.path]));
    const deps: VaultToolDeps = {
      vault,
      getSearchProvider: () => null,
      getTaskProvider: () => null,
      getConfig: () => ({ mcp: { yolo: false } }),
      // A worker is never asked: its writes are `auto` within its grant, and a delete is not offered.
      confirmWrite: () => Promise.resolve(false),
      approve: () => Promise.resolve(false),
      rename: (request) => new LinkRewriter(vault).apply(request),
      announce: ({ vaultId, changedPaths, deletedPaths }) => this.deps.changed?.(sites.get(vaultId) ?? vaultId, [...changedPaths, ...deletedPaths]),
      announceRefresh: () => undefined,
    };
    return new VaultTools(deps);
  }
}
