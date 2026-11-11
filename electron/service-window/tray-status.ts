/**
 * The service's state in one of four words (req-276): the colour of the dot
 * on Drey's icon in the tray and on the window's taskbar button, and the
 * tray's tooltip. Pure: the facts the tray already reads every tick in,
 * the verdict out.
 *
 * - **stopped** (grey): no service holds the home — no `service.lock`.
 * - **problem** (red): a component reports `failed`, or the lock names a
 *   service whose control port does not answer.
 * - **paused** (orange): the Autopilot is Paused.
 * - **running** (green): everything else — also a sleeping or starting
 *   runner and a gateway switched off; those are the service at rest.
 */
import type { AutopilotState, Translate } from './tray-menu';

export type TrayStatus = 'stopped' | 'problem' | 'running' | 'paused';

export type Rgb = readonly [number, number, number];

/** The service's components in the order a problem names them. */
const COMPONENTS = ['engine', 'runner', 'mcp', 'gateway'] as const;
export type ServiceComponent = (typeof COMPONENTS)[number];

export interface TrayStatusFacts {
  /** `service.lock` names a service. */
  readonly locked: boolean;
  /** `GET /status`; null when it did not answer. */
  readonly status: Readonly<Record<string, unknown>> | null;
  readonly autopilot: AutopilotState;
}

export type TrayProblem = { readonly kind: 'not_answering' } | { readonly kind: 'failed'; readonly component: ServiceComponent };

export interface TrayVerdict {
  readonly status: TrayStatus;
  readonly problem: TrayProblem | null;
}

/** Saturated enough to read as a 7 px dot on a light or a dark taskbar. */
export const STATUS_COLOURS: Readonly<Record<TrayStatus, Rgb>> = {
  stopped: [0x8b, 0x90, 0x99],
  problem: [0xe5, 0x48, 0x4d],
  running: [0x3f, 0xb9, 0x50],
  paused: [0xf5, 0x82, 0x1f],
};

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

function failedComponent(status: Readonly<Record<string, unknown>>): ServiceComponent | null {
  const components = record(status['components']);
  return COMPONENTS.find((id) => record(components[id])['state'] === 'failed') ?? null;
}

export function trayVerdictOf(facts: TrayStatusFacts): TrayVerdict {
  if (facts.status === null) {
    return facts.locked ? { status: 'problem', problem: { kind: 'not_answering' } } : { status: 'stopped', problem: null };
  }
  const failed = failedComponent(facts.status);
  if (failed !== null) {
    return { status: 'problem', problem: { kind: 'failed', component: failed } };
  }
  return { status: facts.autopilot === 'paused' ? 'paused' : 'running', problem: null };
}

function detailOf(verdict: TrayVerdict, t: Translate): string | null {
  const problem = verdict.problem;
  if (problem !== null) {
    return problem.kind === 'not_answering'
      ? t('service_tray.problem.not_answering')
      : t('service_tray.problem.failed', { component: t(`service_window.component.${problem.component}`) });
  }
  return verdict.status === 'paused' ? t('service_tray.paused.detail') : null;
}

/** The tooltip: the header, and what is wrong or paused on a second line. */
export function trayTooltip(verdict: TrayVerdict, t: Translate): string {
  const header = t(`service_tray.header.${verdict.status}`);
  const detail = detailOf(verdict, t);
  return detail === null ? header : `${header}\n${detail}`;
}
