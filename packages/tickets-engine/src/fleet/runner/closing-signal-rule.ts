import type { ClosingSignal } from '../../core/pipeline/closing-signals';
import { costOf } from '../../core/config/model-prices';
import { DEFAULT_CLOSING_SPEC } from '../protocol';
import type { LiveRun } from './live-run';

/**
 * The cost outlier (R14, req-169): a run is "far above the typical run" when
 * it cost more than {@link COST_OUTLIER_FACTOR} times the median of the
 * persona's last {@link COST_OUTLIER_WINDOW} settled runs with a known cost
 * — and only once there are at least {@link COST_OUTLIER_MIN_RUNS} of them,
 * so a new persona's second run is never an outlier by accident.
 */
export const COST_OUTLIER_FACTOR = 3;
export const COST_OUTLIER_MIN_RUNS = 5;
export const COST_OUTLIER_WINDOW = 20;

/** The persona's earlier runs' costs, newest first — the runner's own records. */
export interface PriorRunCosts {
  costsOf(persona: string, excludeRunId: string): readonly number[];
}

/** The median of the window, or null when the window is too thin to call anything typical. */
export function typicalCost(priors: readonly number[]): number | null {
  const window = priors.slice(0, COST_OUTLIER_WINDOW).filter((c) => Number.isFinite(c) && c >= 0);
  if (window.length < COST_OUTLIER_MIN_RUNS) {
    return null;
  }
  const sorted = [...window].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function isCostOutlier(cost: number | null, typical: number | null): boolean {
  return cost !== null && typical !== null && typical > 0 && cost > COST_OUTLIER_FACTOR * typical;
}

/** What the rule found on one run. */
export interface ClosingAssessment {
  readonly signals: readonly ClosingSignal[];
  /** The run's effective cost — the provider's, else the price table's estimate. */
  readonly costUsd: number | null;
  readonly typicalCostUsd: number | null;
}

/**
 * Which signals a settled-to-be run raised, of those the vault asks for
 * (`RunRequest.closing`, all five by default): a red gate, a retry, an owner
 * steer (`steerCount`), the cost outlier, the worker's own `FRICTION:` line.
 * No signal = a smooth run: no round, no journal entry, no lesson.
 */
export class ClosingSignalRule {
  constructor(private readonly history: PriorRunCosts) {}

  assess(run: LiveRun): ClosingAssessment {
    const info = run.info;
    const costUsd = info.costUsd ?? costOf(info.model ?? null, info.tokensIn, info.tokensOut);
    const persona = info.persona ?? null;
    const typicalCostUsd = persona === null ? null : typicalCost(this.history.costsOf(persona, info.id));
    const spec = run.request.closing ?? DEFAULT_CLOSING_SPEC;
    const raised: Record<ClosingSignal, boolean> = {
      'red-gate': info.gateResult === 'red',
      retry: spec.retry,
      steer: info.steerCount > 0,
      cost: isCostOutlier(costUsd, typicalCostUsd),
      friction: (run.friction ?? null) !== null,
    };
    return { signals: spec.signals.filter((signal) => raised[signal]), costUsd, typicalCostUsd };
  }
}
