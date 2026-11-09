/** The Sessions tab's left list (board 8b): summary line, rows, the ended-today group. */
import type { I18n } from '../../../../../shared/i18n';
import type { SessionRun } from '../../../../../shared/service-window/contract';
import { capitalize, joinParts, spanSince, spanUntil } from './format';

export type SessionDot = 'running' | 'held' | 'off' | 'failed';

export interface SessionRowVm {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly dot: SessionDot;
  readonly live: boolean;
  readonly held: boolean;
  /** The icon button: stop ends the run, release lets a held session go. */
  readonly buttonLabel: string;
}

export interface SessionListVm {
  readonly summary: string;
  readonly live: readonly SessionRowVm[];
  readonly endedCount: number;
  readonly ended: readonly SessionRowVm[];
}

export function isLive(run: SessionRun): boolean {
  return run.state === 'starting' || run.state === 'running' || run.state === 'stopping';
}

/** A persona's 1:1 (req-168), or an interactive dialog drawn as one. */
export function isOneToOne(run: SessionRun): boolean {
  return run.kind === '1:1' || run.interactive;
}

/** A session in the owner's sense (R12): a 1:1, a free session, a shape session — anything that is not a ticket run. */
export function isSession(run: SessionRun): boolean {
  return run.kind !== 'run' || run.interactive;
}

/** `T-0121 · build · Ben`; `1:1 · Ben` / `free · Ben` for the sessions (an interactive dialog draws as a 1:1). */
export function sessionTitle(i18n: I18n, run: SessionRun): string {
  const persona = run.persona === null ? null : capitalize(run.persona);
  if (isOneToOne(run)) {
    return persona === null ? run.ticketId : i18n.t('service_window.sessions.one_to_one', { persona });
  }
  if (run.kind === 'free' || run.kind === 'shape') {
    const key = run.kind === 'free' ? 'service_window.sessions.free' : 'service_window.sessions.shape';
    return persona === null ? run.ticketId : i18n.t(key, { persona });
  }
  return joinParts([run.ticketId, run.phase, persona]);
}

function activityPart(i18n: I18n, run: SessionRun, nowMs: number): string {
  if (run.sessionState === 'queued') {
    return i18n.t('service_window.sessions.state.queued');
  }
  // Board 8b: a held session says when its idle release falls.
  if (run.held && run.releaseAt !== null && run.turn !== 'busy') {
    return i18n.t('service_window.sessions.releases_in', { span: spanUntil(i18n, run.releaseAt, nowMs) });
  }
  if (run.held) {
    return i18n.t('service_window.sessions.held_line');
  }
  if (run.turn === 'busy') {
    return i18n.t('service_window.sessions.writing');
  }
  return i18n.t('service_window.sessions.quiet', { span: spanSince(i18n, run.lastActivity, nowMs) });
}

function rowOf(i18n: I18n, run: SessionRun, nowMs: number): SessionRowVm {
  const live = isLive(run);
  const title = sessionTitle(i18n, run);
  let dot: SessionDot = 'off';
  if (live) {
    dot = run.held ? 'held' : 'running';
  } else if (run.state === 'failed') {
    dot = 'failed';
  }
  return {
    id: run.id,
    title,
    detail: joinParts([
      run.provider,
      run.model,
      run.turns === null ? null : i18n.t('service_window.sessions.turn', { turn: run.turns }),
      live ? activityPart(i18n, run, nowMs) : run.state,
    ]),
    dot,
    live,
    held: run.held,
    buttonLabel: i18n.t(run.held ? 'service_window.sessions.release' : 'service_window.sessions.stop', { name: title }),
  };
}

export function sessionList(i18n: I18n, runs: readonly SessionRun[], nowMs: number): SessionListVm {
  const live = runs.filter(isLive);
  const ended = runs.filter((run) => !isLive(run));
  return {
    summary: joinParts([
      i18n.t('service_window.sessions.count', { count: live.length }),
      i18n.t('service_window.sessions.runs', { count: live.filter((run) => !isSession(run)).length }),
      i18n.t('service_window.sessions.held', { count: live.filter((run) => run.held).length }),
    ]),
    live: live.map((run) => rowOf(i18n, run, nowMs)),
    endedCount: ended.length,
    ended: ended.map((run) => rowOf(i18n, run, nowMs)),
  };
}
