/**
 * The tray menu of board 8a (req-165): `Drey Service · running`, Open Drey
 * Service…, Open Drey, `Autopilot: <state> ›` (On / Paused / Off), Stop all
 * running steps…, a divider, Start with Windows ✓, Quit service. Pure: the
 * template from the state, the strings through the catalog.
 */
import type { MenuItemConstructorOptions, NativeImage } from 'electron';

export type AutopilotState = 'on' | 'paused' | 'off';

export interface TrayState {
  readonly running: boolean;
  readonly autopilot: AutopilotState;
  readonly liveRuns: number;
  readonly autostart: boolean;
}

export interface TrayActions {
  openWindow(): void;
  openDrey(): void;
  setAutopilot(state: AutopilotState): void;
  stopAll(): void;
  setAutostart(on: boolean): void;
  quit(): void;
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;

const AUTOPILOT_STATES: readonly AutopilotState[] = ['on', 'paused', 'off'];

export function trayMenuTemplate(state: TrayState, actions: TrayActions, t: Translate, headerIcon?: NativeImage): MenuItemConstructorOptions[] {
  const autopilotLabel = t(`autopilot.state.${state.autopilot}`);
  return [
    {
      label: t(state.running ? 'service_tray.header.running' : 'service_tray.header.stopped'),
      enabled: false,
      ...(headerIcon === undefined ? {} : { icon: headerIcon }),
    },
    { label: t('service_tray.open_window'), click: () => actions.openWindow() },
    { label: t('service_tray.open_drey'), click: () => actions.openDrey() },
    {
      label: t('service_tray.autopilot', { state: autopilotLabel }),
      enabled: state.running,
      submenu: AUTOPILOT_STATES.map((s) => ({
        label: t(`autopilot.state.${s}`),
        type: 'radio' as const,
        checked: s === state.autopilot,
        click: () => actions.setAutopilot(s),
      })),
    },
    { label: t('service_tray.stop_all'), enabled: state.running && state.liveRuns > 0, click: () => actions.stopAll() },
    { type: 'separator' },
    {
      label: t('service_tray.start_with_windows'),
      type: 'checkbox',
      checked: state.autostart,
      enabled: state.running,
      click: () => actions.setAutostart(!state.autostart),
    },
    { label: t('service_tray.quit'), enabled: state.running, click: () => actions.quit() },
  ];
}
