/**
 * IPC contract, plain-folder part (req-285, board 7n)
 * (`shared/ipc-api.ts` is the barrel).
 *
 * A project may name plain folders outside every vault; the Files panel
 * shows them read-only while the title bar's project filter is set. This
 * is the one read the renderer needs for them: one level of one folder.
 */

/** One entry of a plain-folder listing. */
export interface PlainFolderEntry {
  readonly name: string;
  readonly type: 'file' | 'directory';
}

/** A path in a plain folder: an absolute root and a forward-slash sub-path under it ('' = the root). */
export interface PlainFolderListRequest {
  readonly root: string;
  readonly rel: string;
}

/** Reading a plain folder outside the vaults. */
export interface FoldersIpc {
  /**
   * One level of `root/rel`: directories first, then files, each by name;
   * names starting with `.` are skipped. Rejects a non-absolute root, a
   * `rel` that resolves outside the root (symlinks included), and a folder
   * that does not exist. The files it lists become readable (never
   * writable) through `readExternalFile`. No writes.
   */
  listPlainFolder(request: PlainFolderListRequest): Promise<PlainFolderEntry[]>;

  /**
   * Shows `root/rel` (a file or folder) selected in the OS file manager.
   * The same checks as `listPlainFolder`: an absolute root, nothing outside it.
   */
  revealPlainFolderPath(request: PlainFolderListRequest): Promise<void>;
}
