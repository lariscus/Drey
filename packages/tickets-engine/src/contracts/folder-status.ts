/**
 * Whether the phase folders carry their derived numbers (T-0041, req-50) —
 * moved out of `tickets.ts` with req-282 to keep that file under the size
 * limit; `tickets.ts` re-exports it.
 */
export interface FolderStatus {
  /** Absolute path of `tickets/`; null without a tickets vault. */
  readonly root: string | null;
  /** The renames "Number folders" would make; empty = numbered. */
  readonly moves: readonly { readonly from: string; readonly to: string }[];
}
