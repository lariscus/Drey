/**
 * `shared/vault-tools` — the one vault tool set (ADR-0071; moved house in
 * req-167, ADR-0071 later change): names, descriptions, parameters and the
 * tool logic over the `ToolVault` port. Two hosts build it: Drey's main
 * process over `VaultManager` (its own MCP server for other programs and
 * the assistant's tool loop) and Drey Service over the files on disk (the
 * workers' vault MCP, ADR-0094). Import from here, not from a file inside.
 */
export { VaultTools } from './vault-tools';
export { NO_VAULT, fail, ok } from './types';
export type {
  ApproveAction,
  ConfirmWrite,
  McpTextContent,
  McpToolDef,
  McpToolResult,
  OpenDocs,
  ScopeFile,
  ToolVault,
  VaultCallOptions,
  VaultFileChange,
  VaultToolDeps,
  VaultWriteGrant,
  VaultWriteRule,
} from './types';
export { READ_TOOLS, WRITE_TOOLS, WRITE_TOOL_NAMES } from './defs';
