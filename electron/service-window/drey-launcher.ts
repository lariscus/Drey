/**
 * *Open Drey* from the tray and the window (req-165): Drey's own binary,
 * detached. A running Drey takes it over through its single-instance lock
 * and comes to the front; otherwise Drey starts.
 */
import { spawn } from 'node:child_process';

/** The command: a dev checkout's bare electron needs the app folder, a packaged Drey.exe runs its own. */
export function dreyCommand(execPath: string, appPath: string): { readonly command: string; readonly args: readonly string[] } {
  const bare = /^electron(\.exe)?$/i.test(execPath.split(/[\\/]/).pop() ?? '');
  return { command: execPath, args: bare ? [appPath] : [] };
}

export class DreyLauncher {
  constructor(
    private readonly execPath: string,
    private readonly appPath: string,
  ) {}

  open(): void {
    const { command, args } = dreyCommand(this.execPath, this.appPath);
    const env = { ...process.env };
    delete env['ELECTRON_RUN_AS_NODE'];
    // A running Drey must take it over, not a second instance beside it.
    delete env['DREY_MULTI_INSTANCE'];
    const child = spawn(command, [...args], { env, detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  }
}
