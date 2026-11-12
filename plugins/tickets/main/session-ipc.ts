/**
 * req-173's plugin IPC: the vault layer of the configuration (Settings →
 * Tickets reads and patches `tickets/_meta/crew.md` through the engine) and
 * the free sessions (the Crew tab's "New session…"). Each forwards to the
 * engine's invoke channel, which checks the payload again
 * (`packages/tickets-engine/src/server/session-payloads.ts`); the origin of
 * a session started here is always Drey's Crew tab.
 */
import type { MainPluginContext } from '../../../shared/plugin-api';

type Invoke = (method: string, payload?: unknown) => Promise<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function registerSessionIpc(ctx: Pick<MainPluginContext, 'ipc'>, invoke: Invoke): void {
  ctx.ipc.handle('crewConfig', () => invoke('crewConfig'));
  ctx.ipc.handle('crewConfigSet', (payload) => (Array.isArray(payload) || isRecord(payload) ? invoke('crewConfigSet', payload) : { ok: false, error: 'bad crew patch payload' }));
  ctx.ipc.handle('crewOrderSet', (payload) => (Array.isArray(payload) || isRecord(payload) ? invoke('crewOrderSet', payload) : { ok: false, error: 'bad crew order payload' }));
  ctx.ipc.handle('sessionOptions', () => invoke('sessionOptions'));
  ctx.ipc.handle('sessionStart', (payload) => (isRecord(payload) ? invoke('sessionStart', { ...payload, origin: 'drey:crew' }) : { ok: false, error: 'bad session payload' }));
}
