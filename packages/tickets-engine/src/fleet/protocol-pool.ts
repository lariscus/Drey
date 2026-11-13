import type { WorkerProviderId } from './protocol';
import type { CapabilityImportReport, ModelCapabilities, RouteRecord, RoutingSettings } from './protocol-routing';
import type { ModelNeeds } from '../contracts/ticket-pool-meta';

// ---------------------------------------------------------------------------
// The capacity pool (req-170, ADR-0095): the model table, the capacity cap,
// the class request and the three ledgers. These are the wire shapes
// `GET /models`, `POST /models/config`, the chain status and the run record
// carry; the runner's `fleet/routing/` computes them from `service.json`.

/** A model's capability class: A strongest, C lightest (board 7l). */
export type CapabilityClass = 'A' | 'B' | 'C';

/** Strongest first — the order a persona's pool is read in. */
export const CAPABILITY_CLASSES: readonly CapabilityClass[] = ['A', 'B', 'C'];

export function isCapabilityClass(value: unknown): value is CapabilityClass {
  return typeof value === 'string' && (CAPABILITY_CLASSES as readonly string[]).includes(value);
}

/** A plan part's size (S/M/L) as the class it asks for: S → C, M → B, L → A. */
export type PartSize = 'S' | 'M' | 'L';

export const PART_SIZE_CLASS: Readonly<Record<PartSize, CapabilityClass>> = { S: 'C', M: 'B', L: 'A' };

export function isPartSize(value: unknown): value is PartSize {
  return value === 'S' || value === 'M' || value === 'L';
}

/** One row of the model table in `service.json` (board 7l's Model table); req-178 adds the declared capabilities. */
export interface ModelRow extends ModelCapabilities {
  /** The model id the harness is started with (`claude-opus-4-1`, `glm-5.3`). */
  readonly model: string;
  /** The slot (account, req-177) that serves it; absent = every slot of `provider`. */
  readonly slot: string | null;
  /** The harness provider; with `slot` set, the slot's own provider. */
  readonly provider: WorkerProviderId;
  /** Free text: `frontier`, `everyday`, `bulk`. */
  readonly category: string;
  readonly class: CapabilityClass;
  /** What one active session of this model weighs against the caps. */
  readonly cost: number;
  /** Concurrent sessions of this model one slot serves. */
  readonly sessions: number;
}

/** The capacity cap: the summed cost factors of the active sessions may not exceed it. */
export interface CapacityConfig {
  /** Over every slot; null = no global cap. */
  readonly global: number | null;
  /** Per slot id, explicit; a slot not named here takes its derived cap (its largest row's cost × sessions). */
  readonly perSlot: Readonly<Record<string, number>>;
}

/** The ledgers' defaults (board 7l's Ledgers group), USD; null = no limit. */
export interface LedgerDefaults {
  /** A ticket's allowance when its frontmatter sets none. */
  readonly ticketAllowance: number | null;
  /** A persona's day when its `persona.md` sets no `budget:`. */
  readonly personaPerDay: number | null;
  /** Every slot's day (an account's spend). */
  readonly providerPerDay: number | null;
}

/** The pool's machine-scope settings as `GET /models` answers and `POST /models/config` takes them. */
export interface PoolSettings {
  readonly models: readonly ModelRow[];
  readonly capacity: CapacityConfig;
  readonly ledgers: LedgerDefaults;
  /** req-178: board 7l's Routing group. */
  readonly routing: RoutingSettings;
}

/** One slot's load against its cap. */
export interface SlotLoad {
  readonly id: string;
  readonly label: string;
  /** Summed cost factors of the slot's active sessions. */
  readonly used: number;
  /** The slot's cap; null = none (no row serves it and none is set). */
  readonly cap: number | null;
  /** True when the cap is derived from the rows, not set. */
  readonly derived: boolean;
}

/** The live sum — "Now: 2.4 of 6 · Claude A 2 of 5 · z.ai 0.4 of 1.2". */
export interface PoolLoad {
  readonly used: number;
  readonly global: number | null;
  readonly slots: readonly SlotLoad[];
}

/** Why a queued task waits: capacity (a slot of its class frees), a full ledger, or a configuration the owner must fix. */
export type QueueReason = 'capacity' | 'ledger' | 'config';

/** One task the pool did not grant this pass (the card's `queued · waits for a B slot`). */
export interface QueueEntry {
  readonly ticket: string;
  readonly persona: string | null;
  /** The class it asked for; null when it asked for a pinned model only. */
  readonly class: CapabilityClass | null;
  readonly reason: QueueReason;
  /** The card's line, `waits for a B slot`. */
  readonly line: string;
  /** The full reason for the log and Pia. */
  readonly detail: string;
  /** 1 = served first when capacity frees (priority order). */
  readonly position: number;
  readonly since: string;
}

/** One ledger as `GET /models` shows the day. */
export interface LedgerFigure {
  readonly id: string;
  readonly spent: number;
  readonly limit: number | null;
}

/** What `GET /models` answers. */
export interface ModelsReply extends PoolSettings {
  readonly ok: true;
  readonly now: PoolLoad;
  readonly queue: readonly QueueEntry[];
  /** Today's spend per slot against the provider ledger. */
  readonly providerDay: readonly LedgerFigure[];
  /** Entries `service.json` holds that the parse left out, one line each. */
  readonly errors: readonly string[];
  readonly configPath: string;
  /** req-178: on the answer of `POST /models/import` only. */
  readonly imported?: CapabilityImportReport;
}

/** The pool's decision on a run record and in the stream: the class asked for, the model that ran, why. */
export interface PoolGrantRecord {
  readonly requested: CapabilityClass | null;
  readonly class: CapabilityClass | null;
  readonly model: string;
  readonly cost: number;
  readonly reason: string;
  /** req-178: the routing's decision — slot, model, surplus, estimated cost, step up, the filtered slots; absent before req-178. */
  readonly route?: RouteRecord;
}

/** What a start carries for the ledgers (the runner reads no ticket or persona file itself). */
export interface RunLedgerInput {
  /** The ticket's `allowance:`; null = the default from Settings. */
  readonly allowance: number | null;
  /** The persona's `budget:`; null = the default from Settings. */
  readonly personaBudget: number | null;
  /** The persona's `allowed: spend-above-allowance` — it may run on past its ticket allowance. */
  readonly spendAboveAllowance: boolean;
  /** req-168: a session without a ticket (a 1:1) — no ticket allowance applies; the persona's and the provider's ledgers still do. */
  readonly noTicket?: boolean;
}

export type LedgerName = 'ticket' | 'persona' | 'provider';

/** A ledger that grants nothing more: which one, how far, and the line the card and the log show. */
export interface FullLedger {
  readonly ledger: LedgerName;
  /** The Needs-you card's key: `ledger-ticket`, `ledger-persona-ben`, `ledger-provider-claude-a`. */
  readonly key: string;
  readonly spent: number;
  readonly limit: number;
  readonly line: string;
}

/** One model a session may run: `<model>` or `<provider>/<model>` of a persona's pool. */
export interface PoolEntry {
  /** The provider the entry names; null = any provider whose rows hold the model. */
  readonly provider: WorkerProviderId | null;
  /** Null = the harness's own default (a start that names no model). */
  readonly model: string | null;
}

/**
 * What a session asks the pool for before it starts (req-170, ADR-0095):
 * `{persona, class, context size}` plus what the pool needs to answer —
 * the models it may run and the ledger inputs.
 */
export interface ClassRequest {
  readonly ticket: string;
  readonly persona: string | null;
  /** The class asked for; null = a pinned model decides by its own row. */
  readonly class: CapabilityClass | null;
  /** The models it may run, strongest first (the persona's pool, or the one pinned model). */
  readonly pool: readonly PoolEntry[];
  /** The harness an entry without a provider runs on when the table does not hold it. */
  readonly provider: WorkerProviderId;
  /** The context the session expects to need; the filter takes no model with a smaller declared window (req-178). */
  readonly contextTokens: number | null;
  /** req-178: the capabilities its model must have (the phase's and the ticket's `needs:`); absent = none. */
  readonly needs?: ModelNeeds | null;
  /** req-178: the choice may step up within the slot above `Upgrade above q`; false on a pin and at a start's gate. */
  readonly stepUp?: boolean;
  readonly ledger: RunLedgerInput;
  /** The slot to prefer (where a resumed session lives). */
  readonly prefer: string | null;
  /** Why this class: the size, the floor, the pin. */
  readonly why: string;
}

/** A grant: the slot, the model and its row's weight. */
export interface PoolGrantDecision {
  readonly kind: 'grant';
  readonly slot: { readonly id: string; readonly label: string };
  readonly provider: WorkerProviderId;
  readonly model: string | null;
  readonly class: CapabilityClass | null;
  readonly cost: number;
  readonly reason: string;
  /** req-178: the routing's decision behind the grant. */
  readonly route?: RouteRecord;
}

/** No grant: the session waits, no process is spawned. */
export interface PoolWaitDecision {
  readonly kind: 'wait';
  readonly reason: QueueReason;
  /** The card's line: `waits for a B slot`. */
  readonly line: string;
  readonly detail: string;
  /** The ledger that is full, when that is why. */
  readonly ledger?: FullLedger;
}

export type PoolDecision = PoolGrantDecision | PoolWaitDecision;
