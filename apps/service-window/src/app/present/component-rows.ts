/** The Components tab's list (board 8a): one view model per row, detail line and buttons included. */
import type { I18n } from '../../../../../shared/i18n';
import type {
  ComponentAction,
  ComponentId,
  ComponentState,
  ServiceSnapshot,
  SessionRun,
} from '../../../../../shared/service-window/contract';
import { capitalize, clock, joinParts, spanSince } from './format';

export type DotKind = 'running' | 'off' | 'failed' | 'warn';
export type RowIcon = 'restart' | 'stop' | 'start';

export interface RowButton {
  readonly action: ComponentAction;
  readonly icon: RowIcon;
  readonly label: string;
}

export interface ComponentRowVm {
  readonly id: ComponentId;
  readonly name: string;
  readonly detail: string;
  readonly dot: DotKind;
  readonly buttons: readonly RowButton[];
}

export function dotOf(state: ComponentState): DotKind {
  if (state === 'running') {
    return 'running';
  }
  if (state === 'failed') {
    return 'failed';
  }
  return state === 'starting' ? 'warn' : 'off';
}

const LIVE_STATES: readonly SessionRun['state'][] = ['starting', 'running', 'stopping'];

function oneToOnePart(i18n: I18n, runs: readonly SessionRun[], nowMs: number): string | null {
  const held = runs.find((run) => (run.kind === '1:1' || run.interactive) && run.held && LIVE_STATES.includes(run.state));
  if (held === undefined || held.persona === null) {
    return null;
  }
  return i18n.t('service_window.component.one_to_one', {
    persona: capitalize(held.persona),
    span: spanSince(i18n, held.lastActivity, nowMs),
  });
}

function stateWord(i18n: I18n, state: ComponentState): string | null {
  if (state === 'starting') {
    return i18n.t('service_window.component.starting');
  }
  if (state === 'stopped') {
    return i18n.t('service_window.component.stopped');
  }
  return null;
}

function runnerDetail(i18n: I18n, snapshot: ServiceSnapshot, runs: readonly SessionRun[], nowMs: number): string {
  const runner = snapshot.components.runner;
  if (runner.state === 'sleeping') {
    return i18n.t('service_window.component.asleep');
  }
  if (runner.state === 'failed') {
    return runner.reason ?? i18n.t('service_window.component.failed');
  }
  return (
    stateWord(i18n, runner.state) ??
    joinParts([
      i18n.t('service_window.status.runs_live', { count: runner.liveRuns }),
      oneToOnePart(i18n, runs, nowMs),
    ])
  );
}

function engineDetail(i18n: I18n, snapshot: ServiceSnapshot): string {
  const engine = snapshot.components.engine;
  if (engine.state === 'failed') {
    return i18n.t('service_window.component.failed');
  }
  return (
    stateWord(i18n, engine.state) ??
    joinParts([
      engine.address,
      engine.vaultName === null ? null : i18n.t('service_window.component.vault', { name: engine.vaultName }),
    ])
  );
}

function gatewayDetail(i18n: I18n, snapshot: ServiceSnapshot): string {
  const gateway = snapshot.components.gateway;
  if (gateway.state === 'running' || gateway.state === 'external') {
    return joinParts([gateway.address, i18n.t('service_window.component.devices', { count: gateway.devices })]);
  }
  return gateway.reason ?? i18n.t('service_window.component.gateway_off');
}

function modelDetail(i18n: I18n, snapshot: ServiceSnapshot): string {
  const model = snapshot.components.model;
  if (model.reachable === null) {
    return '';
  }
  if (model.reachable) {
    return i18n.t('service_window.component.reachable');
  }
  return joinParts([
    i18n.t('service_window.component.not_reachable'),
    model.lastSeen === null ? null : i18n.t('service_window.component.last_seen', { time: clock(model.lastSeen) }),
  ]);
}

function buttonsFor(i18n: I18n, id: ComponentId, name: string, state: ComponentState): readonly RowButton[] {
  const button = (action: ComponentAction): RowButton => ({
    action,
    icon: action,
    label: i18n.t(`service_window.action.${action}`, { name }),
  });
  switch (id) {
    case 'engine':
      return [button('restart')];
    case 'runner':
      return state === 'sleeping' ? [button('restart'), button('start')] : [button('restart'), button('stop')];
    case 'gateway':
      return state === 'running' ? [button('restart'), button('stop')] : [button('start')];
    default:
      return [];
  }
}

export function componentRows(
  i18n: I18n,
  snapshot: ServiceSnapshot | null,
  runs: readonly SessionRun[],
  nowMs: number,
): readonly ComponentRowVm[] {
  if (snapshot === null) {
    return [];
  }
  const { engine, runner, mcp, gateway, model } = snapshot.components;
  const row = (id: ComponentId, name: string, state: ComponentState, detail: string): ComponentRowVm => ({
    id,
    name,
    detail,
    dot: dotOf(state),
    buttons: buttonsFor(i18n, id, name, state),
  });
  const modelState: ComponentState =
    model.reachable === true ? 'running' : model.reachable === false ? 'failed' : 'stopped';
  const modelName =
    model.name === null
      ? i18n.t('service_window.component.model')
      : i18n.t('service_window.component.model_named', { name: model.name });
  return [
    row('engine', i18n.t('service_window.component.engine'), engine.state, engineDetail(i18n, snapshot)),
    row('runner', i18n.t('service_window.component.runner'), runner.state, runnerDetail(i18n, snapshot, runs, nowMs)),
    row('mcp', i18n.t('service_window.component.mcp'), mcp.state, mcp.detail ?? ''),
    row('gateway', i18n.t('service_window.component.gateway'), gateway.state, gatewayDetail(i18n, snapshot)),
    row('model', modelName, modelState, modelDetail(i18n, snapshot)),
  ];
}
