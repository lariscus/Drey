/**
 * One worker's vault tool calls (req-167, ADR-0094): the shared tool set
 * (`shared/vault-tools`, ADR-0071 — the one implementation) over the
 * registered vaults on disk, with the worker's rights (req-283: it reaches
 * its project's vaults and plain folders, writes where the project says Write
 * and its persona may change notes), no `vault_delete`, the app's own folders
 * protected, ADR-0060's stale-write guard, and every call audited on the
 * run's stream. A refusal is the tool's `Error:` text the model acts on —
 * no dialog: a detached run cannot wait for a click.
 */
import { LinkRewriter } from '../../../../../shared/link-rewriter';
import { cleanPath, fail, VaultTools, type McpToolDef, type McpToolResult, type VaultCallOptions, type VaultToolDeps } from '../../../../../shared/vault-tools';
import { DiskToolVault, type VaultSite } from './disk-tool-vault';
import { ChangeCollector } from './change-collector';
import type { PersonaRecordTools } from './persona-record-tools';
import type { ProjectRights } from './project-rights';
import type { TokenSession } from './run-tokens';
import { VaultCallAuditor } from './vault-call-auditor';
import { vaultCallTarget, type VaultCallTarget } from './vault-call-target';
import type { VaultDisk } from './vault-disk';
import type { VaultPathsChange } from './vault-paths-change';

/** What every worker call is allowed beside its grant. */
const WORKER_OPTIONS: VaultCallOptions = { write: 'auto', exclude: ['vault_delete', 'tasks_list'], protectAppFolders: true };
const GUARDED = (name: string, args: Readonly<Record<string, unknown>>): boolean => name === 'vault_edit' || (name === 'vault_write' && args['mode'] === 'overwrite');
const TOUCHES_FILE = new Set(['vault_read', 'vault_edit', 'vault_write']);

export interface VaultMcpCallsDeps {
  readonly vaults: { current(): Promise<VaultSite[]> };
  readonly disk: VaultDisk;
  readonly rights: ProjectRights;
  readonly auditor: VaultCallAuditor;
  /**
   * A worker changed files: the vault's folder and the vault-relative paths
   * that changed or went away (a move = both), for whoever listens — the
   * engine's paths channel tells Drey's vault round (req-213).
   */
  readonly changed?: (change: VaultPathsChange) => void;
  /** req-226: `memory_write` / `journal_write` for a ticket run's persona; absent = not served. */
  readonly records?: PersonaRecordTools;
}

export class VaultMcpCalls {
  constructor(private readonly deps: VaultMcpCallsDeps) {}

  /** What a worker is offered: the six tools, never `vault_delete`; a session with a tool cut (a 1:1) sees the cut. */
  async list(session?: TokenSession): Promise<McpToolDef[]> {
    const tools = this.toolsOver(new DiskToolVault(await this.deps.vaults.current(), this.deps.disk));
    return [...(await tools.list(await this.optionsOf(tools, session?.grant.tools))), ...(this.deps.records?.list(session) ?? [])];
  }

  async call(session: TokenSession, name: string, args: Readonly<Record<string, unknown>>): Promise<McpToolResult> {
    const timer = this.deps.auditor.start();
    const records = this.deps.records;
    if (records?.handles(name) === true) {
      const result = await records.call(session, name, args);
      this.deps.auditor.audit(session, { name, target: records.targetOf(session, name), result, timer });
      return result;
    }
    // req-283: only what the token's project reaches exists for this call — any other vault is "not available".
    const { sites, grant } = await this.deps.rights.reachOf(session.grant, await this.deps.vaults.current());
    const vault = new DiskToolVault(sites, this.deps.disk);
    const collector = new ChangeCollector();
    const tools = this.toolsOver(vault, collector);
    const options: VaultCallOptions = { ...(await this.optionsOf(tools, session.grant.tools)), grant };
    const target = vaultCallTarget(vault, options, name, args);
    const stale = await this.staleRefusal(session, vault, { name, args, target, writable: grant.vaults });
    const result = stale ?? (await tools.call(name, { ...args }, options));
    if (result.isError !== true) {
      await this.remember(session, vault, name, target);
      this.announce(vault, collector, { name, args, target });
    }
    this.deps.auditor.audit(session, { name, target, result, timer });
    return result;
  }

  /** A successful call's changes go to whoever listens, one report per vault (req-213). */
  private announce(vault: DiskToolVault, collector: ChangeCollector, call: { name: string; args: Readonly<Record<string, unknown>>; target: VaultCallTarget }): void {
    if (this.deps.changed === undefined) {
      return;
    }
    if (call.name === 'vault_move' && call.target.vault !== null) {
      collector.addMove(call.target.vault, cleanPath(call.args['from']), cleanPath(call.args['to']));
    }
    const sites = new Map(vault.listVaults().map((site) => [site.id, site.path]));
    collector.changes((id) => sites.get(id) ?? id).forEach((change) => this.deps.changed?.(change));
  }

  /** The worker options; a tool cut leaves every other tool neither listed nor callable. */
  private async optionsOf(tools: VaultTools, only: readonly string[] | undefined): Promise<VaultCallOptions> {
    if (only === undefined) {
      return WORKER_OPTIONS;
    }
    const offered = (await tools.list(WORKER_OPTIONS)).map((tool) => tool.name);
    return { ...WORKER_OPTIONS, exclude: [...(WORKER_OPTIONS.exclude ?? []), ...offered.filter((name) => !only.includes(name))] };
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

  private toolsOver(vault: DiskToolVault, collector: ChangeCollector = new ChangeCollector()): VaultTools {
    const deps: VaultToolDeps = {
      vault,
      getSearchProvider: () => null,
      getTaskProvider: () => null,
      getConfig: () => ({ mcp: { yolo: false } }),
      // A worker is never asked: its writes are `auto` within its grant, and a delete is not offered.
      confirmWrite: () => Promise.resolve(false),
      approve: () => Promise.resolve(false),
      rename: (request) => new LinkRewriter(vault).apply(request),
      announce: ({ vaultId, changedPaths, deletedPaths }) => collector.add(vaultId, changedPaths, deletedPaths),
      announceRefresh: () => undefined,
    };
    return new VaultTools(deps);
  }
}
