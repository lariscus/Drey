import type { MessageKey, MessageParams } from '../../../../shared/i18n';
import type { McpStatus } from '../../../../shared/ipc-api';
import {
  SERVICE_LOG_LEVELS,
  type ServiceAction,
  type StatusAction,
  type ServiceComponentId,
  type ServiceLogLevel,
  type ServiceStatusReply,
} from '../../../../shared/service-settings';

/**
 * The pure half of Settings → Background service (req-165, board 8c): what
 * the service's status says on the page. No DOM, no Angular -- the page and
 * its specs share it. Every word is a catalog key with its params, so the
 * page reads it through the `t` pipe (ADR-0091).
 */

/** The page's four groups, in order. */
export const SERVICE_GROUPS = ['service', 'components', 'load', 'logs'] as const;

/** A state value as the board writes it: `running · 2 live`. */
export interface StateWords {
  readonly key: MessageKey;
  readonly params?: MessageParams;
}

/** Which control carries a component's buttons: the service's own API, the runner's, or the setting that switches it. */
export type ServiceControlRoute = 'runner' | 'gateway' | 'mcp';

export interface ComponentRow {
  readonly id: ServiceComponentId;
  readonly nameKey: MessageKey;
  readonly descKey: MessageKey | null;
  readonly state: StateWords;
  /** The buttons right of the state, in the board's order (Restart, Stop, or Start). */
  readonly actions: readonly ServiceAction[];
  /** `null` for the engine: it runs as long as the service does and has no buttons. */
  readonly route: ServiceControlRoute | null;
}

/** The status item's line (`Running since 08:12 · 4 components · 2 runs live`), or `null` when the service is not running. */
export interface StatusLine {
  readonly since: Date;
  readonly components: number;
  readonly runs: number;
}

/** The four components of the board, whatever their state. */
export const SERVICE_COMPONENT_COUNT = 4;

export function statusLineOf(status: ServiceStatusReply): StatusLine | null {
  const since = status.startedAt === null ? null : new Date(status.startedAt);
  return status.running && since !== null && !Number.isNaN(since.getTime())
    ? { since, components: SERVICE_COMPONENT_COUNT, runs: status.liveRuns }
    : null;
}

/** The status item's buttons: a running service restarts or stops, a stopped one starts. */
export function statusActionsOf(status: ServiceStatusReply): readonly StatusAction[] {
  return status.running ? ['open', 'restart', 'stop'] : ['start'];
}

const OFF: StateWords = { key: 'settings.service.state.off' };

/** The engine's row: always on while the service runs. */
function engineRow(status: ServiceStatusReply): ComponentRow {
  return {
    id: 'engine',
    nameKey: 'settings.service.engine.name',
    descKey: 'settings.service.engine.desc',
    state: status.running ? { key: 'settings.service.state.running' } : OFF,
    actions: [],
    route: null,
  };
}

/** The Crew runner: it sleeps on demand, so a sleeping runner offers Start. */
function runnerRow(status: ServiceStatusReply): ComponentRow {
  const state = status.components.runner;
  const base = { id: 'runner', nameKey: 'settings.service.runner.name', descKey: null, route: 'runner' } as const;
  if (!status.running) {
    return { ...base, state: OFF, actions: [] };
  }
  switch (state) {
    case 'running':
      return {
        ...base,
        state:
          status.liveRuns > 0
            ? { key: 'settings.service.state.running_live', params: { count: status.liveRuns } }
            : { key: 'settings.service.state.running' },
        actions: ['restart', 'stop'],
      };
    case 'starting':
      return { ...base, state: { key: 'settings.service.state.starting' }, actions: [] };
    case 'failed':
      return { ...base, state: { key: 'settings.service.state.failed' }, actions: ['start'] };
    default:
      return { ...base, state: { key: 'settings.service.state.sleeping' }, actions: ['start'] };
  }
}

/** Drey's own MCP server for other programs (the workers' vault MCP is Drey Service's since req-167): running while the HTTP endpoint listens. */
function mcpRow(mcp: McpStatus | null): ComponentRow {
  const base = { id: 'mcp', nameKey: 'settings.service.mcp.name', descKey: null, route: 'mcp' } as const;
  return mcp !== null && mcp.enabled && mcp.httpListening && mcp.httpPort !== null
    ? {
        ...base,
        state: { key: 'settings.service.state.running_address', params: { address: `127.0.0.1:${mcp.httpPort}` } },
        actions: ['restart', 'stop'],
      }
    : { ...base, state: OFF, actions: mcp === null ? [] : ['start'] };
}

/** The remote gateway: follows Settings → Remote access; only a running service hosts it. */
function gatewayRow(status: ServiceStatusReply): ComponentRow {
  const base = { id: 'gateway', nameKey: 'settings.service.gateway.name', descKey: 'settings.service.gateway.desc', route: 'gateway' } as const;
  const { gateway } = status;
  if (!status.running) {
    return { ...base, state: OFF, actions: [] };
  }
  if (gateway.failed) {
    return { ...base, state: { key: 'settings.service.state.failed' }, actions: ['restart', 'stop'] };
  }
  if (gateway.listening) {
    return {
      ...base,
      state: { key: 'settings.service.state.running_devices', params: { devices: gateway.devices } },
      actions: ['restart', 'stop'],
    };
  }
  return { ...base, state: OFF, actions: ['start'] };
}

/** The Components group, in the board's order: engine, runner, MCP server, gateway. */
export function componentRowsOf(status: ServiceStatusReply, mcp: McpStatus | null): readonly ComponentRow[] {
  return [engineRow(status), runnerRow(status), mcpRow(mcp), gatewayRow(status)];
}

export const SERVICE_ACTION_KEYS: Readonly<Record<StatusAction, MessageKey>> = {
  open: 'settings.service.action.open',
  restart: 'settings.service.action.restart',
  stop: 'settings.service.action.stop',
  start: 'settings.service.action.start',
};

export const LOG_LEVEL_KEYS: Readonly<Record<ServiceLogLevel, MessageKey>> = {
  quiet: 'settings.service.logs.level.quiet',
  normal: 'settings.service.logs.level.normal',
  detailed: 'settings.service.logs.level.detailed',
};

export const LOG_LEVEL_CHOICES = SERVICE_LOG_LEVELS;
