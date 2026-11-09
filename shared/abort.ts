/**
 * Cancellation, the one convention both hosts of the vault tools use
 * (ADR-0014, ADR-0071): an aborted call rejects with fetch's `AbortError`
 * shape, and a cancellation is the user's, never an `Error:` result for the
 * model. Moved here from `electron/llm/llm-tasks.ts` when the vault tool set
 * moved into `shared/` (req-167); that file re-exports it.
 */

/**
 * Whether an error is "the user pressed Cancel" rather than a failure.
 * `fetch` rejects an aborted request with an `AbortError`; Node also
 * surfaces the signal's reason, so both shapes are checked.
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.name === 'TimeoutError';
  }
  return false;
}

/** The message a cancelled generation reports. */
export const CANCELLED_MESSAGE = 'Generation cancelled.';

/**
 * The error a cancelled generation rejects with: fetch's `AbortError`
 * shape, so `isAbortError` recognizes it on every path — including the
 * pre-check of a queued tool call whose ask was cancelled before it ran.
 */
export function cancelledError(): Error {
  return Object.assign(new Error(CANCELLED_MESSAGE), { name: 'AbortError' });
}

/**
 * Whether a signal is aborted. A helper (not an inline `aborted === true`)
 * so a pre-check and a later catch-time re-check of the SAME signal do not
 * fall to TypeScript's control-flow narrowing — the abort can land between
 * them, during the awaited call.
 */
export function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
