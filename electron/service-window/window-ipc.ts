/**
 * The window's IPC (req-165/166): each channel of the contract answered by
 * the service window process's main side. Arguments are checked here — the
 * renderer names runs, components and actions, never a URL or a path.
 */
import { clipboard, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import {
  SERVICE_WINDOW_CHANNELS as CH,
  type ActionReply,
  type ComponentAction,
  type ComponentId,
  type RunAction,
} from '../../shared/service-window/contract';
import { i18n } from '../../shared/i18n';
import type { Confirmations } from './confirmations';
import type { DreyLauncher } from './drey-launcher';
import type { ServiceCalls } from './service-calls';
import { isLive, logLineOf, sessionsOf, streamEventsOf } from './snapshot-map';
import type { SnapshotSource } from './snapshot-source';
import type { ServiceWindowController } from './window-controller';

const COMPONENTS: ReadonlySet<string> = new Set(['engine', 'runner', 'mcp', 'gateway']);
const COMPONENT_ACTIONS: ReadonlySet<string> = new Set(['restart', 'stop', 'start']);
const RUN_ACTIONS: ReadonlySet<string> = new Set(['send', 'interrupt', 'resume', 'stop']);
const BAD = (): ActionReply => ({ ok: false, error: i18n.t('service_tray.error.bad_request') });

const runIdOf = (value: unknown): string | null => (typeof value === 'string' && /^[\w.:-]{1,120}$/.test(value) ? value : null);

export interface WindowIpcDeps {
  readonly calls: ServiceCalls;
  readonly snapshots: SnapshotSource;
  readonly confirmations: Confirmations;
  readonly drey: DreyLauncher;
  readonly window: ServiceWindowController;
}

export class WindowIpc {
  constructor(private readonly deps: WindowIpcDeps) {}

  /** Only the service window's own page may call. */
  private fromWindow(event: IpcMainInvokeEvent): boolean {
    return this.deps.window.current?.webContents.id === event.sender.id;
  }

  private handle(channel: string, fn: (...args: unknown[]) => Promise<unknown>): void {
    ipcMain.handle(channel, (event, ...args: unknown[]) => (this.fromWindow(event) ? fn(...args) : Promise.reject(new Error(i18n.t('service_tray.error.not_window')))));
  }

  register(): void {
    const { calls, snapshots } = this.deps;
    this.handle(CH.snapshot, () => snapshots.snapshot());
    this.handle(CH.runs, async () => sessionsOf(await calls.runs(), new Date()));
    this.handle(CH.stream, async (runId) => (runIdOf(runId) === null ? [] : streamEventsOf(await calls.stream(runId as string))));
    this.handle(CH.instruction, async (runId) => (runIdOf(runId) === null ? null : calls.instruction(runId as string)));
    this.handle(CH.logTail, async () => (await calls.logTail()).split('\n').map(logLineOf).filter((line) => line !== null));
    this.handle(CH.component, (id, action) => this.component(id, action));
    this.handle(CH.run, (runId, action, text) => this.run(runId, action, text));
    this.handle(CH.copyAttach, (runId) => this.copyAttach(runId));
    this.handle(CH.openWorktree, (runId) => this.openWorktree(runId));
    this.handle(CH.openDrey, async () => this.deps.drey.open());
    this.handle(CH.quitService, () => this.quitService());
    ipcMain.on(CH.windowControl, (event, action: unknown) => {
      const win = this.deps.window.current;
      if (win === null || win.webContents.id !== event.sender.id) {
        return;
      }
      if (action === 'minimize') {
        win.minimize();
      } else if (action === 'maximize') {
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      } else if (action === 'close') {
        win.close();
      }
    });
  }

  private component(id: unknown, action: unknown): Promise<ActionReply> {
    if (!COMPONENTS.has(String(id)) || !COMPONENT_ACTIONS.has(String(action))) {
      return Promise.resolve(BAD());
    }
    return this.deps.calls.component(id as Exclude<ComponentId, 'model'>, action as ComponentAction);
  }

  private run(runId: unknown, action: unknown, text: unknown): Promise<ActionReply> {
    const id = runIdOf(runId);
    if (id === null || !RUN_ACTIONS.has(String(action))) {
      return Promise.resolve(BAD());
    }
    if (action === 'send' && (typeof text !== 'string' || text.trim() === '' || text.length > 100_000)) {
      return Promise.resolve(BAD());
    }
    return this.deps.calls.runAction(id, action as RunAction, action === 'send' ? (text as string) : undefined);
  }

  private async copyAttach(runId: unknown): Promise<ActionReply> {
    const id = runIdOf(runId);
    const command = id === null ? null : await this.deps.calls.attachCommand(id);
    if (command === null) {
      return { ok: false, error: i18n.t('service_tray.error.no_session') };
    }
    await clipboard.writeText(command);
    return { ok: true };
  }

  private async openWorktree(runId: unknown): Promise<ActionReply> {
    const id = runIdOf(runId);
    const run = id === null ? undefined : (await this.deps.calls.runs()).find((r) => r['id'] === id);
    const dir = typeof run?.['worktreePath'] === 'string' ? run['worktreePath'] : '';
    if (dir === '') {
      return { ok: false, error: i18n.t('service_tray.error.no_worktree') };
    }
    const error = await shell.openPath(dir);
    return error === '' ? { ok: true } : { ok: false, error };
  }

  private async quitService(): Promise<ActionReply> {
    const live = (await this.deps.calls.runs()).filter(isLive).length;
    if (!(await this.deps.confirmations.quitService(live))) {
      return { ok: false, error: 'cancelled' };
    }
    return this.deps.calls.shutdown();
  }
}
