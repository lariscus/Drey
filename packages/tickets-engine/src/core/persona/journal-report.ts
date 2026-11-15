import type { FindingCause, JournalEntry } from './persona-journal';

/**
 * The journal grouped by model (R14, req-169) — what answers "would another
 * model do better": per model (harness/model as the run named it) the
 * noteworthy runs, how many of them were red gates, retries, owner steers
 * and cost outliers, their mean cost, where the closing rounds put the
 * cause, and the latest frictions. Pure over the journal's entries; a
 * migrated friction line (no model) groups under `unknown`.
 */
export interface ModelReview {
  readonly model: string;
  readonly runs: number;
  readonly redGates: number;
  readonly retries: number;
  readonly steers: number;
  readonly costOutliers: number;
  /** Mean over the entries with a cost; null when none had one. */
  readonly meanCostUsd: number | null;
  readonly causes: Readonly<Record<FindingCause, number>>;
  /** The personas whose runs these were. */
  readonly personas: readonly string[];
  /** The newest frictions, at most {@link REVIEW_FRICTION_CAP}, newest first. */
  readonly frictions: readonly string[];
}

export const REVIEW_FRICTION_CAP = 5;
export const UNKNOWN_MODEL = 'unknown';

interface Bucket {
  model: string;
  runs: number;
  redGates: number;
  retries: number;
  steers: number;
  costOutliers: number;
  costSum: number;
  costed: number;
  causes: Record<FindingCause, number>;
  personas: Set<string>;
  frictions: { at: string; text: string }[];
}

function modelOf(entry: JournalEntry): string {
  if (entry.model === null) {
    return UNKNOWN_MODEL;
  }
  return entry.harness === null ? entry.model : `${entry.harness}/${entry.model}`;
}

function bucketOf(model: string): Bucket {
  return { model, runs: 0, redGates: 0, retries: 0, steers: 0, costOutliers: 0, costSum: 0, costed: 0, causes: { model: 0, prompt: 0, task: 0, environment: 0 }, personas: new Set(), frictions: [] };
}

function add(bucket: Bucket, entry: JournalEntry): void {
  bucket.runs += 1;
  bucket.redGates += entry.gate === 'red' ? 1 : 0;
  bucket.retries += entry.signals.includes('retry') ? 1 : 0;
  bucket.steers += entry.signals.includes('steer') ? 1 : 0;
  bucket.costOutliers += entry.signals.includes('cost') ? 1 : 0;
  if (entry.costUsd !== null) {
    bucket.costSum += entry.costUsd;
    bucket.costed += 1;
  }
  if (entry.finding !== null) {
    bucket.causes[entry.finding.cause] += 1;
  }
  bucket.personas.add(entry.persona);
  if (entry.friction !== null) {
    bucket.frictions.push({ at: entry.at, text: entry.friction });
  }
}

/** The entries (any personas, any order) grouped by model, the busiest model first. */
export function journalByModel(entries: readonly JournalEntry[]): readonly ModelReview[] {
  const buckets = new Map<string, Bucket>();
  for (const entry of entries) {
    const model = modelOf(entry);
    const bucket = buckets.get(model) ?? bucketOf(model);
    add(bucket, entry);
    buckets.set(model, bucket);
  }
  return [...buckets.values()]
    .map((b) => ({
      model: b.model,
      runs: b.runs,
      redGates: b.redGates,
      retries: b.retries,
      steers: b.steers,
      costOutliers: b.costOutliers,
      meanCostUsd: b.costed === 0 ? null : Math.round((b.costSum / b.costed) * 10_000) / 10_000,
      causes: b.causes,
      personas: [...b.personas].sort(),
      frictions: b.frictions
        .sort((x, y) => y.at.localeCompare(x.at))
        .slice(0, REVIEW_FRICTION_CAP)
        .map((f) => f.text),
    }))
    .sort((a, b) => b.runs - a.runs || a.model.localeCompare(b.model));
}
