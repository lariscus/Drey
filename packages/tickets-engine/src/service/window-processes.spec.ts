import { describe, expect, it } from 'vitest';
import { isBareElectron, windowLaunchCommand, type WindowChild, type WindowMode } from './launch';
import { HANDED_OVER_EXIT, WindowProcesses } from './window-processes';
import { ServiceStay } from './service-stay';

/** The tray icon's window process (req-165): started while shown, started again when it dies, ended with the service. */
describe('WindowProcesses', () => {
  const harness = () => {
    let now = 0;
    const spawned: Array<{ mode: WindowMode; exit: (code: number | null) => void; killed: boolean }> = [];
    const logs: string[] = [];
    const windows = new WindowProcesses({
      now: () => now,
      log: (m) => logs.push(m),
      spawn: (mode): WindowChild => {
        const entry = { mode, exit: (_code: number | null) => undefined as void, killed: false };
        spawned.push(entry);
        return {
          pid: spawned.length,
          onExit: (listener) => {
            entry.exit = listener;
          },
          kill: () => {
            entry.killed = true;
          },
        };
      },
    });
    return { windows, spawned, logs, advance: (ms: number) => (now += ms) };
  };

  it('starts one tray process while the icon is shown, none while hidden', () => {
    const h = harness();
    h.windows.sync(false);
    expect(h.spawned).toHaveLength(0);
    h.windows.sync(true);
    h.windows.sync(true);
    expect(h.spawned.map((s) => s.mode)).toEqual(['tray']);
    expect(h.windows.trayRunning).toBe(true);
  });

  it('a crashed tray process starts again after a growing wait, and gives up after five', () => {
    const h = harness();
    for (let i = 0; i < 5; i++) {
      h.windows.sync(true);
      h.spawned.at(-1)!.exit(1);
      h.windows.sync(true);
      h.advance(60_000);
    }
    h.windows.sync(true);
    expect(h.spawned).toHaveLength(5);
    expect(h.logs.at(-1)).toContain('not started again');
    h.windows.sync(false);
    h.windows.sync(true);
    expect(h.spawned).toHaveLength(6);
  });

  it('a hand-over exit (another window process holds the lock) and a clean leave are no failures', () => {
    const h = harness();
    h.windows.sync(true);
    h.spawned[0]!.exit(HANDED_OVER_EXIT);
    h.windows.sync(true);
    expect(h.spawned).toHaveLength(1);
    h.advance(10_000);
    h.windows.sync(true);
    h.spawned[1]!.exit(0);
    expect(h.logs).toEqual([]);
  });

  it('opens the window in a process started for it; the service ending kills them all', () => {
    const h = harness();
    h.windows.sync(true);
    expect(h.windows.open()).toEqual({ ok: true });
    h.windows.stopAll();
    expect(h.spawned.every((s) => s.killed)).toBe(true);
    expect(h.windows.open().ok).toBe(false);
    h.windows.sync(true);
    expect(h.spawned).toHaveLength(2);
  });
});

describe('windowLaunchCommand', () => {
  it("a packaged Drey.exe runs its own app: the flag, the home, the service's pid, the mode", () => {
    expect(windowLaunchCommand({ appRoot: 'D:/app', home: 'H', servicePid: 42, mode: 'tray', execPath: 'C:/Drey/Drey.exe' })).toEqual({
      command: 'C:/Drey/Drey.exe',
      args: ['--drey-service-window', '--home', 'H', '--service-pid', '42', '--tray'],
      unsetEnv: ['ELECTRON_RUN_AS_NODE'],
    });
  });

  it('a bare dev electron gets the app folder first', () => {
    expect(isBareElectron('E:/x/node_modules/electron/dist/electron.exe')).toBe(true);
    expect(windowLaunchCommand({ appRoot: 'D:/app', home: 'H', servicePid: 1, mode: 'open', execPath: '/x/electron' }).args.slice(0, 2)).toEqual([
      'D:/app',
      '--drey-service-window',
    ]);
  });
});

describe('ServiceStay', () => {
  const idle = { dreyClients: 0, runnerAwake: false, gatewayServesDevices: false };

  it('a new idle span applies live, counting the time already idle', () => {
    let now = 0;
    const stay = new ServiceStay({ idleMs: 60_000, now: () => now });
    expect(stay.leaveReason('background', idle)).toBeNull();
    now = 30_000;
    stay.setIdleMs(20_000);
    expect(stay.leaveReason('background', idle)).toContain('nothing has held');
  });

  it('with Drey: leaves once Drey has gone for the grace', () => {
    let now = 0;
    const stay = new ServiceStay({ idleMs: 60_000, now: () => now, withDreyGraceMs: 100 });
    expect(stay.leaveReason('with-drey', { ...idle, dreyClients: 1 })).toBeNull();
    now = 50;
    expect(stay.leaveReason('with-drey', idle)).toBeNull();
    now = 200;
    expect(stay.leaveReason('with-drey', idle)).toContain('Drey has gone');
  });
});
