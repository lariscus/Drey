import type { McpStatus } from '../../../../shared/ipc-api';
import { SERVICE_STOPPED, type ServiceStatusReply } from '../../../../shared/service-settings';
import { componentRowsOf, statusActionsOf, statusLineOf } from './service-model';

const running = (patch: Partial<ServiceStatusReply> = {}): ServiceStatusReply => ({
  running: true,
  home: 'C:\\Users\\x\\.drey-engine',
  startedAt: '2026-11-08T08:12:00',
  liveRuns: 2,
  gateway: { enabled: false, listening: false, devices: 0, failed: false },
  components: { engine: 'running', runner: 'running' },
  ...patch,
});

const mcp = (patch: Partial<McpStatus> = {}): McpStatus => ({
  enabled: true,
  httpListening: true,
  httpPort: 4319,
  stdioBridgePath: '',
  ...patch,
});

describe('the status item (board 8c)', () => {
  it('names the start time, the four components and the live runs of a running service', () => {
    const line = statusLineOf(running());
    expect(line).not.toBeNull();
    expect(line?.since.getHours()).toBe(8);
    expect(line?.components).toBe(4);
    expect(line?.runs).toBe(2);
  });

  it('has no line while the service is not running, or the start time is unreadable', () => {
    expect(statusLineOf(SERVICE_STOPPED)).toBeNull();
    expect(statusLineOf(running({ startedAt: 'yesterday-ish' }))).toBeNull();
    expect(statusLineOf(running({ startedAt: null }))).toBeNull();
  });

  it('offers Restart and Stop to a running service, Start to a stopped one', () => {
    expect(statusActionsOf(running())).toEqual(['restart', 'stop']);
    expect(statusActionsOf(SERVICE_STOPPED)).toEqual(['start']);
  });
});

describe('the Components group (board 8c)', () => {
  const row = (rows: ReturnType<typeof componentRowsOf>, id: string) => rows.find((r) => r.id === id)!;

  it('lists the engine, the Crew runner, the MCP server and the remote gateway in the board order', () => {
    expect(componentRowsOf(running(), mcp()).map((r) => r.id)).toEqual(['engine', 'runner', 'mcp', 'gateway']);
  });

  it('draws the board state: running · 2 live with Restart and Stop; the engine without buttons', () => {
    const rows = componentRowsOf(running(), mcp());
    expect(row(rows, 'engine')).toMatchObject({ state: { key: 'settings.service.state.running' }, actions: [], route: null });
    expect(row(rows, 'runner')).toMatchObject({
      state: { key: 'settings.service.state.running_live', params: { count: 2 } },
      actions: ['restart', 'stop'],
      route: 'runner',
    });
  });

  it('says plain running when no run is live', () => {
    const rows = componentRowsOf(running({ liveRuns: 0 }), mcp());
    expect(row(rows, 'runner').state).toEqual({ key: 'settings.service.state.running' });
  });

  it('shows a sleeping runner with Start, a failed one with Start, a starting one with nothing', () => {
    const state = (runner: 'sleeping' | 'failed' | 'starting') =>
      row(componentRowsOf(running({ components: { engine: 'running', runner } }), mcp()), 'runner');
    expect(state('sleeping')).toMatchObject({ state: { key: 'settings.service.state.sleeping' }, actions: ['start'] });
    expect(state('failed')).toMatchObject({ state: { key: 'settings.service.state.failed' }, actions: ['start'] });
    expect(state('starting').actions).toEqual([]);
  });

  it('reads the MCP server from Drey: the address while its endpoint listens, off otherwise', () => {
    expect(row(componentRowsOf(running(), mcp()), 'mcp')).toMatchObject({
      state: { key: 'settings.service.state.running_address', params: { address: '127.0.0.1:4319' } },
      actions: ['restart', 'stop'],
      route: 'mcp',
    });
    expect(row(componentRowsOf(running(), mcp({ httpListening: false })), 'mcp')).toMatchObject({
      state: { key: 'settings.service.state.off' },
      actions: ['start'],
    });
    expect(row(componentRowsOf(running(), null), 'mcp').actions).toEqual([]);
  });

  it('draws the gateway as the board does when off (Start) and with its devices when it listens', () => {
    expect(row(componentRowsOf(running(), mcp()), 'gateway')).toMatchObject({
      state: { key: 'settings.service.state.off' },
      actions: ['start'],
      route: 'gateway',
    });
    const listening = running({ gateway: { enabled: true, listening: true, devices: 2, failed: false } });
    expect(row(componentRowsOf(listening, mcp()), 'gateway')).toMatchObject({
      state: { key: 'settings.service.state.running_devices', params: { devices: 2 } },
      actions: ['restart', 'stop'],
    });
    const failed = running({ gateway: { enabled: true, listening: false, devices: 0, failed: true } });
    expect(row(componentRowsOf(failed, mcp()), 'gateway').state).toEqual({ key: 'settings.service.state.failed' });
  });

  it('with no service running every service component reads off and has no buttons; the MCP server is Drey\'s own', () => {
    const rows = componentRowsOf(SERVICE_STOPPED, mcp());
    for (const id of ['engine', 'runner', 'gateway']) {
      expect(row(rows, id)).toMatchObject({ state: { key: 'settings.service.state.off' }, actions: [] });
    }
    expect(row(rows, 'mcp').actions).toEqual(['restart', 'stop']);
  });
});
