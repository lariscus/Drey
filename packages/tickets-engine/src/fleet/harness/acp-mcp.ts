/**
 * The vault MCP over ACP (req-167, ADR-0094): every ACP harness takes MCP
 * servers in `session/new` / `session/resume` / `session/load`
 * (`mcpServers`), the HTTP variant when `initialize` advertises
 * `agentCapabilities.mcpCapabilities.http` — measured on opencode 2.0.32 and
 * Kimi 2.5.2 (both `http: true`); Copilot CLI from its documentation. The
 * token rides a header of the protocol message: never a file in the
 * worktree, never the command line.
 */
import type { AcpMcpServer, WorkerMcpLaunch, WorkerMcpServer } from './contract';

/** The launch every ACP harness gets: no file, no argument, the server for the session. */
export function acpMcpLaunch(server: WorkerMcpServer): WorkerMcpLaunch {
  return {
    files: [],
    args: [],
    acpServers: [{ type: 'http', name: server.name, url: server.url, headers: [{ name: 'Authorization', value: `Bearer ${server.token}` }] }],
  };
}

/** Whether `initialize` advertised HTTP MCP servers. */
export function offersHttpMcp(agentCapabilities: Readonly<Record<string, unknown>>): boolean {
  const mcp = agentCapabilities['mcpCapabilities'];
  return typeof mcp === 'object' && mcp !== null && (mcp as Record<string, unknown>)['http'] === true;
}

/**
 * The `mcpServers` a session opens with, and the one stream line when the
 * run was given the vault and the agent cannot take it.
 */
export function sessionMcpServers(
  launch: WorkerMcpLaunch | undefined,
  agentCapabilities: Readonly<Record<string, unknown>>,
  agent: string,
): { readonly servers: readonly AcpMcpServer[]; readonly note: string | null } {
  const servers = launch?.acpServers ?? [];
  if (servers.length === 0) {
    return { servers: [], note: null };
  }
  return offersHttpMcp(agentCapabilities)
    ? { servers, note: null }
    : { servers: [], note: `${agent} offers no HTTP MCP server at initialize — this run has no vault` };
}
