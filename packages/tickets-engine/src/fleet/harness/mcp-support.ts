import type { WorkerProviderId } from '../protocol';

/**
 * The harnesses whose adapter describes a worker's MCP configuration
 * (`ProviderAdapter.mcpLaunch`, req-167): Claude Code writes an `mcp.json`,
 * the three ACP agents pass the server in `session/new`. The brief of a 1:1
 * names the vault tools only for these (req-217, ADR-0071's rule).
 * `mcp-support.spec.ts` keeps the list equal to what the adapters carry.
 */
export const MCP_HARNESSES: readonly WorkerProviderId[] = ['claude-code', 'opencode', 'kimi', 'copilot'];

export function harnessTakesMcp(provider: WorkerProviderId): boolean {
  return MCP_HARNESSES.includes(provider);
}
