/**
 * The `mcp` component of Drey Service (req-167, ADR-0094, ADR-0092 later
 * change): the vault MCP the workers use, served by the service so a run has
 * the vault whether Drey is open or not. It listens on a loopback port of its
 * own for as long as the service runs, and is the Crew runner's
 * {@link WorkerVaultGate}: at each spawn it mints the worker's token, hands
 * the harness its configuration (the adapter's `mcpLaunch`), and when the
 * worker exits the token dies and the config file goes. Drey's own MCP server
 * for other programs (Claude Desktop, the stdio bridge) stays in the Drey
 * process — a follow-up moves it here.
 */
import type { McpToolDef, McpToolResult } from '../../../../../shared/vault-tools';
import type { WorkerMcpLaunch, WorkerMcpServer } from '../../fleet/harness/contract';
import type { VaultGrantRequest, WorkerVaultAccess, WorkerVaultGate } from '../../fleet/orchestrate/worker-vault';
import type { ComponentRecord } from '../service-lock';
import type { LaunchFiles } from './launch-files';
import type { RunTokens, TokenSession } from './run-tokens';
import { VAULT_MCP_NAME } from './vault-call-auditor';
import type { VaultMcpCalls } from './vault-mcp-calls';
import type { McpEndpoint, VaultMcpHandler } from './vault-mcp-http';

export interface VaultMcpComponentDeps {
  /** The HTTP face, built over this component as its handler. */
  readonly endpoint: (handler: VaultMcpHandler) => McpEndpoint;
  readonly tokens: RunTokens;
  readonly calls: VaultMcpCalls;
  readonly files: LaunchFiles;
  readonly now: () => Date;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
  /** The component changed state: the service rewrites its lock. */
  readonly onChange: () => void;
}

export class VaultMcpComponent implements WorkerVaultGate, VaultMcpHandler {
  private readonly endpoint: McpEndpoint;
  private port: number | null = null;
  private failure: string | null = null;

  constructor(private readonly deps: VaultMcpComponentDeps) {
    this.endpoint = deps.endpoint(this);
  }

  async start(): Promise<void> {
    try {
      this.port = await this.endpoint.listen();
      this.failure = null;
      this.deps.log(`vault MCP listening on 127.0.0.1:${this.port}/mcp`);
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error);
      this.deps.log(`vault MCP could not listen: ${this.failure}`, 'error');
    }
    this.deps.onChange();
  }

  async stop(): Promise<void> {
    await this.endpoint.close().catch(() => undefined);
    this.port = null;
  }

  record(): ComponentRecord {
    if (this.port === null) {
      return this.failure === null ? { state: 'starting', detail: null } : { state: 'failed', detail: this.failure };
    }
    const live = this.deps.tokens.live;
    return { state: 'running', detail: `127.0.0.1:${this.port} · ${live} worker${live === 1 ? '' : 's'}`, port: this.port };
  }

  open(request: VaultGrantRequest, describe: ((server: WorkerMcpServer) => WorkerMcpLaunch) | null): WorkerVaultAccess | null {
    if (describe === null || this.port === null) {
      const why = describe === null ? `${request.harness} takes no MCP configuration` : 'the vault MCP is not listening';
      request.emit({ ts: this.deps.now().toISOString(), kind: 'note', detail: 'runner', text: `${why} — this run has no vault` });
      return null;
    }
    const { emit, runId, ticketId, persona, readOnly } = request;
    const token = this.deps.tokens.mint({ runId, ticketId, persona, readOnly, emit });
    const launch = describe({ name: VAULT_MCP_NAME, url: `http://127.0.0.1:${this.port}/mcp`, token, runDir: request.runDir });
    try {
      launch.files.forEach((file) => this.deps.files.write(file.path, file.text));
    } catch (error) {
      this.deps.tokens.revoke(token);
      request.emit({ ts: this.deps.now().toISOString(), kind: 'note', detail: 'runner', text: `the vault MCP configuration could not be written (${String(error)}) — this run has no vault` });
      return null;
    }
    this.deps.onChange();
    return { launch, close: () => this.close(token, launch) };
  }

  resolve(token: string): TokenSession | null {
    return this.deps.tokens.resolve(token);
  }

  list(): Promise<McpToolDef[]> {
    return this.deps.calls.list();
  }

  call(session: TokenSession, name: string, args: Readonly<Record<string, unknown>>): Promise<McpToolResult> {
    return this.deps.calls.call(session, name, args);
  }

  private close(token: string, launch: WorkerMcpLaunch): void {
    this.deps.tokens.revoke(token);
    launch.files.forEach((file) => {
      try {
        this.deps.files.remove(file.path);
      } catch {
        // A file that is gone already is what closing wants.
      }
    });
    this.deps.onChange();
  }
}
