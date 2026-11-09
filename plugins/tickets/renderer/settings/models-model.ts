// i18n: catalog
/**
 * Settings → Tickets → Models (board 7l, req-186): the pure half. What the
 * five groups say, read from the engine's two answers — `poolModels` (the
 * model table, the caps, the ledger defaults, the live load) and `slots`
 * (the accounts with their quota windows) — and what an edit sends back.
 * DOM-free, so the page and its spec share it.
 */
import type {
  CapabilityClass,
  LedgerDefaults,
  ModelRow,
  ModelsReply,
  QuotaReliability,
  QuotaWindow,
  RoutingSettings,
  SlotBilling,
  SlotView,
  WorkerProviderId,
} from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { I18n } from '../../../../shared/i18n/types';
import { RUNNER_LABEL } from '../settings-workers';

/** Width of the window bar, board 7l. */
export const BAR_WIDTH = 120;

const trimmedNumber = (i18n: I18n, value: number): string => i18n.formatNumber(value, { maximumFractionDigits: 2 });

// --- the model table ---------------------------------------------------------

export interface ModelRowView {
  readonly index: number;
  readonly row: ModelRow;
  /** The provider column: the slot's name, else the runner's. */
  readonly provider: string;
  /** True for a row that runs on work-profile slots only: dimmed, with the `Work` chip. */
  readonly work: boolean;
  readonly cost: string;
  readonly sessions: string;
}

export function providerLabelOf(row: ModelRow, slots: readonly SlotView[]): string {
  if (row.slot !== null) {
    return slots.find((slot) => slot.id === row.slot)?.label ?? row.slot;
  }
  return RUNNER_LABEL[row.provider];
}

/** Whether a row runs on work slots only (its slot, or every slot of its provider). */
export function isWorkRow(row: ModelRow, slots: readonly SlotView[]): boolean {
  const served = slots.filter((slot) => (row.slot !== null ? slot.id === row.slot : slot.provider === row.provider));
  return served.length > 0 && served.every((slot) => slot.profile === 'work');
}

export function modelRowsOf(reply: ModelsReply | null, slots: readonly SlotView[], i18n: I18n): readonly ModelRowView[] {
  return (reply?.models ?? []).map((row, index) => ({
    index,
    row,
    provider: providerLabelOf(row, slots),
    work: isWorkRow(row, slots),
    cost: trimmedNumber(i18n, row.cost),
    sessions: i18n.formatNumber(row.sessions),
  }));
}

/** The value of the provider column's picker: a slot, or a runner the table names without one. */
export type PlaceChoice = `slot:${string}` | `provider:${WorkerProviderId}`;

export function placeChoiceOf(row: Pick<ModelRow, 'slot' | 'provider'>): PlaceChoice {
  return row.slot !== null ? `slot:${row.slot}` : `provider:${row.provider}`;
}

export interface PlaceOption {
  readonly value: PlaceChoice;
  readonly label: string;
}

/** What the provider picker offers: every slot, then the runners no slot is named for. */
export function placeOptionsOf(slots: readonly SlotView[]): readonly PlaceOption[] {
  const named = new Set(slots.map((slot) => slot.provider));
  const providers = (Object.keys(RUNNER_LABEL) as WorkerProviderId[]).filter((id) => !named.has(id));
  return [
    ...slots.map((slot): PlaceOption => ({ value: `slot:${slot.id}`, label: slot.label })),
    ...providers.map((id): PlaceOption => ({ value: `provider:${id}`, label: RUNNER_LABEL[id] })),
  ];
}

export function rowPlaced(row: ModelRow, choice: PlaceChoice, slots: readonly SlotView[]): ModelRow {
  if (choice.startsWith('slot:')) {
    const id = choice.slice('slot:'.length);
    const slot = slots.find((s) => s.id === id);
    return { ...row, slot: id, provider: slot?.provider ?? row.provider };
  }
  return { ...row, slot: null, provider: choice.slice('provider:'.length) as WorkerProviderId };
}

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

const invalid = { ok: false } as const;

/** A decimal typed in a field (`0.4`, `2,5`); empty = nothing. */
function numberOf(text: string): number | null | 'invalid' {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : 'invalid';
}

export function parseCostFactor(text: string): Parsed<number> {
  const value = numberOf(text);
  return typeof value === 'number' ? { ok: true, value } : invalid;
}

export function parseSessions(text: string): Parsed<number> {
  const value = numberOf(text);
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? { ok: true, value } : invalid;
}

/** The global cap; empty = no cap. */
export function parseCap(text: string): Parsed<number | null> {
  const value = numberOf(text);
  return value === 'invalid' ? invalid : { ok: true, value };
}

/** A dollar amount (`$2.50`, `2.5`); empty = no limit. */
export function parseMoney(text: string): Parsed<number | null> {
  return parseCap(text.replace(/[$\s]/g, ''));
}

export function moneyText(value: number | null, i18n: I18n): string {
  return value === null ? '' : i18n.formatCurrency(value);
}

export function capText(value: number | null, i18n: I18n): string {
  return value === null ? '' : trimmedNumber(i18n, value);
}

/** What `poolModelsConfig` takes for a changed table. */
export function modelsPayload(rows: readonly ModelRow[]): { models: readonly Record<string, unknown>[] } {
  return {
    models: rows.map((row) => ({
      model: row.model,
      ...(row.slot !== null ? { slot: row.slot } : { provider: row.provider }),
      category: row.category,
      class: row.class,
      cost: row.cost,
      sessions: row.sessions,
    })),
  };
}

// --- capacity ----------------------------------------------------------------

export interface CapacityView {
  readonly global: string;
  /** The read-only per-slot list. */
  readonly perProvider: readonly { readonly label: string; readonly cap: string }[];
  /** `Now: 2.4 of 6 · Claude A 2 of 5 · z.ai 0.4 of 1.2`. */
  readonly now: string;
}

export function capacityViewOf(reply: ModelsReply | null, i18n: I18n): CapacityView {
  if (reply === null) {
    return { global: '', perProvider: [], now: '' };
  }
  const load = reply.now;
  const head =
    load.global === null
      ? i18n.t('tickets.settings.models.cap.now_open', { used: trimmedNumber(i18n, load.used) })
      : i18n.t('tickets.settings.models.cap.now', { used: trimmedNumber(i18n, load.used), cap: trimmedNumber(i18n, load.global) });
  const busy = load.slots
    .filter((slot) => slot.used > 0)
    .map((slot) =>
      slot.cap === null
        ? i18n.t('tickets.settings.models.cap.now_slot_open', { label: slot.label, used: trimmedNumber(i18n, slot.used) })
        : i18n.t('tickets.settings.models.cap.now_slot', { label: slot.label, used: trimmedNumber(i18n, slot.used), cap: trimmedNumber(i18n, slot.cap) }),
    );
  return {
    global: capText(reply.capacity.global, i18n),
    perProvider: load.slots.map((slot) => ({ label: slot.label, cap: slot.cap === null ? '–' : trimmedNumber(i18n, slot.cap) })),
    now: busy.length === 0 ? head : i18n.t('tickets.settings.models.cap.now_join', { head, slots: busy.join(' · ') }),
  };
}

export function capacityPayload(reply: ModelsReply, global: number | null): { capacity: { global: number | null; perSlot: Readonly<Record<string, number>> } } {
  return { capacity: { global, perSlot: reply.capacity.perSlot } };
}

// --- routing (req-178 / req-181) -----------------------------------------------

export type RoutingKey = keyof RoutingSettings;

/** What the Routing group's three fields show: `1.3` (empty = never), the two shares as percent (`10`, `20`). */
export interface RoutingView {
  readonly upgradeAboveQ: string;
  readonly reservePerWindow: string;
  readonly burnRate: string;
}

const percentText = (share: number, i18n: I18n): string => i18n.formatNumber(Math.round(share * 1000) / 10, { maximumFractionDigits: 1 });

export function routingViewOf(routing: RoutingSettings, i18n: I18n): RoutingView {
  return {
    upgradeAboveQ: routing.upgradeAboveQ === null ? '' : trimmedNumber(i18n, routing.upgradeAboveQ),
    reservePerWindow: percentText(routing.reservePerWindow, i18n),
    burnRate: percentText(routing.burnRate, i18n),
  };
}

/** `Upgrade above q` as the engine takes it: a surplus above 0; empty = never step up. */
export function parseUpgrade(text: string): Parsed<number | null> {
  const value = numberOf(text);
  return value === null || (typeof value === 'number' && value > 0) ? { ok: true, value } : invalid;
}

/** A share typed as percent (`10`, `12,5`) as the engine takes it: 0 to below 1; empty = 0 (off). */
export function parsePercentShare(text: string): Parsed<number> {
  const value = numberOf(text.replace('%', ''));
  if (value === null) {
    return { ok: true, value: 0 };
  }
  return typeof value === 'number' && value < 100 ? { ok: true, value: Math.round(value * 10) / 1000 } : invalid;
}

/** The field's text as the routing key's value. */
export function parseRouting(key: RoutingKey, text: string): Parsed<number | null> {
  return key === 'upgradeAboveQ' ? parseUpgrade(text) : parsePercentShare(text);
}

/** What `poolModelsConfig` takes for one changed field: the whole `routing` key, the others as the engine has them. */
export function routingPayload(routing: RoutingSettings, key: RoutingKey, value: number | null): { routing: RoutingSettings } {
  return { routing: { ...routing, [key]: value } };
}

// --- ledgers -----------------------------------------------------------------

export type LedgerKey = keyof LedgerDefaults;

export function ledgerPayload(reply: ModelsReply, key: LedgerKey, value: number | null): { ledgers: LedgerDefaults } {
  return { ledgers: { ...reply.ledgers, [key]: value } };
}

// --- slots -------------------------------------------------------------------

export interface WindowView {
  readonly label: string;
  /** The bar's fill; null = no bar (the share is not known). */
  readonly bar: { readonly width: number; readonly low: boolean } | null;
  readonly text: string;
  readonly reliability: QuotaReliability;
}

export interface SlotCardView {
  readonly id: string;
  readonly name: string;
  readonly profile: string;
  readonly billing: string;
  readonly windows: readonly WindowView[];
  /** The one row of a slot whose quota nothing measures: its words and the `unknown` chip. */
  readonly unknownRow: string | null;
  /** `q 1.4 · upgrade allowed`; '' = none. */
  readonly q: string;
}

/** When a window resets: the time today, weekday and time within the week, else the day. */
export function resetWords(at: Date, now: Date, i18n: I18n): string {
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) {
    return i18n.formatTime(at);
  }
  const days = (at.getTime() - now.getTime()) / 86_400_000;
  if (days > 0 && days < 7) {
    const weekday = new Intl.DateTimeFormat(i18n.locale, { weekday: 'short' }).format(at);
    return i18n.t('tickets.settings.models.slot.weekday_time', { weekday, time: i18n.formatTime(at) });
  }
  return new Intl.DateTimeFormat(i18n.locale, { day: 'numeric', month: 'short' }).format(at);
}

const WINDOW_KEY: Readonly<Record<string, string>> = { '5h': 'five_hours', '7d': 'seven_days', month: 'month', 'month-code': 'month_code' };

function windowLabel(name: string, i18n: I18n): string {
  const key = `tickets.settings.models.window.${WINDOW_KEY[name] ?? name}`;
  return i18n.has(key) ? i18n.lookup(key) : name;
}

function windowText(window: QuotaWindow, now: Date, i18n: I18n): string {
  const at = window.resetsAt === null ? null : new Date(window.resetsAt);
  const when = at !== null && !Number.isNaN(at.getTime()) ? resetWords(at, now, i18n) : null;
  if (window.remaining === null) {
    return i18n.t('capacity.slot.quota_unknown');
  }
  const counted = window.limit !== undefined && window.used !== undefined;
  const params = counted
    ? { left: i18n.formatNumber(Math.max(0, window.limit! - window.used!)), limit: i18n.formatNumber(window.limit!), when: when ?? '' }
    : { share: Math.round(window.remaining * 100), when: when ?? '' };
  const key = `tickets.settings.models.slot.${counted ? 'count_left' : 'share_left'}${when === null ? '' : '_resets'}`;
  return i18n.lookup(key, params);
}

/** What the slot cards read of the pool: the table's rows and the engine's routing (the reserve's peach, the upgrade mark). */
export interface SlotCardPool {
  readonly rows: readonly ModelRow[];
  readonly routing: RoutingSettings;
}

function windowViewOf(window: QuotaWindow, now: Date, i18n: I18n, reserve: number): WindowView {
  const share = window.remaining === null ? null : Math.min(1, Math.max(0, window.remaining));
  return {
    label: windowLabel(window.name, i18n),
    bar: share === null ? null : { width: Math.round(share * BAR_WIDTH * 100) / 100, low: share < reserve },
    text: windowText(window, now, i18n),
    reliability: window.reliability,
  };
}

export function billingWords(billing: SlotBilling | null, i18n: I18n): string {
  if (billing === null) {
    return '';
  }
  const price = billing.kind === 'subscription' ? billing.pricePerMonth : billing.pricePerCredit;
  const money =
    price === null
      ? null
      : new Intl.NumberFormat(i18n.locale, { style: 'currency', currency: billing.currency ?? 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(price);
  return i18n.lookup(`tickets.settings.models.billing.${billing.kind}${money === null ? '_unpriced' : ''}`, { price: money ?? '' });
}

/** The classes the slot's rows serve, strongest first. */
export function classesOfSlot(slot: SlotView, rows: readonly ModelRow[]): readonly CapabilityClass[] {
  const served = rows.filter((row) => (row.slot !== null ? row.slot === slot.id : row.provider === slot.provider)).map((row) => row.class);
  return (['A', 'B', 'C'] as const).filter((letter) => served.includes(letter));
}

function qWords(slot: SlotView, pool: SlotCardPool, i18n: I18n): string {
  if (slot.state === 'needs-login') {
    return i18n.t('capacity.slot.needs_login');
  }
  if (slot.q === null || !Number.isFinite(slot.q)) {
    return '';
  }
  const q = i18n.formatNumber(slot.q, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const upgrade = pool.routing.upgradeAboveQ;
  if (upgrade !== null && Math.round(slot.q * 10) / 10 > upgrade) {
    return i18n.t('tickets.settings.models.slot.q_upgrade', { q });
  }
  const classes = classesOfSlot(slot, pool.rows);
  if (classes.length === 0) {
    return i18n.t('tickets.settings.models.slot.q_only', { q });
  }
  return i18n.t('tickets.settings.models.slot.q_class', { q, classes: new Intl.ListFormat(i18n.locale, { type: 'conjunction' }).format(classes) });
}

export function slotCardsOf(slots: readonly SlotView[], pool: SlotCardPool, now: Date, i18n: I18n): readonly SlotCardView[] {
  return slots.map((slot) => {
    const measured = slot.windows.some((window) => window.remaining !== null);
    return {
      id: slot.id,
      name: slot.label,
      profile: i18n.lookup(`tickets.settings.models.profile.${slot.profile}`),
      billing: billingWords(slot.billing, i18n),
      windows: measured ? slot.windows.map((window) => windowViewOf(window, now, i18n, pool.routing.reservePerWindow)) : [],
      unknownRow: measured ? null : i18n.t(slot.quota === 'counting' ? 'tickets.settings.models.slot.counted' : 'capacity.slot.quota_unknown'),
      q: qWords(slot, pool, i18n),
    };
  });
}

// --- the Runners line of the desk ----------------------------------------------

/** `Claude A 2 · z.ai 3`: the slots and the sessions each serves (req-186, in place of the pool sizes). */
export function slotSessionsLine(slots: readonly SlotView[], i18n: I18n): string {
  if (slots.length === 0) {
    return i18n.t('tickets.settings.models.runners_none');
  }
  return slots.map((slot) => (slot.total === null ? slot.label : `${slot.label} ${i18n.formatNumber(slot.total)}`)).join(' · ');
}

/** Rows a slot picker offers for a blank new row: the first place there is. */
export function blankRowOf(options: readonly PlaceOption[], slots: readonly SlotView[]): ModelRow {
  const first = options[0];
  const base: ModelRow = { model: '', slot: null, provider: 'claude-code', category: '', class: 'B', cost: 1, sessions: 1 };
  return first === undefined ? base : rowPlaced(base, first.value, slots);
}
