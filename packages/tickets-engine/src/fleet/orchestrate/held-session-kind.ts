import type { RunInfo, RunRequest, SessionSpec } from '../protocol';

/**
 * What differs between the held sessions (req-173): a 1:1 and a free
 * session start the same way — the pool's grant, a quiet worker, the hold
 * — and differ only in what they refuse, how their record reads and what
 * their stream and ticket-less note say. One implementation per kind.
 */
export interface HeldSessionKind<S extends SessionSpec = SessionSpec> {
  /** Why this request cannot start beside the live records; null when it may. */
  refusal(request: RunRequest, spec: S, live: readonly RunInfo[]): string | null;
  /** The record: the new run record shaped as this kind. */
  infoOf(base: RunInfo, spec: S): RunInfo;
  /** The stream's first line. */
  openingLine(id: string, spec: S, request: RunRequest): string;
  /** The bookkeeper's note once the worker waits. */
  note(spec: S, request: RunRequest): string;
  /** `1:1 with ben`, `free session of ben` — the log's words. */
  label(spec: S): string;
}
