/**
 * The service window's preload (req-165/166): `window.serviceWindow`, the
 * contract's {@link ServiceWindowApi} over IPC — nothing else of Electron
 * reaches the page. Bundled into one file (`scripts/bundle-preload.mjs`):
 * the window is sandboxed.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { SERVICE_WINDOW_CHANNELS as CH, type ServiceWindowApi, type ServiceWindowEvent, type ServiceWindowTab } from '../../shared/service-window/contract';

const listen = <T>(channel: string, listener: (value: T) => void): (() => void) => {
  const wrapped = (_event: unknown, value: T): void => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
};

const api: ServiceWindowApi = {
  snapshot: () => ipcRenderer.invoke(CH.snapshot),
  runs: () => ipcRenderer.invoke(CH.runs),
  stream: (runId) => ipcRenderer.invoke(CH.stream, runId),
  instruction: (runId) => ipcRenderer.invoke(CH.instruction, runId),
  logTail: () => ipcRenderer.invoke(CH.logTail),
  component: (id, action) => ipcRenderer.invoke(CH.component, id, action),
  run: (runId, action, text) => ipcRenderer.invoke(CH.run, runId, action, text),
  copyAttachCommand: (runId) => ipcRenderer.invoke(CH.copyAttach, runId),
  openWorktree: (runId) => ipcRenderer.invoke(CH.openWorktree, runId),
  openDrey: () => ipcRenderer.invoke(CH.openDrey),
  quitService: () => ipcRenderer.invoke(CH.quitService),
  windowControl: (action) => ipcRenderer.send(CH.windowControl, action),
  onEvent: (listener) => listen<ServiceWindowEvent>(CH.event, listener),
  onShowTab: (listener) => listen<ServiceWindowTab>(CH.showTab, listener),
};

contextBridge.exposeInMainWorld('serviceWindow', api);
