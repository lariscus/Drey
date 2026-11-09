/**
 * The service window process (req-165/166, ADR-0092 later change
 * 2026-11-09): Drey Service's tray icon and its window, a client of the
 * service's and the runner's HTTP APIs only. Started by the service
 * (`--tray` while `service.trayIcon` is shown, `--open` for Settings' *Open
 * Drey Service…*); `electron/boot.ts` branches here on the flag.
 *
 * One process per service home: Electron's single-instance lock under its
 * own userData (`<home>/service-window`) — a second start hands its
 * arguments to the first and exits with {@link HANDED_OVER_EXIT}. It leaves
 * when its service has gone, and when neither the icon nor the window is up.
 */
import { app } from 'electron';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SERVICE_WINDOW_CHANNELS } from '../../shared/service-window/contract';
import { Confirmations } from './confirmations';
import { DreyLauncher } from './drey-launcher';
import { EventRelay } from './event-relay';
import { JsonHttp } from './json-http';
import { LocalModelProbe } from './local-model-probe';
import { ServiceCalls } from './service-calls';
import { ServiceEndpoints } from './service-endpoints';
import { parseWindowArgs, type WindowArgs } from './service-window-args';
import { SnapshotSource } from './snapshot-source';
import { TrayController } from './tray-controller';
import { ServiceWindowController, windowPaths } from './window-controller';
import { WindowIpc } from './window-ipc';

/** Keep in step with `HANDED_OVER_EXIT` in `packages/tickets-engine/src/service/window-processes.ts`. */
export const HANDED_OVER_EXIT = 3;
const TICK_MS = 3_000;
/** Ticks without its service before the process leaves (a restart takes a moment). */
const GONE_TICKS = 4;

const args = parseWindowArgs(process.argv);
const home = args.home ?? path.join(os.homedir(), '.drey-engine');
// Drey's own userData (its app-config.json names the local model), read before this process takes its own.
const dreyUserData = app.getPath('userData');
app.setPath('userData', path.join(home, 'service-window'));
// A tray and a plain text window need no GPU: no GPU process, less memory (the owner watches it).
app.disableHardwareAcceleration();

class ServiceWindowProcess {
  private trayMode: boolean;
  private goneTicks = 0;
  private readonly endpoints = new ServiceEndpoints(home, (file) => fsp.readFile(file, 'utf8'));
  private readonly calls = new ServiceCalls(this.endpoints, new JsonHttp());
  private readonly window = new ServiceWindowController(windowPaths(app.getAppPath(), __dirname));
  private readonly confirmations = new Confirmations(() => this.window.current);
  private readonly drey = new DreyLauncher(process.execPath, app.getAppPath());
  private readonly snapshots = new SnapshotSource(
    this.calls,
    new LocalModelProbe(async () => (JSON.parse(await fsp.readFile(path.join(dreyUserData, 'app-config.json'), 'utf8')) as { llm?: unknown }).llm),
  );
  private readonly tray = new TrayController({ calls: this.calls, confirmations: this.confirmations, drey: this.drey, openWindow: () => this.openWindow() });
  private readonly relay = new EventRelay(this.endpoints, (event) => this.window.send(SERVICE_WINDOW_CHANNELS.event, event));

  constructor(private readonly servicePid: number | null, first: WindowArgs) {
    this.trayMode = first.tray;
  }

  start(first: WindowArgs): void {
    new WindowIpc({ calls: this.calls, snapshots: this.snapshots, confirmations: this.confirmations, drey: this.drey, window: this.window }).register();
    this.window.onClosed(() => {
      this.relay.stop();
      this.leaveIfIdle();
    });
    this.tray.setVisible(this.trayMode);
    this.take(first);
    setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  /** The arguments of this start or of a later one handed over. */
  take(next: WindowArgs): void {
    if (next.tray) {
      this.trayMode = true;
    }
    if (next.open) {
      this.openWindow();
    }
  }

  private openWindow(): void {
    this.relay.start();
    this.window.show('components');
  }

  private async tick(): Promise<void> {
    const set = await this.endpoints.read();
    const mine = set !== null && (this.servicePid === null || set.pid === this.servicePid);
    this.goneTicks = mine ? 0 : this.goneTicks + 1;
    if (this.goneTicks >= GONE_TICKS) {
      app.quit();
      return;
    }
    const wanted = await this.snapshots.trayWanted();
    this.tray.setVisible(this.trayMode && wanted !== false);
    await this.tray.refresh();
    this.leaveIfIdle();
  }

  private leaveIfIdle(): void {
    if (!this.tray.visible && this.window.current === null) {
      app.quit();
    }
  }
}

if (!app.requestSingleInstanceLock()) {
  app.exit(HANDED_OVER_EXIT);
} else {
  app.setAppUserModelId('de.lariscus.drey.service');
  const process$ = new ServiceWindowProcess(args.servicePid, args);
  app.on('second-instance', (_event, argv) => process$.take(parseWindowArgs(argv)));
  // The window closing is not the end: the tray (and the service) go on.
  app.on('window-all-closed', () => undefined);
  void app.whenReady().then(() => process$.start(args));
}
