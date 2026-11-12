import { ACTIVE_STAGE, LIFECYCLE_CLAIM_STAGES, LIFECYCLE_STAGE_IDS, PARK_STAGES, PHASE_PIN_KEY, RUNNING_STAGE } from '../core/lifecycle-stages';
import { isLifecycleStore, type StoreStageSet } from './store-stages';

/**
 * The stage migration of a store, planned from what it is now (req-265, concept §12 steps 1–2). Pure:
 * the plan is derived from the current `[stages]` and the tickets alone, so a migration interrupted
 * anywhere — between the two config commits, halfway through the moves — plans the rest on the next
 * run, and a migrated store plans nothing.
 *
 *  1. `add`: the old set plus `active` and `running`, `claim = ["running"]` (R-03 replays the history
 *     under each commit's own set, so the old stages must still exist while tickets leave them);
 *  2. the moves: every ticket in a stage that is not a lifecycle, park or cancelled stage goes to
 *     `active`; its old stage (variant A: the stage WAS the column) becomes the chain's cursor
 *     `x-at` (req-257, `cursorForPin`), the standard flow copied when it has no chain — and stays
 *     the old pin `x-phase` only when no cursor can be had (no chain, no flow);
 *     an `active` / `running` ticket a migration of milestone 239 left with a pin is converted the
 *     same way (the pin goes, the cursor comes) — the plan's `conversions`;
 *  3. `remove`: the lifecycle set (and the park stages the store had).
 */

/** The ticket facts the plan reads. */
export interface StagePlanRecord {
  readonly id: string;
  readonly stage: string;
  readonly owner: string | null;
  readonly extensions: Readonly<Record<string, string>>;
}

export interface StageMove {
  readonly id: string;
  readonly from: string;
  /** The column the ticket stood in: the pin it already has (variant B), else its old stage. */
  readonly pin: string;
}

/** What a ticket's old column becomes (req-257): its cursor, and the chain to copy when it had none (`;`-joined). */
export interface PinCursor {
  readonly at: number;
  readonly chain: string | null;
}

/** The column -> cursor rule the plan is given (the board's pipeline, crew and flow); null = no cursor to be had. */
export type PinCursorOf = (record: StagePlanRecord, pin: string) => PinCursor | null;

export type StageMigrationPlan =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'needed';
      /** The config of step 1; null when the store already has the lifecycle stages. */
      readonly add: StoreStageSet | null;
      readonly moves: readonly StageMove[];
      /** req-257: `active` / `running` tickets still carrying the pin `x-phase`: it becomes their cursor. */
      readonly conversions: readonly StageMove[];
      /** The config of step 3; null when no old stage is listed any more. */
      readonly remove: StoreStageSet | null;
      /** The stages that go. */
      readonly legacy: readonly string[];
      /** Tickets someone holds a claim on: the migration waits for them. */
      readonly claimed: readonly { readonly id: string; readonly owner: string }[];
    };

/** True for a store the migration is for: a `[stages]` table with `inbox` and `done`. Anything else is left alone. */
export function migratableStages(stages: StoreStageSet | null): stages is StoreStageSet {
  return stages !== null && stages.values.includes('inbox') && stages.values.includes('done');
}

/** The stages of a set that are neither lifecycle, park nor its cancelled stage. */
export function legacyStagesOf(stages: StoreStageSet): readonly string[] {
  return stages.values.filter((s) => !LIFECYCLE_STAGE_IDS.includes(s) && !PARK_STAGES.includes(s) && s !== stages.cancelled);
}

/** The target set: the five lifecycle stages, the store's park stages before `done`. */
export function lifecycleSetOf(stages: StoreStageSet): StoreStageSet {
  const park = PARK_STAGES.filter((s) => stages.values.includes(s));
  const values = [...LIFECYCLE_STAGE_IDS.slice(0, -1), ...park, 'done'];
  const terminal = stages.terminal.filter((s) => values.includes(s));
  return {
    values,
    initial: stages.initial !== null && values.includes(stages.initial) ? stages.initial : 'inbox',
    terminal: terminal.length > 0 ? terminal : ['done'],
    claim: LIFECYCLE_CLAIM_STAGES,
    cancelled: stages.cancelled,
  };
}

/** The set of step 1: the target set with the old stages still listed (after `prioritized`), the claim already `running`. */
export function bridgeSetOf(stages: StoreStageSet): StoreStageSet {
  const target = lifecycleSetOf(stages);
  const legacy = legacyStagesOf(stages);
  const at = target.values.indexOf('prioritized') + 1;
  return { ...target, values: [...target.values.slice(0, at), ...legacy, ...target.values.slice(at)] };
}

/**
 * `pinCursor` (req-257) turns an old column into a cursor; a leftover pin is planned for conversion only
 * where it gives one (absent = no conversions, a pin with no cursor to be had stays as it is).
 */
export function planStageMigration(stages: StoreStageSet | null, records: readonly StagePlanRecord[], pinCursor?: PinCursorOf): StageMigrationPlan {
  if (!migratableStages(stages)) {
    return { kind: 'none' };
  }
  const legacy = legacyStagesOf(stages);
  const add = isLifecycleStore(stages) ? null : bridgeSetOf(stages);
  const moves = records
    .filter((r) => legacy.includes(r.stage))
    .map((r) => ({ id: r.id, from: r.stage, pin: r.extensions[PHASE_PIN_KEY] ?? r.stage }));
  const remove = legacy.length > 0 ? lifecycleSetOf(stages) : null;
  const conversions = records
    .filter((r) => (r.stage === ACTIVE_STAGE || r.stage === RUNNING_STAGE) && (r.extensions[PHASE_PIN_KEY] ?? '') !== '')
    .filter((r) => pinCursor !== undefined && pinCursor(r, r.extensions[PHASE_PIN_KEY]!) !== null)
    .map((r) => ({ id: r.id, from: r.stage, pin: r.extensions[PHASE_PIN_KEY]! }));
  if (add === null && remove === null && moves.length === 0 && conversions.length === 0) {
    return { kind: 'none' };
  }
  const claimed = records.filter((r) => r.owner !== null).map((r) => ({ id: r.id, owner: r.owner! }));
  return { kind: 'needed', add, moves, conversions, remove, legacy, claimed };
}

/** The stage every move writes. */
export const MOVE_TARGET_STAGE = ACTIVE_STAGE;
