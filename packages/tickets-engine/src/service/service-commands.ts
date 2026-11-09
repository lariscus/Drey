/**
 * The terminal commands of Drey Service (req-164): `--status`, `--stop`,
 * `--autostart on|off|status`. Each asks a running service over its control
 * port, or acts on the home when none runs.
 */
import * as path from 'node:path';
import { FileConfigStore } from '../server/file-config';
import { autostartEntry, setAutostart } from './launch';
import type { CliOptions } from './service-args';
import { COMPONENT_NAMES, readServiceLock, serviceAlive, type ServiceLock } from './service-lock';

type StatusReply = { components?: ServiceLock['components']; sleep?: { sleep: boolean; reason?: string }; dreyClients?: number } | null;

function heldLine(sleep: { sleep: boolean; reason?: string }, dreyClients: number | undefined): string {
  const held = sleep.sleep ? 'nothing (it leaves after the idle span)' : (sleep.reason ?? '?');
  return `  held by  ${held}${dreyClients !== undefined ? ` · ${dreyClients} Drey client(s)` : ''}`;
}

/** The `--status` text: one line per component. */
export function formatStatus(lock: ServiceLock, status: StatusReply): string {
  const components = status?.components ?? lock.components;
  const lines = [
    `Drey Service — running (pid ${lock.pid}, since ${lock.startedAt})`,
    `  build    ${lock.build}`,
    `  home     ${lock.home}`,
    `  vault    ${lock.vaultPath}`,
    `  control  127.0.0.1:${lock.port}`,
  ];
  if (status?.sleep !== undefined) {
    lines.push(heldLine(status.sleep, status.dreyClients));
  }
  lines.push('');
  for (const name of COMPONENT_NAMES) {
    const record = components[name];
    lines.push(`  ${name.padEnd(8)} ${(record?.state ?? 'unknown').padEnd(9)} ${record?.detail ?? ''}`.trimEnd());
  }
  return lines.join('\n');
}

const call = (lock: ServiceLock, route: string, init?: { method: 'POST'; body: unknown }): Promise<Response> =>
  fetch(`http://127.0.0.1:${lock.port}${route}`, {
    method: init?.method ?? 'GET',
    headers: { Authorization: `Bearer ${lock.token}`, 'content-type': 'application/json' },
    ...(init === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

async function liveLock(home: string): Promise<ServiceLock | null> {
  const lock = await readServiceLock(home);
  return lock !== null && (await serviceAlive(lock)) ? lock : null;
}

export async function statusCommand(opts: CliOptions, out: (line: string) => void): Promise<number> {
  const lock = await liveLock(opts.home);
  if (lock === null) {
    out(`Drey Service — not running (home ${opts.home})`);
    return 3;
  }
  const reply = await call(lock, '/status').then(
    async (res) => (res.ok ? ((await res.json()) as StatusReply) : null),
    () => null,
  );
  out(formatStatus(lock, reply));
  return 0;
}

export async function stopCommand(opts: CliOptions, out: (line: string) => void): Promise<number> {
  const lock = await liveLock(opts.home);
  if (lock === null) {
    out('Drey Service — not running');
    return 0;
  }
  await call(lock, '/shutdown', { method: 'POST', body: {} }).catch(() => undefined);
  for (let i = 0; i < 300 && (await serviceAlive(lock)); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  out((await serviceAlive(lock)) ? 'Drey Service is still stopping its live runs' : 'Drey Service stopped');
  return 0;
}

/** Start with Windows belongs to the background service: on also switches it on. */
export async function autostartCommand(opts: CliOptions, entry: string, out: (line: string) => void): Promise<number> {
  if (opts.autostart === 'on' || opts.autostart === 'off') {
    const on = opts.autostart === 'on';
    const settings = on ? { enabled: true, autostart: true } : { autostart: false };
    const lock = await liveLock(opts.home);
    if (lock !== null) {
      // A running service owns the setting: it writes it and applies the registry itself.
      await call(lock, '/settings', { method: 'POST', body: settings });
    } else {
      const config = new FileConfigStore(path.join(opts.home, 'config.json'));
      await config.setMany(Object.entries(settings).map(([key, value]) => [`service.${key}`, value] as const));
      await setAutostart(on, { entry, home: opts.home, vaultPath: null });
    }
  }
  const registered = await autostartEntry();
  out(registered === null ? 'start with Windows: off' : `start with Windows: on\n  ${registered}`);
  return 0;
}
