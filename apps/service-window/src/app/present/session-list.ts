/** The Sessions tab's left list (board 8b): summary line, rows, the ended-today group. */
import type { I18n } from '../../../../../shared/i18n';
import type { SessionRun } from '../../../../../shared/service-window/contract';
import { capitalize, joinParts, spanSince } from './format';

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

/** `T-0121 · build · Ben`, or `1:1 · Ben` for an interactive dialog. */
export function sessionTitle(i18n: I18n, run: SessionRun): string {
  const persona = run.persona === null ? null : capitalize(run.persona);
  if (run.interactive) {
    return persona === null ? run.ticketId : i18n.t('service_window.sessions.one_to_one', { persona });
  }
  return joinParts([run.ticketId, run.phase, persona]);
}

function activityPart(i18n: I18n, run: SessionRun, nowMs: number): string {
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
      i18n.t('service_window.sessions.runs', { count: live.filter((run) => !run.interactive).length }),
      i18n.t('service_window.sessions.held', { count: live.filter((run) => run.held).length }),
    ]),
    live: live.map((run) => rowOf(i18n, run, nowMs)),
    endedCount: ended.length,
    ended: ended.map((run) => rowOf(i18n, run, nowMs)),
  };
}
