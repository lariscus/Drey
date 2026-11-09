/** The Governor block of board 8a (req-180): heavy and light seats, the reserve against the load, the waiting tasks, the dev servers. */
import type { I18n, MessageKey } from '../../../../../shared/i18n';
import type { GovernorFacts, LoadFacts } from '../../../../../shared/service-window/contract';

export interface GovernorRowVm {
  readonly label: string;
  readonly value: string;
}

const TASK_KEYS: Readonly<Record<string, MessageKey>> = {
  tests: 'service_window.governor.task.tests',
  build: 'service_window.governor.task.build',
  'dev server': 'service_window.governor.task.dev_server',
  browser: 'service_window.governor.task.browser',
  command: 'service_window.governor.task.command',
};

/** While the runner sleeps nothing runs: no seat busy, nothing waits, the load unmeasured. */
function idleGovernor(load: LoadFacts): GovernorFacts {
  return { heavy: { busy: 0, total: load.heavySeats, holders: [] }, light: { busy: 0, total: null }, load: null, reserve: load.reserve, quietUntil: null, waiting: [], devServers: [] };
}

function task(i18n: I18n, name: string): string {
  const key = TASK_KEYS[name];
  return key === undefined ? name : i18n.t(key);
}

function heavyValue(i18n: I18n, g: GovernorFacts): string {
  const busy = i18n.t('service_window.governor.heavy_value', { busy: g.heavy.busy, total: g.heavy.total });
  const holders = g.heavy.holders.map((h) => i18n.t('service_window.governor.heavy_holder', { task: task(i18n, h.task), ticket: h.ticket }));
  return [busy, ...(holders.length > 0 ? [holders.join(', ')] : [])].join(' · ');
}

function lightValue(i18n: I18n, g: GovernorFacts): string {
  return g.light.total === null
    ? i18n.t('service_window.governor.light_value_open', { busy: g.light.busy })
    : i18n.t('service_window.governor.light_value', { busy: g.light.busy, total: g.light.total });
}

function reserveValue(i18n: I18n, g: GovernorFacts): string {
  return g.load === null
    ? i18n.t('service_window.governor.reserve_value_unmeasured', { percent: g.reserve })
    : i18n.t('service_window.governor.reserve_value', { percent: g.reserve, load: g.load });
}

function waitingValue(i18n: I18n, g: GovernorFacts): string {
  const first = g.waiting[0];
  if (first === undefined) {
    return i18n.t('service_window.governor.none');
  }
  const tasks = g.waiting.map((w) => i18n.t('service_window.governor.waiting_task', { task: task(i18n, w.task), ticket: w.ticket })).join(', ');
  const when =
    first.cause === 'quiet' && g.quietUntil !== null
      ? i18n.t('service_window.governor.waiting_quiet', { time: g.quietUntil })
      : i18n.t(first.cause === 'load' ? 'service_window.governor.waiting_load' : 'service_window.governor.waiting_seats');
  return i18n.t('service_window.governor.waiting_value', { count: g.waiting.length, tasks, when });
}

function devValue(i18n: I18n, g: GovernorFacts): string {
  if (g.devServers.length === 0) {
    return i18n.t('service_window.governor.none');
  }
  const ports = g.devServers.map((d) => i18n.t('service_window.governor.dev_port', { port: d.port, ticket: d.ticket })).join(', ');
  return i18n.t('service_window.governor.dev_value', { count: g.devServers.length, ports });
}

export function governorRows(i18n: I18n, load: LoadFacts, governor: GovernorFacts | null): readonly GovernorRowVm[] {
  const g = governor ?? idleGovernor(load);
  return [
    { label: i18n.t('service_window.governor.heavy_seats'), value: heavyValue(i18n, g) },
    { label: i18n.t('service_window.governor.light_seats'), value: lightValue(i18n, g) },
    { label: i18n.t('service_window.governor.reserve'), value: reserveValue(i18n, g) },
    { label: i18n.t('service_window.governor.waiting'), value: waitingValue(i18n, g) },
    { label: i18n.t('service_window.governor.dev_servers'), value: devValue(i18n, g) },
  ];
}
