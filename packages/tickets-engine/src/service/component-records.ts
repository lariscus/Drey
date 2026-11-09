/**
 * The four component rows of `service.lock` and `GET /status` (req-164),
 * built from what the host knows at that moment. Pure.
 */
import type { ComponentName, ComponentRecord } from './service-lock';

/** What the rows need of the engine's remote gateway (`Engine.remoteStatus`). */
export interface GatewayView {
  readonly config: { readonly enabled: boolean };
  readonly listening: string | null;
  readonly deviceUrl: string | null;
  readonly devices: readonly unknown[];
  readonly error: string | null;
}

export interface RecordInputs {
  /** The engine's invoke URL; null before the engine is up. */
  readonly engineUrl: string | null;
  readonly vaultPath: string;
  readonly runner: ComponentRecord;
  readonly gateway: GatewayView | null;
  /** The vault MCP the workers use (req-167). */
  readonly mcp: ComponentRecord;
}

export function gatewayRecord(remote: GatewayView | null): ComponentRecord {
  if (remote === null) {
    return { state: 'stopped', detail: null };
  }
  if (!remote.config.enabled) {
    return { state: 'stopped', detail: 'remote access is off' };
  }
  if (remote.listening === null) {
    return { state: 'failed', detail: remote.error ?? 'not listening' };
  }
  const devices = remote.devices.length;
  return {
    state: 'running',
    detail: `${remote.deviceUrl ?? remote.listening} · ${devices} paired device${devices === 1 ? '' : 's'}`,
    port: Number(remote.listening.slice(remote.listening.lastIndexOf(':') + 1)),
  };
}

export function componentRecords(inputs: RecordInputs): Record<ComponentName, ComponentRecord> {
  return {
    engine:
      inputs.engineUrl === null
        ? { state: 'starting', detail: null }
        : { state: 'running', detail: inputs.vaultPath, port: Number(new URL(inputs.engineUrl).port) },
    runner: inputs.runner,
    gateway: gatewayRecord(inputs.gateway),
    mcp: inputs.mcp,
  };
}
