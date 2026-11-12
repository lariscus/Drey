/**
 * The store's lifecycle stages (req-265, the persona board concept §3, ADR-0090 later change):
 * a dricket store's `[stages]` say where a ticket is in its LIFE, never who works it. The pipeline's
 * columns (`_meta/pipeline.md`) stay Drey's; a ticket that is being worked stands in the column of
 * its holder, derived from the chain's cursor `x-at` (req-257, `core/chain-placement.ts`). The
 * interim pin `x-phase` of req-265 is read on a ticket the migration has not converted, never written.
 *
 *   inbox | prioritized | active | running | done      (dricket's reserved `cancelled` beside them)
 *
 * `running` is the claim's own stage: `dk claim` moves `active -> running`, and the end of a run is one
 * `release --stage active` — never the same-stage release dk refuses an agent (R-31).
 */

export const ACTIVE_STAGE = 'active';
export const RUNNING_STAGE = 'running';

/** The five stages in board order. */
export const LIFECYCLE_STAGE_IDS: readonly string[] = ['inbox', 'prioritized', ACTIVE_STAGE, RUNNING_STAGE, 'done'];

/** The only claim stage of a lifecycle store. */
export const LIFECYCLE_CLAIM_STAGES: readonly string[] = [RUNNING_STAGE];

/** The stages that are columns of their own at the board's edges: a ticket there carries no pin. */
export const EDGE_STAGES: readonly string[] = ['inbox', 'prioritized', 'done'];

/** dk's park stages: a store may list them beside the lifecycle; the migration keeps them. */
export const PARK_STAGES: readonly string[] = ['blocked', 'needs-input'];

/** req-265's interim column pin of an `active` / `running` ticket — read until converted, removed by every write (req-257). */
export const PHASE_PIN_KEY = 'x-phase';

/** Where a pipeline column lives on a lifecycle store: its stage, and the pin (null = no pin). */
export interface StagePlacement {
  readonly stage: string;
  readonly pin: string | null;
}

/**
 * The column `phase` as stage + pin: an edge column is its own stage, every other column is `active`;
 * the pin is always removed (req-257: the column of an `active` ticket follows its holder).
 */
export function placementOfPhase(phase: string): StagePlacement {
  return EDGE_STAGES.includes(phase) || phase === 'cancelled' ? { stage: phase, pin: null } : { stage: ACTIVE_STAGE, pin: null };
}

/** True when a store's stage vocabulary is the lifecycle one: `active` and `running` exist and `running` is the claim stage. */
export function isLifecycleStageSet(values: readonly string[], claim: readonly string[]): boolean {
  return values.includes(ACTIVE_STAGE) && values.includes(RUNNING_STAGE) && claim.length === 1 && claim[0] === RUNNING_STAGE;
}

/**
 * Where a run that moves nothing hands its ticket back on a lifecycle store: where it sat before the
 * claim, unless that was the claim stage itself (a takeover of an expired lease), then `active`.
 */
export function stayPutStagesOf(preStage: string | null): readonly string[] {
  return preStage === null || preStage === RUNNING_STAGE || preStage === ACTIVE_STAGE ? [ACTIVE_STAGE] : [preStage, ACTIVE_STAGE];
}
