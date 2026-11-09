/**
 * A checkout's files read-only on disk, or writable again (req-183, the
 * review checkout's second layer). The Node adapter is `NodeTreeMode`: on
 * POSIX it clears the write bits of every file and folder (nothing can be
 * edited, created or deleted); on Windows it sets the read-only attribute of
 * every file (an existing file cannot be edited or deleted — folders carry
 * no such guard there, so a new file can still be created). Symbolic links
 * and junctions are never followed.
 */
export interface TreeMode {
  setReadOnly(root: string, readOnly: boolean): Promise<void>;
}
