/** The Components tab's status line (board 8a): one line of what the service is doing. */
import type { I18n } from '../../../../../shared/i18n';
import type { ComponentState, ServiceSnapshot } from '../../../../../shared/service-window/contract';
import { clock, joinParts, money } from './format';

export interface StatusLineVm {
  readonly running: boolean;
  readonly text: string;
}

function countRunning(snapshot: ServiceSnapshot): number {
  const states: readonly ComponentState[] = [
    snapshot.components.engine.state,
    snapshot.components.runner.state,
    snapshot.components.mcp.state,
    snapshot.components.gateway.state,
  ];
  return states.filter((state) => state === 'running').length;
}

function spendPart(i18n: I18n, spend: ServiceSnapshot['spend']): string | null {
  if (spend === null) {
    return null;
  }
  const spent = money(i18n, spend.spent);
  return spend.limit === null
    ? i18n.t('service_window.status.spend_only', { spent })
    : i18n.t('service_window.status.spend', { spent, limit: money(i18n, spend.limit) });
}

/** Null snapshot (the bridge rejected, the service is gone) reads as stopped. */
export function statusLine(i18n: I18n, snapshot: ServiceSnapshot | null): StatusLineVm {
  if (snapshot === null || !snapshot.running) {
    return { running: false, text: i18n.t('service_window.status.stopped') };
  }
  return {
    running: true,
    text: joinParts([
      snapshot.startedAt === null ? null : i18n.t('service_window.status.since', { time: clock(snapshot.startedAt) }),
      snapshot.pid === null ? null : i18n.t('service_window.status.pid', { pid: snapshot.pid }),
      i18n.t('service_window.status.components', { count: countRunning(snapshot) }),
      i18n.t('service_window.status.runs_live', { count: snapshot.components.runner.liveRuns }),
      spendPart(i18n, snapshot.spend),
    ]),
  };
}
