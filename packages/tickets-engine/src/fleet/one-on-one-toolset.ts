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
 *   The fleet's read tools and the vault read tools (ADR-0071, served by
 *   Drey Service — req-167) reach the harness through its MCP
 *   configuration; until that capability is on the base, nothing is
 *   attached ({@link OneOnOneToolSeam}) and the brief names no tool.
 *
 * Never the build set, never a shell in a worktree, never a tool that writes.
 */

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

/**
 * The one named seam where the 1:1's MCP tools are attached (ADR-0093 ×
 * ADR-0094): the harness MCP configuration of req-167 implements it; the
 * names it answers are what the brief names. Until then {@link NO_TOOLS}.
 */
export interface OneOnOneToolSeam {
  /** The tool names attached to a 1:1 of this persona — always a subset of {@link ONE_ON_ONE_TOOLS}. */
  attached(persona: string): readonly string[];
}

/** No MCP tool reaches a 1:1 yet (req-167's harness MCP configuration is not on this base). */
export const NO_TOOLS: OneOnOneToolSeam = { attached: () => [] };
