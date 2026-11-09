/**
 * The vault tool set (ADR-0021, recut in ADR-0071) lives in
 * `shared/vault-tools/` since req-167 (ADR-0071 later change): one
 * implementation over the `ToolVault` port, built here over `VaultManager`
 * for programs on Drey's MCP server and the assistant's tool loop, and in
 * Drey Service over the files on disk for the workers (ADR-0094). This file
 * keeps the main process's import path.
 */
export { VaultTools, NO_VAULT } from '../../shared/vault-tools';
export type {
  ApproveAction,
  ConfirmWrite,
  McpTextContent,
  McpToolDef,
  McpToolResult,
  OpenDocs,
  VaultCallOptions,
  VaultToolDeps,
  VaultWriteRule,
} from '../../shared/vault-tools';
