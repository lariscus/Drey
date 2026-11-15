import type { RunInfo } from '../protocol';

/**
 * The run's working clock (req-67): only busy spans tick — a wait for the
 * owner, a standing held worker and an ended run do not.
 */

/**
 * Whether the run is mid-turn — actually working. A turn the provider has
 * not reported yet presumes working (a run starts busy); a wait for the
 * owner (req-64) is never working.
 */
export function isExecuting(info: RunInfo): boolean {
  return (info.waiting ?? null) === null && (info.turn ?? 'busy') === 'busy';
}

/**
 * Closes the run's open working span at `at`: the elapsed clock freezes
 * from here on. No-op while nothing is open — standing, ended, or a record
 * that predates the exec fields.
 */
export function closeExecSpan(info: RunInfo, at: string): RunInfo {
  if (info.execSince === undefined || info.execSince === null) {
    return info;
  }
  const from = Date.parse(info.execSince);
  const closed = Number.isNaN(from) ? 0 : Math.max(0, Date.parse(at) - from);
  return { ...info, execMs: (info.execMs ?? 0) + closed, execSince: null };
}

/**
 * Folds one event's flip into the busy spans: a flip to busy opens a span
 * at the event's stamp, a flip away closes it there. `was` is the record
 * before the event, `next` the record with the event applied.
 */
export function foldExecSpan(was: RunInfo, next: RunInfo, at: string): RunInfo {
  const busyBefore = isExecuting(was);
  if (isExecuting(next)) {
    if (!busyBefore) {
      return { ...next, execSince: at }; // the turn (re)started: a new span opens here
    }
    if (was.execSince === undefined) {
      return { ...next, execSince: next.startedAt }; // adopted mid-busy with no tracking yet: working since the start
    }
    return was.execSince === null ? { ...next, execSince: at } : next; // re-attached mid-busy: resume here
  }
  if (!busyBefore) {
    return next;
  }
  const from = was.execSince === undefined ? was.startedAt : was.execSince;
  return closeExecSpan({ ...next, execSince: from }, at);
}

/** The record frozen at the run's end: a busy state never reported counts from the start, an open span from its stamp. */
export function freezeExecSpan(info: RunInfo, at: string): RunInfo {
  const open = isExecuting(info) && info.execSince === undefined ? { ...info, execSince: info.startedAt } : info;
  return closeExecSpan(open, at);
}
