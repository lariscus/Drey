/** The Sessions tab's header facts and the Process view (board 8b). */
import type { I18n } from '../../../../../shared/i18n';
import type { ServiceSnapshot, SessionRun, StreamEvent } from '../../../../../shared/service-window/contract';
import { compact, joinParts, money, shortRef } from './format';
import { mcpStats } from './stream-rows';

export interface FactVm {
  readonly label: string;
  /** A mono lead (the session ref), drawn before the value. */
  readonly mono: string | null;
  readonly value: string;
}

export interface ProcessRowVm {
  readonly label: string;
  readonly value: string;
}

/** `R-20261107T0833-c02e · pid 19877 · origin chain · fresh`. */
export function idLine(i18n: I18n, run: SessionRun): string {
  return joinParts([
    run.id,
    run.pid === null ? null : i18n.t('service_window.detail.pid', { pid: run.pid }),
    run.origin === null ? null : i18n.t('service_window.detail.origin', { origin: run.origin }),
    run.handoverMode,
  ]);
}

function harnessFact(i18n: I18n, run: SessionRun): string {
  return joinParts([
    run.provider,
    run.model,
    run.permission === null ? null : i18n.t('service_window.fact.permission', { mode: run.permission }),
  ]);
}

function tokensFact(i18n: I18n, run: SessionRun): string {
  const input = compact(i18n, run.tokensIn);
  return joinParts([
    run.cacheReadTokens > 0
      ? i18n.t('service_window.fact.tokens_in_cached', { input, cached: compact(i18n, run.cacheReadTokens) })
      : i18n.t('service_window.fact.tokens_in', { input }),
    i18n.t('service_window.fact.tokens_out', { output: compact(i18n, run.tokensOut) }),
    run.costUsd === null ? null : money(i18n, run.costUsd),
  ]);
}

function mcpFact(i18n: I18n, events: readonly StreamEvent[]): string {
  const stats = mcpStats(events);
  if (stats.calls === 0) {
    return '';
  }
  const calls = [
    i18n.t('service_window.fact.mcp_calls', { count: stats.calls }),
    stats.refused > 0 ? i18n.t('service_window.fact.mcp_refused', { count: stats.refused }) : '',
  ]
    .filter((part) => part !== '')
    .join(', ');
  return joinParts([...stats.servers, calls]);
}

function slotFact(i18n: I18n, run: SessionRun, snapshot: ServiceSnapshot | null): string {
  if (run.slot === null) {
    return '';
  }
  const q = snapshot?.slots?.find((slot) => slot.id === run.slot?.id)?.q ?? null;
  return joinParts([
    run.slot.label,
    run.grantClass === null ? null : i18n.t('service_window.fact.slot_class', { class: run.grantClass }),
    q === null ? null : i18n.t('service_window.slots.q', { q: i18n.formatNumber(q, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }),
  ]);
}

export function sessionFacts(
  i18n: I18n,
  run: SessionRun,
  snapshot: ServiceSnapshot | null,
  events: readonly StreamEvent[],
): readonly FactVm[] {
  return [
    { label: i18n.t('service_window.fact.harness'), mono: null, value: harnessFact(i18n, run) },
    {
      label: i18n.t('service_window.fact.session_ref'),
      mono: run.sessionRef === null ? null : shortRef(run.sessionRef),
      value: run.sessionRef === null ? '' : i18n.t('service_window.fact.resumable'),
    },
    { label: i18n.t('service_window.fact.tokens'), mono: null, value: tokensFact(i18n, run) },
    { label: i18n.t('service_window.fact.mcp'), mono: null, value: mcpFact(i18n, events) },
    { label: i18n.t('service_window.fact.slot'), mono: null, value: slotFact(i18n, run, snapshot) },
    // Model runs are light seats by definition; heavy tasks are the governor's (req-180).
    { label: i18n.t('service_window.fact.seats'), mono: null, value: i18n.t('service_window.fact.seats_light') },
  ];
}

export function processRows(i18n: I18n, run: SessionRun): readonly ProcessRowVm[] {
  const row = (key: 'pid' | 'state' | 'harness' | 'started' | 'ended' | 'worktree' | 'directory' | 'session_ref' | 'origin', value: string): ProcessRowVm => ({
    label: i18n.t(`service_window.process.${key}`),
    value,
  });
  const stamp = (iso: string | null): string => (iso === null ? '' : i18n.formatDateTime(new Date(iso)));
  return [
    row('pid', run.pid === null ? '' : String(run.pid)),
    row('state', run.state),
    row('harness', joinParts([run.provider, run.model])),
    row('started', stamp(run.startedAt)),
    row('ended', stamp(run.endedAt)),
    // R12: a 1:1 works in the tickets repository, not in a worktree — the row names the directory.
    run.kind === 'run' ? row('worktree', run.worktreePath) : row('directory', run.workingDirectory),
    row('session_ref', run.sessionRef ?? ''),
    row('origin', joinParts([run.origin, run.handoverMode])),
  ];
}
