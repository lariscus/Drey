import type { CapabilityClass } from './protocol-pool';

// ---------------------------------------------------------------------------
// Surplus routing (req-178, ADR-0095 later change): the choice within the
// granted class. A hard filter (profile, required capabilities, provider
// rules, slot state, caps, ledgers, the reserve per window), then the soft
// choice by the largest surplus `q`, a model step up within the slot above
// `Upgrade above q` — never a smaller class. These are the wire shapes the
// model table's capability columns, `service.json`'s `routing` key and the
// run record carry; `fleet/routing/` computes them.

/** An input a model row may declare it reads (models.dev's `modalities.input`, the two the filter asks for). */
export type InputModality = 'text' | 'image';

export const INPUT_MODALITIES: readonly InputModality[] = ['text', 'image'];

/** A model row's declared capabilities (optional columns of the model table; absent = not declared). */
export interface ModelCapabilities {
  /** What the model reads; absent = not declared, so a step that needs image input does not take it. */
  readonly input?: readonly InputModality[];
  /** It makes tool calls; `false` keeps every agent session off it. */
  readonly tools?: boolean;
  /** Its context window, in tokens. */
  readonly context?: number;
  /** Its output limit per answer, in tokens. */
  readonly output?: number;
}

/** Board 7l's Routing group (`service.json` → `routing`). */
export interface RoutingSettings {
  /** `Upgrade above q`: above this surplus a slot runs the next stronger model of the persona's pool it serves; null = never. */
  readonly upgradeAboveQ: number | null;
  /** `Reserve per window`, a share 0–1: a run whose estimated share would take a window below it waits. 0 = no reserve. */
  readonly reservePerWindow: number;
  /** `Burn rate` (req-181), a share 0–1: at most this much of the weekly quota per day over all slots; reached = no new run starts until the day turns. 0 = off. */
  readonly burnRate: number;
}

export const DEFAULT_ROUTING: RoutingSettings = { upgradeAboveQ: 1.3, reservePerWindow: 0.1, burnRate: 0.2 };

/**
 * Where a burn-rate figure comes from (req-181): every counted slot read its
 * weekly window (`measured`), none did — counted windows or the runs' share
 * estimates (`estimated`) — or some of each (`mixed`).
 */
export type BurnRateBasis = 'measured' | 'estimated' | 'mixed';

/** One slot's part of today's burn rate: the share of its week spent since the day began. */
export interface BurnRateSlotReading {
  readonly slot: string;
  readonly spent: number;
  readonly basis: 'measured' | 'estimated';
}

/** The share of the weekly quota spent today over all counted slots (their mean); `basis` null = no slot counted. */
export interface BurnRateReading {
  /** The UTC date the figure is for. */
  readonly day: string;
  readonly spent: number;
  readonly basis: BurnRateBasis | null;
  readonly slots: readonly BurnRateSlotReading[];
}

/** What `POST /models/import` (the one-shot models.dev import) did: the rows it filled and with which columns, the models it did not find. */
export interface CapabilityImportReport {
  readonly filled: readonly { readonly model: string; readonly where: string; readonly fields: readonly string[] }[];
  readonly unmatched: readonly string[];
}

/** One slot the filter took out of a decision, and why (`kimi (no image input)`). */
export interface FilteredSlot {
  readonly slot: string;
  /** The model it was asked for there; null for an untabled start. */
  readonly model: string | null;
  readonly reason: string;
}

/** A step up within the slot: the model the choice took first and its class. */
export interface RouteStepUp {
  readonly from: string;
  readonly fromClass: CapabilityClass;
}

/**
 * The routing's decision on the run record, in the runner log and the run's
 * stream: where and on what the run went, the surplus that chose it, the
 * estimated cost, the step up if any, and every slot the filter left out.
 */
export interface RouteRecord {
  readonly slot: string;
  readonly model: string | null;
  /** The class it runs at; above `requested` only after a step up. */
  readonly class: CapabilityClass | null;
  readonly requested: CapabilityClass | null;
  /** The chosen slot's surplus when it was chosen; null when no window could tell. */
  readonly q: number | null;
  /** The estimated cost of the run in USD (the ticket's typical run, else the persona's, else the model's); null = no history. */
  readonly estimatedUsd: number | null;
  readonly stepUp: RouteStepUp | null;
  readonly filtered: readonly FilteredSlot[];
  /** `route T-0121 → claude-a/sonnet: class B, q 1.4, est $0.40 · filtered: kimi (no image input)`. */
  readonly line: string;
}
