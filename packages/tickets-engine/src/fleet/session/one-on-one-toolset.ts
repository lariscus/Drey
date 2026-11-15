/**
 * The lean 1:1 toolset (req-168, ADR-0093, R1): read access only. What a
 * worker is offered for a ticket run is the build set — its harness's own
 * tools in a worktree with `accept-edits` or `bypass`, and the fleet's
 * MCP tools (`fleet_status`, `fleet_run`, `fleet_stop`, `fleet_steer`,
 * `fleet_watch`, the plugin-tool registry's). A 1:1 keeps the reading half:
 *
 * - the harness's own read tools, in the tickets repository, under the
 *   harness's read-only mode (`PermissionMode 'read-only'`: Claude Code's
 *   `--permission-mode plan`, opencode's and Kimi's `plan`) — the board's
 *   files and the persona's own folder (`memory.md`) are read there;
 * - of the MCP tools, exactly those that read: {@link ONE_ON_ONE_TOOLS}.
 *   The vault read tools (ADR-0071, served by Drey Service — req-167)
 *   reach the harness through its MCP configuration with a read-only
 *   token (req-217): the grant refuses every change and the tool list
 *   offers only {@link ONE_ON_ONE_VAULT_TOOLS}. The fleet's two read tools
 *   are served by Drey's own MCP server, not by the service, so no worker
 *   gets them yet (req-252): the seam answers what is attached, the brief
 *   names exactly that ({@link OneOnOneToolSeam}).
 *
 * Never the build set, never a shell in a worktree, never a tool that writes.
 */
import type { WorkerProviderId } from '../protocol';

/** The MCP tools a 1:1 may be given, by name: every one of them only reads. */
export const ONE_ON_ONE_TOOLS: readonly string[] = ['fleet_status', 'fleet_watch', 'vault_list', 'vault_search', 'vault_read'];

/** A tool as an offer lists it. */
export interface OfferedTool {
  readonly name: string;
}

/** The read-only cut of an offer: what of it a 1:1 may be given, in the offer's order. */
export function cutToOneOnOne<T extends OfferedTool>(offered: readonly T[]): readonly T[] {
  return offered.filter((tool) => ONE_ON_ONE_TOOLS.includes(tool.name));
}

/** The vault tools of that cut: what Drey Service's vault MCP offers a 1:1 (req-217). */
export const ONE_ON_ONE_VAULT_TOOLS: readonly string[] = ONE_ON_ONE_TOOLS.filter((name) => name.startsWith('vault_'));

/** Whose 1:1 a tool question is about: the persona and the harness its session would run on. */
export interface OneOnOneSeat {
  readonly persona: string;
  /** The persona's harness; null = it has none the runner can start (`worker: api`), so no session carries tools. */
  readonly provider: WorkerProviderId | null;
}

/**
 * The one named seam where the 1:1's MCP tools are attached (ADR-0093 ×
 * ADR-0094): Drey Service's vault MCP implements it (req-217,
 * `service/vault-mcp/one-on-one-tools.ts`); the names it answers are what
 * the brief names — ADR-0071's rule, a tool is named only when attached.
 * {@link NO_TOOLS} is the answer without a service (a spec, a standalone
 * engine).
 */
export interface OneOnOneToolSeam {
  /** The tool names attached to this 1:1 — always a subset of {@link ONE_ON_ONE_TOOLS}. */
  attached(seat: OneOnOneSeat): readonly string[];
}

/** No MCP tool reaches a 1:1: there is no vault MCP to attach. */
export const NO_TOOLS: OneOnOneToolSeam = { attached: () => [] };
