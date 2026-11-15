/**
 * Settings → Tickets, the page the boards show (E13-12, board 7g): the
 * pure half. What the rows say about the team, the standard flow, the
 * budget, the runners and the videos — read from what the engine already
 * answers (`personas`, the board snapshot, `settingsRead`), nothing stored
 * here.
 */
import type { ChainEntry } from '../../../../packages/tickets-engine/src/contracts/chain';
import type { PersonaView } from '../../shared/remote-protocol';

/**
 * The default flow as the Flow row says it (E10-5b): pipeline.md's `flow:`, the personas in order with
 * the interactive entry marked — `Paul (shape) → Paul → Ben → Ralf → Tessa → You`.
 */
export function defaultFlowLine(flow: readonly ChainEntry[] | undefined, personas: readonly PersonaView[]): string {
  if (flow === undefined || flow.length === 0) {
    return 'No default flow';
  }
  return flow
    .map((entry) => {
      const title = personas.find((p) => p.id === entry.persona)?.title ?? entry.persona;
      return entry.mode === 'shape' ? `${title} (shape)` : title;
    })
    .join(' → ');
}

export function usd(amount: number): string {
  return `$${Number.isInteger(amount) ? String(amount) : amount.toFixed(2)}`;
}

/** The Daily budget row: the personas' budgets added up and what they spent today. */
export function budgetLineOf(personas: readonly PersonaView[]): string {
  const budgeted = personas.filter((p) => p.kind !== 'human' && p.budget !== null);
  if (budgeted.length === 0) {
    return 'No persona has a daily budget';
  }
  const total = budgeted.reduce((sum, p) => sum + (p.budget ?? 0), 0);
  const spent = budgeted.reduce((sum, p) => sum + (p.dailyCost ?? 0), 0);
  return `${usd(total)} across ${budgeted.length} ${budgeted.length === 1 ? 'persona' : 'personas'} · ${usd(spent)} spent today`;
}

export interface DeskDevice {
  readonly id: string;
  readonly name: string;
}

export interface DeskVideos {
  readonly inGit: boolean;
  readonly maxMb: number;
  readonly existing: number;
  readonly notice: string | null;
}

/** Reads the engine's `settingsRead` answer tolerantly; null = not a settings answer. */
export function parseDeskVideos(json: unknown): DeskVideos | null {
  if (typeof json !== 'object' || json === null) {
    return null;
  }
  const videos = ((json as Record<string, unknown>)['engine'] as Record<string, unknown> | undefined)?.['videos'] as
    | Record<string, unknown>
    | undefined;
  if ((json as Record<string, unknown>)['ok'] !== true || videos === undefined || videos === null) {
    return null;
  }
  return {
    inGit: videos['inGit'] === true,
    maxMb: typeof videos['maxMb'] === 'number' ? videos['maxMb'] : 0,
    existing: typeof videos['existing'] === 'number' ? videos['existing'] : 0,
    notice: typeof videos['notice'] === 'string' ? videos['notice'] : null,
  };
}

/** A whole number of megabytes from a field; null = not a number. */
export function maxMbOf(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null;
}

export type AutopilotState = 'on' | 'paused' | 'off';

/**
 * The Autopilot row's state as far as the engine tells it today: the chain
 * master is `run` (On) or `halted` (Off). A timed Paused arrives with the
 * engine route of req-95a.
 */
export function autopilotStateOf(master: string | null | undefined): AutopilotState {
  return master === 'run' ? 'on' : 'off';
}
