/**
 * What every changing tool shares (ADR-0071): the call's write context, the
 * race of a user wait against the call's cancellation, and the refusals —
 * writes switched off, the app's own folders, and a vault the caller's
 * grant leaves read-only (req-167, R5).
 */
import { cancelledError } from '../abort';
import type { ScopedVault, ToolScope } from './scope';
import { fail, type McpToolResult, type VaultCallOptions, type VaultToolDeps, type VaultWriteGrant, type VaultWriteRule } from './types';

export interface WriteContext {
  deps: VaultToolDeps;
  scope: ToolScope;
  rule: VaultWriteRule;
  origin: NonNullable<VaultCallOptions['origin']>;
  onChange?: VaultCallOptions['onChange'];
  /** The call's cancellation signal: the user-dialog waits race against it. */
  signal?: AbortSignal;
  /** Per-vault write rights (req-167): absent = the rule alone decides. */
  grant?: VaultWriteGrant;
}

/**
 * Races one wait on the user against the call's cancellation signal: an
 * abort rejects with the `AbortError` shape (the dialog itself stays
 * open until answered — it has no dismiss seam; the raced answer is
 * discarded).
 */
export function raceSignal<T>(wait: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return wait;
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(cancelledError());
    const detach = (): void => signal.removeEventListener('abort', onAbort);
    if (signal.aborted) {
      onAbort();
      // The raced wait's eventual outcome is discarded; swallow it so it
      // does not surface as an unhandled rejection.
      void wait.catch(() => undefined);
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    void wait.then(
      (value) => {
        detach();
        resolve(value);
      },
      (err) => {
        detach();
        reject(err);
      },
    );
  });
}

export const WRITES_OFF =
  'Error: changing files is switched off for the assistant (Settings → Assistant tools). Tell the user what you would have changed instead.';

export function refuseProtected(path: string): McpToolResult {
  return fail(
    `Error: ${path} belongs to the app (chat notes and drafts) and cannot be changed with this tool.`,
  );
}

/** The refusal of a change to a vault the caller's grant leaves read-only; null when it may write there. */
export function refuseUngranted(ctx: WriteContext, vault: ScopedVault): McpToolResult | null {
  const { grant } = ctx;
  if (grant === undefined || grant.vaults.includes(vault.id)) {
    return null;
  }
  return fail(`Error: ${grant.who} may not write vault "${vault.id}" (allowed: read)`);
}
