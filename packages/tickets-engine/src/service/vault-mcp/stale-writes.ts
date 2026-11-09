/**
 * ADR-0060's mtime guard for a worker (req-167): a file the worker read with
 * `vault_read` and that changed on disk since — the owner saved it in Drey, a
 * phone did — is not overwritten or edited from the stale read; the call is
 * refused with an `Error:` that says to read it again. A file the worker
 * never read is guarded by the edit's own rule (the old text must match the
 * file as it is now) and a create's (the file must not exist).
 */

const keyOf = (vault: string, path: string): string => `${vault}\n${path}`;

export class StaleWriteGuard {
  private readonly seen = new Map<string, number>();

  /** The worker read (or wrote) the file at this modification time. */
  saw(vault: string, path: string, mtime: number): void {
    this.seen.set(keyOf(vault, path), mtime);
  }

  /** The refusal when the file changed since the worker last saw it; null otherwise. */
  refusal(vault: string, path: string, mtimeNow: number | null): string | null {
    const seen = this.seen.get(keyOf(vault, path));
    if (seen === undefined || mtimeNow === seen) {
      return null;
    }
    return mtimeNow === null
      ? `Error: ${path} was deleted since you read it — nothing was written. Check with vault_list before you write it again.`
      : `Error: ${path} changed on disk since you read it — nothing was written. Read it again with vault_read, then make your change.`;
  }
}
