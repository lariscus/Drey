import { normalizeTranche, type TrancheConfig } from '../fleet/protocol';
import type { EngineHost } from './host';

/** The plugin config keys of the tranche (req-179), beside the Autopilot's: `autopilot.tranche.*`, `autopilot.earlyStop.*`. */
export const TRANCHE_KEYS = ['runs', 'budgetShare', 'minutes'] as const;
export const EARLY_STOP_KEYS = ['redGates', 'gateWindow', 'sameTicketRed', 'changeFactor', 'costFactor', 'minRuns'] as const;

/**
 * A config value as the normalizer takes it: a number stays, a numeric text
 * (a settings field) becomes one, `off` / `0` / `false` switch the limit off,
 * anything else is absent (the default).
 */
export function trancheValueOf(value: unknown): number | null | undefined {
  if (typeof value === 'number') {
    return value === 0 ? null : value;
  }
  if (value === false || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const text = value.trim().toLowerCase();
  if (text === 'off' || text === 'false') {
    return null;
  }
  const n = Number(text);
  return Number.isFinite(n) ? (n === 0 ? null : n) : undefined;
}

/** The chain config's tranche from the plugin config; absent keys take the defaults (`DEFAULT_TRANCHE`). */
export async function trancheConfigOf(host: Pick<EngineHost, 'configGet'>): Promise<TrancheConfig> {
  const read = async (key: string): Promise<[string, number | null] | null> => {
    const value = trancheValueOf(await host.configGet<unknown>(key));
    return value === undefined ? null : [key.split('.').pop() ?? key, value];
  };
  const entries = async (prefix: string, keys: readonly string[]): Promise<Record<string, number | null>> =>
    Object.fromEntries((await Promise.all(keys.map((key) => read(`${prefix}.${key}`)))).filter((entry): entry is [string, number | null] => entry !== null));
  const tranche = await entries('autopilot.tranche', TRANCHE_KEYS);
  const earlyStop = await entries('autopilot.earlyStop', EARLY_STOP_KEYS);
  return normalizeTranche({ ...tranche, earlyStop });
}
