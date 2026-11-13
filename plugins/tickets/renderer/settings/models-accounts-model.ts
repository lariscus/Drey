// i18n: catalog
/**
 * Settings → Models, the Accounts group (board 7l v3): one row per slot with
 * its cost edited in place, its sessions and its quota windows. The pure half:
 * the billing kind / amount / unit mapping, the window bars, the count of
 * models that would lose their only account, and the entries a write sends.
 */
import type { QuotaWindow, SlotBilling, SlotView, ModelRow, WorkerProviderId } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { I18n } from '../../../../shared/i18n/types';
import { numberOf, trimmedNumber, type Parsed, invalid } from './models-model';

export type BillingKind = SlotBilling['kind'];

export const BILLING_KINDS: readonly BillingKind[] = ['subscription', 'credits', 'token'];

export const DEFAULT_CURRENCY = 'EUR';

/** The word of a kind in the Cost select. */
export const billingLabel = (kind: BillingKind, i18n: I18n): string => i18n.lookup(`tickets.settings.models.billing.${kind}`);

/** The unit after the amount: `per month`, `per credit`, `per 1M tokens`. */
export const billingUnit = (kind: BillingKind, i18n: I18n): string => i18n.lookup(`tickets.settings.models.billing.${kind}_unit`);

export function billingKindOf(billing: SlotBilling | null): BillingKind {
  return billing?.kind ?? 'subscription';
}

export function billingAmountOf(billing: SlotBilling | null): number | null {
  if (billing === null) {
    return null;
  }
  switch (billing.kind) {
    case 'subscription':
      return billing.pricePerMonth;
    case 'credits':
      return billing.pricePerCredit;
    case 'token':
      return billing.pricePerMillion;
  }
}

/** The billing a kind and an amount make; the currency stays the slot's own. */
export function billingOf(kind: BillingKind, amount: number | null, currency: string): SlotBilling {
  switch (kind) {
    case 'subscription':
      return { kind, pricePerMonth: amount, currency };
    case 'credits':
      return { kind, pricePerCredit: amount, currency };
    case 'token':
      return { kind, pricePerMillion: amount, currency };
  }
}

/** The amount field's text: `90`, `0.04`; empty = no price. */
export const amountText = (billing: SlotBilling | null, i18n: I18n): string => {
  const amount = billingAmountOf(billing);
  return amount === null ? '' : trimmedNumber(i18n, amount);
};

/** What an amount field holds: a price of 0 or more; empty = no price yet. */
export function parseAmount(text: string): Parsed<number | null> {
  const value = numberOf(text.replace(/[€$\s]/g, ''));
  return value === 'invalid' ? invalid : { ok: true, value };
}

/** The currency symbol the field leads with (`€`). */
export function currencySymbol(currency: string | undefined, i18n: I18n): string {
  const parts = new Intl.NumberFormat(i18n.locale, { style: 'currency', currency: currency ?? DEFAULT_CURRENCY }).formatToParts(0);
  return parts.find((part) => part.type === 'currency')?.value ?? currency ?? DEFAULT_CURRENCY;
}

export const billingCurrencyOf = (billing: SlotBilling | null): string => billing?.currency ?? DEFAULT_CURRENCY;

/** `slotUpdate`'s patch for a changed cost. */
export function billingPatch(kind: BillingKind, amountTyped: string, currency: string): Parsed<{ readonly billing: SlotBilling }> {
  const amount = parseAmount(amountTyped);
  return amount.ok ? { ok: true, value: { billing: billingOf(kind, amount.value, currency) } } : invalid;
}

// --- quota windows ----------------------------------------------------------------

export interface WindowBar {
  readonly label: string;
  /** The fill, 0 to 100 percent of the bar. */
  readonly percent: number;
  readonly low: boolean;
  readonly text: string;
  /** The tooltip: label and words. */
  readonly title: string;
}

const WINDOW_KEY: Readonly<Record<string, string>> = { '5h': 'five_hours', '7d': 'seven_days', month: 'month', 'month-code': 'month_code' };

function windowLabel(name: string, i18n: I18n): string {
  const key = `tickets.settings.models.window.${WINDOW_KEY[name] ?? name}`;
  return i18n.has(key) ? i18n.lookup(key) : name;
}

function windowText(window: QuotaWindow, i18n: I18n): string {
  const remaining = window.remaining ?? 0;
  if (window.limit !== undefined && window.used !== undefined) {
    return i18n.t('tickets.settings.models.slot.count_left', { left: i18n.formatNumber(Math.max(0, window.limit - window.used)), limit: i18n.formatNumber(window.limit) });
  }
  return i18n.t('tickets.settings.models.slot.share_left', { share: Math.round(remaining * 100) });
}

/** The measured windows of a slot as bars; none when nothing measures its quota. */
export function windowBarsOf(slot: SlotView, reserve: number, i18n: I18n): readonly WindowBar[] {
  return slot.windows
    .filter((window) => window.remaining !== null)
    .map((window) => {
      const share = Math.min(1, Math.max(0, window.remaining ?? 0));
      const label = windowLabel(window.name, i18n);
      const text = windowText(window, i18n);
      return { label, percent: Math.round(share * 100), low: share < reserve, text, title: `${label} ${text}` };
    });
}

// --- removing an account ---------------------------------------------------------

/** How many models run only on this account: its own rows, and the provider rows no other account of that harness serves. */
export function usesOnlyCount(slot: Pick<SlotView, 'id' | 'provider'>, slots: readonly SlotView[], rows: readonly ModelRow[]): number {
  const otherAccount = slots.some((other) => other.id !== slot.id && other.provider === slot.provider);
  return rows.filter((row) => (row.slot !== null ? row.slot === slot.id : row.provider === slot.provider && !otherAccount)).length;
}

export function removeAsk(name: string, uses: number, i18n: I18n): string {
  return uses === 0 ? i18n.t('tickets.settings.models.accounts.remove_ask', { name }) : i18n.t('tickets.settings.models.accounts.remove_ask_uses', { name, count: uses });
}

/** `slotRemove`'s payload: the models go with the account only when some run only on it. */
export function removePayload(id: string, uses: number): { id: string; withModels?: true } {
  return uses > 0 ? { id, withModels: true } : { id };
}

// --- adding an account -----------------------------------------------------------

export interface SlotEntry {
  readonly id: string;
  readonly label: string;
  readonly provider: WorkerProviderId;
  readonly billing: SlotBilling;
  readonly sessions: number;
}

/** The id a label makes: lower case, `-` for anything an id may not hold; '' when nothing is left. */
export function slotIdOf(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|-+$/g, '')
    .slice(0, 48);
}

/** The entry `slotAdd` takes, or the reason it does not (the label, the amount, a taken id). */
export function slotEntryOf(
  draft: { readonly label: string; readonly provider: WorkerProviderId; readonly kind: BillingKind; readonly amount: string; readonly sessions: number },
  slots: readonly SlotView[],
): { readonly ok: true; readonly entry: SlotEntry } | { readonly ok: false; readonly field: 'label' | 'amount' } {
  const id = slotIdOf(draft.label);
  if (id === '' || slots.some((slot) => slot.id === id)) {
    return { ok: false, field: 'label' };
  }
  const amount = parseAmount(draft.amount);
  if (!amount.ok) {
    return { ok: false, field: 'amount' };
  }
  return { ok: true, entry: { id, label: draft.label.trim(), provider: draft.provider, billing: billingOf(draft.kind, amount.value, DEFAULT_CURRENCY), sessions: draft.sessions } };
}
