/**
 * Running Drey Service (req-164): one service per home — `service.lock`
 * plus a boot claim (`service.starting`) so two Dreys starting at once
 * cannot start two — then the host with its real seams: the registry for
 * start with Windows, the successor of an atomic restart and the window
 * process of the tray (req-165).
 */
import { closeSync, openSync, promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { clientDirOf } from '../server/client-dir';
import { FileConfigStore } from '../server/file-config';
import { serviceLaunchCommand, setAutostart, spawnService, spawnWindow, windowLaunchCommand } from './launch';
import type { CliOptions } from './service-args';
import { ServiceHost } from './service-host';
import { readServiceLock, serviceAlive } from './service-lock';
import { serviceIdleMsOf } from './sleep';
import type { WindowSpawn } from './window-processes';

export const SERVICE_VAULT_KEY = 'service.vaultPath';
export const SERVICE_IDLE_KEY = 'service.idleMinutes';
/** `off` keeps the service from starting a tray process (the e2e fixtures set it). */
export const SERVICE_TRAY_ENV = 'DREY_SERVICE_TRAY';

export interface BootPaths {
  /** The built service entry (this module's sibling `service-main.js`). */
  readonly entry: string;
  /** The repository / app root. */
  readonly appRoot: string;
  readonly build: string;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The boot claim: true when this process may start the service in `home`. */
async function claimBoot(home: string): Promise<boolean> {
  const file = path.join(home, 'service.starting');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      await fsp.writeFile(file, String(process.pid), 'utf8');
      closeSync(fd);
      return true;
    } catch {
      const pid = Number(await fsp.readFile(file, 'utf8').catch(() => ''));
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && processAlive(pid)) {
        return false;
      }
      await fsp.rm(file, { force: true });
    }
  }
  return false;
}

function windowSpawn(paths: BootPaths, home: string): WindowSpawn | undefined {
  if (process.env[SERVICE_TRAY_ENV] === 'off') {
    return undefined;
  }
  return (mode) => spawnWindow(windowLaunchCommand({ appRoot: paths.appRoot, home, servicePid: process.pid, mode }));
}

/** Runs the service; resolves -1 while it runs, or the exit code of a start that did not happen. */
export async function runService(opts: CliOptions, paths: BootPaths, out: (line: string) => void): Promise<number> {
  await fsp.mkdir(opts.home, { recursive: true });
  const existing = await readServiceLock(opts.home);
  if (existing !== null && (await serviceAlive(existing))) {
    out(`Drey Service is already running (pid ${existing.pid})`);
    return 0;
  }
  if (!(await claimBoot(opts.home))) {
    out('another Drey Service is starting in this home');
    return 0;
  }
  try {
    const config = new FileConfigStore(path.join(opts.home, 'config.json'));
    const vault = opts.vault ?? (await config.get<string>(SERVICE_VAULT_KEY)) ?? null;
    if (vault === null) {
      console.error('usage: service-main.js --vault <tickets vault> — no vault given and none remembered from an earlier start');
      return 2;
    }
    await config.set(SERVICE_VAULT_KEY, vault);
    await startHost(opts, paths, { vault, config, out });
    return -1;
  } finally {
    await fsp.rm(path.join(opts.home, 'service.starting'), { force: true });
  }
}

async function startHost(opts: CliOptions, paths: BootPaths, run: { vault: string; config: FileConfigStore; out: (line: string) => void }): Promise<void> {
  const clientDir = await clientDirOf(path.join(paths.appRoot, 'dist', 'mission-control', 'browser'), path.join(paths.appRoot, 'plugins', 'tickets', 'remote'));
  const spawn = windowSpawn(paths, opts.home);
  const host = await ServiceHost.start({
    home: opts.home,
    vaultPath: run.vault,
    clientDir,
    build: paths.build,
    idleMs: opts.idleMs ?? serviceIdleMsOf(await run.config.get<unknown>(SERVICE_IDLE_KEY)),
    idleFromSettings: opts.idleMs === null,
    exit: (code) => process.exit(code),
    stdout: run.out,
    applyAutostart: (on) =>
      process.platform === 'win32' ? setAutostart(on, { entry: paths.entry, home: opts.home, vaultPath: null }) : Promise.resolve(),
    respawn: () => {
      spawnService(serviceLaunchCommand({ entry: paths.entry, home: opts.home, vaultPath: run.vault }), opts.home);
    },
    ...(spawn === undefined ? {} : { spawnWindow: spawn }),
  });
  const quit = (): void => void host.shutdown({ handover: false });
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
}
