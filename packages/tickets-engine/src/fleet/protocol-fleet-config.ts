/**
 * The fleet settings the plugin hands the runner (T-0048, T-0049, req-63):
 * the handover thresholds, the instruction output caps and the per-provider
 * pools, each with its defaults and the normalizer that degrades a value of
 * unknown shape (wire body, plugin config) to a valid one. Part of the wire
 * protocol; `protocol.ts` re-exports it.
 */
import { FLEET_SETTING_DEFAULTS } from '../contracts/fleet-defaults';
import type { WorkerProviderId } from './protocol';

/**
 * How the run's context reached the worker (T-0049): `'fresh'` — a new
 * session with the composed instruction (the T-0048 behaviour);
 * `'resume'` — the previous run's provider session, continued;
 * `'resume-compact'` — the same, natively compacted before the first
 * prompt. `'fresh'` is the default everywhere an older sender omits it.
 */
export type HandoverMode = 'fresh' | 'resume' | 'resume-compact';

/** The handover thresholds (T-0049); configurable `fleet.*`. */
export interface FleetHandoverConfig {
  /**
   * A resumed session whose last known context is at or above this many
   * tokens is compacted first (provider capability permitting). The bar
   * guards fidelity loss, not tokens — the compact itself is cheap
   * (spike 2: ~0.75k tokens halving an 8k context). Provisional.
   */
  readonly compactAboveTokens: number;
  /**
   * Per-provider and per-model thresholds over the base, keyed
   * `<workerProvider>` or `<workerProvider>/<modelPin>` — the
   * most-specific key wins at resolution. No UI: a hand-edited power
   * knob (`fleet.compactAboveTokens.<key>` flat keys plugin-side).
   */
  readonly compactAboveTokensOverrides?: Readonly<Record<string, number>>;
  /**
   * A pause shorter than this many minutes counts as warm (spike 3: a
   * resumed turn re-pays the transcript as cache reads, still ~99 %
   * cached after 6 min; measured auto-retry gaps ran 1–13 min).
   */
  readonly resumePauseTtlMin: number;
  /**
   * The context a worker may grow to before the provider compacts it
   * mid-run (req-80) — OpenCode's own auto-compaction, pointed at this
   * window instead of the model's (1M for GLM: never). Every model call
   * re-reads the whole context, so a run's cost grows with its square.
   * 0 = the model's own window.
   */
  readonly contextCapTokens: number;
  /** Per-provider and per-model caps over the base, keyed like `compactAboveTokensOverrides`. */
  readonly contextCapTokensOverrides?: Readonly<Record<string, number>>;
}

/** The handover thresholds' defaults — an absent or invalid config degrades to these. */
export const DEFAULT_FLEET_HANDOVER: FleetHandoverConfig = {
  compactAboveTokens: FLEET_SETTING_DEFAULTS['fleet.compactAboveTokens'],
  resumePauseTtlMin: FLEET_SETTING_DEFAULTS['fleet.resumePauseTtlMin'],
  contextCapTokens: FLEET_SETTING_DEFAULTS['fleet.contextCapTokens'],
};

/** Resolves handover thresholds of unknown shape to valid ones, per key
 *  like the caps: every non-negative finite number wins, anything else
 *  falls back to that key's default (an invalid override entry drops). */
export function normalizeFleetHandover(value: unknown): FleetHandoverConfig {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const num = (key: 'compactAboveTokens' | 'resumePauseTtlMin' | 'contextCapTokens'): number => {
    const given = raw[key];
    return typeof given === 'number' && Number.isFinite(given) && given >= 0 ? given : DEFAULT_FLEET_HANDOVER[key];
  };
  const overridesOf = (key: string): Record<string, number> => {
    const overridesRaw = raw[key];
    const overrides: Record<string, number> = {};
    if (typeof overridesRaw === 'object' && overridesRaw !== null) {
      for (const [name, given] of Object.entries(overridesRaw as Record<string, unknown>)) {
        if (typeof given === 'number' && Number.isFinite(given) && given >= 0) {
          overrides[name] = given;
        }
      }
    }
    return overrides;
  };
  const overrides = overridesOf('compactAboveTokensOverrides');
  const capOverrides = overridesOf('contextCapTokensOverrides');
  return {
    compactAboveTokens: num('compactAboveTokens'),
    ...(Object.keys(overrides).length > 0 ? { compactAboveTokensOverrides: overrides } : {}),
    resumePauseTtlMin: num('resumePauseTtlMin'),
    contextCapTokens: num('contextCapTokens'),
    ...(Object.keys(capOverrides).length > 0 ? { contextCapTokensOverrides: capOverrides } : {}),
  };
}

/** The output caps an instruction applies (T-0048); configurable `fleet.cap.*`. */
export interface FleetCaps {
  /** The gate failure's tail, injected into a retry's instruction. */
  readonly gateFailureLines: number;
  readonly gateFailureBytes: number;
  /** The worktree diff stat's head, injected into every instruction. */
  readonly diffStatLines: number;
  readonly diffStatBytes: number;
}

/** The caps' defaults — an absent or invalid config degrades to these. */
export const DEFAULT_FLEET_CAPS: FleetCaps = {
  gateFailureLines: FLEET_SETTING_DEFAULTS['fleet.cap.gateFailureLines'],
  gateFailureBytes: FLEET_SETTING_DEFAULTS['fleet.cap.gateFailureBytes'],
  diffStatLines: FLEET_SETTING_DEFAULTS['fleet.cap.diffStatLines'],
  diffStatBytes: FLEET_SETTING_DEFAULTS['fleet.cap.diffStatBytes'],
};

/** Resolves a caps value of unknown shape (wire body, plugin config) to
 *  a valid one: every non-negative finite number wins per key, anything
 *  else falls back to the default of that key. */
export function normalizeFleetCaps(value: unknown): FleetCaps {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const num = (key: keyof FleetCaps): number => {
    const given = raw[key];
    return typeof given === 'number' && Number.isFinite(given) && given >= 0 ? given : DEFAULT_FLEET_CAPS[key];
  };
  return {
    gateFailureLines: num('gateFailureLines'),
    gateFailureBytes: num('gateFailureBytes'),
    diffStatLines: num('diffStatLines'),
    diffStatBytes: num('diffStatBytes'),
  };
}

/**
 * One worker provider's pool (req-63): how many runs of that provider
 * the machine carries at once, across every column. Configurable
 * `fleet.pool.<provider>.size` / `.probe`.
 */
export interface FleetPool {
  /** Parallel runs (≥ 1). */
  readonly size: number;
  /**
   * An OpenAI-compatible llama.cpp server's base URL: its `/props`
   * `total_slots` caps `size` (the only local server that reports its
   * parallelism). Null = no probe.
   */
  readonly probeUrl: string | null;
}

export type FleetPools = Readonly<Record<WorkerProviderId, FleetPool>>;

export const DEFAULT_FLEET_POOL: FleetPool = { size: FLEET_SETTING_DEFAULTS['fleet.pool.size'], probeUrl: null };

/** Resolves pools of unknown shape (wire body, plugin config) per
 *  provider: a whole size ≥ 1 and an http(s) probe URL win, anything
 *  else falls back to the default. */
export function normalizeFleetPools(value: unknown): FleetPools {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const one = (provider: WorkerProviderId): FleetPool => {
    const entry = (typeof raw[provider] === 'object' && raw[provider] !== null ? raw[provider] : {}) as Record<
      string,
      unknown
    >;
    const size = entry['size'];
    const probe = entry['probeUrl'];
    return {
      size: typeof size === 'number' && Number.isInteger(size) && size >= 1 ? size : DEFAULT_FLEET_POOL.size,
      probeUrl: typeof probe === 'string' && /^https?:\/\/\S+$/.test(probe.trim()) ? probe.trim() : null,
    };
  };
  return { opencode: one('opencode'), 'claude-code': one('claude-code'), kimi: one('kimi') };
}
