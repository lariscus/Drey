/**
 * The files of the registered vaults as the vault MCP reaches them (req-167):
 * a port, so the tool vault and its specs never touch `node:fs` — the Node
 * adapter is {@link NodeVaultDisk}. Paths are absolute; the served-path rule
 * (`core/note-path.ts`) is applied by the caller and again by
 * {@link VaultDisk.staysServed} where links lead.
 */

export interface VaultDiskEntry {
  readonly name: string;
  readonly kind: 'file' | 'dir' | 'other';
}

export interface VaultDisk {
  /** Whether the folder exists right now. */
  isFolder(abs: string): Promise<boolean>;
  /** Whether `rel` below `root`, resolved through links, stays inside the vault and is served. */
  staysServed(root: string, rel: string): Promise<boolean>;
  /** The folder's entries; empty when it is missing. */
  list(abs: string): Promise<readonly VaultDiskEntry[]>;
  /** The file's text; rejects when it cannot be read. */
  readText(abs: string): Promise<string>;
  /** The file's modification time in whole milliseconds; null when it is missing. */
  mtimeOf(abs: string): Promise<number | null>;
  /** Writes atomically, creating missing folders. */
  writeText(abs: string, text: string): Promise<void>;
  /** Moves a file or folder, creating the target's folders; rejects when the target exists. */
  rename(fromAbs: string, toAbs: string): Promise<void>;
  copy(fromAbs: string, toAbs: string): Promise<void>;
  removeDirIfEmpty(abs: string): Promise<void>;
  /** `root` joined with a vault-relative `a/b/c` path. */
  join(root: string, rel: string): string;
}
