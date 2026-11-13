import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import {
  amountText,
  billingAmountOf,
  billingOf,
  billingPatch,
  billingUnit,
  currencySymbol,
  removeAsk,
  removePayload,
  slotEntryOf,
  usesOnlyCount,
  windowBarsOf,
} from './models-accounts-model';
import { row, slot, slots } from './models-fixtures';

describe('billing', () => {
  it('maps each kind to its price key and its unit', () => {
    expect(billingAmountOf({ kind: 'subscription', pricePerMonth: 90 })).toBe(90);
    expect(billingAmountOf({ kind: 'credits', pricePerCredit: 0.04 })).toBe(0.04);
    expect(billingAmountOf({ kind: 'token', pricePerMillion: 3 })).toBe(3);
    expect((['subscription', 'credits', 'token'] as const).map((kind) => billingUnit(kind, i18n))).toEqual(['per month', 'per credit', 'per 1M tokens']);
  });

  it('changing the kind keeps the typed amount under the new kind key', () => {
    expect(billingPatch('token', '3,5', 'EUR')).toEqual({ ok: true, value: { billing: { kind: 'token', pricePerMillion: 3.5, currency: 'EUR' } } });
    expect(billingPatch('credits', '', 'EUR')).toEqual({ ok: true, value: { billing: billingOf('credits', null, 'EUR') } });
    expect(billingPatch('credits', 'abc', 'EUR')).toEqual({ ok: false });
  });

  it('shows the amount and the currency symbol', () => {
    expect(amountText({ kind: 'credits', pricePerCredit: 0.04 }, i18n)).toBe('0.04');
    expect(amountText(null, i18n)).toBe('');
    expect(currencySymbol('EUR', i18n)).toBe('€');
  });
});

describe('the quota windows', () => {
  it('draws the measured windows as bars with the share left', () => {
    expect(windowBarsOf(slots[0]!, 0.1, i18n)).toEqual([{ label: '5 h', percent: 78, low: false, text: '78 % left', title: '5 h 78 % left' }]);
  });

  it('marks a window below the reserve, and draws none for an unmeasured slot', () => {
    const low = slot({ id: 'x', label: 'X', windows: [{ name: '7d', spanMs: null, remaining: 0.05, resetsAt: null, reliability: 'measured', fetchedAt: null }] });
    expect(windowBarsOf(low, 0.1, i18n)[0]).toMatchObject({ label: '7 d', low: true });
    const unknown = slot({ id: 'y', label: 'Y', windows: [{ name: '5h', spanMs: null, remaining: null, resetsAt: null, reliability: 'unknown', fetchedAt: null }] });
    expect(windowBarsOf(unknown, 0.1, i18n)).toEqual([]);
  });
});

describe('removing an account', () => {
  it('counts the rows that run only here: its own, and provider rows no other account serves', () => {
    const rows = [row({ model: 'a1', slot: 'a' }), row({ model: 'a2', slot: 'a' }), row({ model: 'p', provider: 'claude-code' }), row({ model: 'z', slot: 'zai', provider: 'opencode' }), row({ model: 'o', provider: 'opencode' })];
    expect(usesOnlyCount({ id: 'a', provider: 'claude-code' }, slots, rows)).toBe(3);
    // opencode has two accounts: its provider row survives the removal of one
    expect(usesOnlyCount({ id: 'zai', provider: 'opencode' }, slots, rows)).toBe(1);
  });

  it('asks in words, with the models that go along', () => {
    expect(removeAsk('Claude B', 0, i18n)).toBe('Remove Claude B?');
    expect(removeAsk('Claude B', 1, i18n)).toBe('Remove Claude B? 1 model uses only this account.');
    expect(removeAsk('Claude B', 3, i18n)).toBe('Remove Claude B? 3 models use only this account.');
  });

  it('sends the models with the account only when some run only on it', () => {
    expect(removePayload('b', 1)).toEqual({ id: 'b', withModels: true });
    expect(removePayload('b', 0)).toEqual({ id: 'b' });
  });
});

describe('adding an account', () => {
  const draft = { label: 'Claude C', provider: 'claude-code' as const, kind: 'subscription' as const, amount: '90', sessions: 1 };

  it('makes the entry slotAdd takes: id from the label, billing in euro', () => {
    expect(slotEntryOf(draft, slots)).toEqual({
      ok: true,
      entry: { id: 'claude-c', label: 'Claude C', provider: 'claude-code', billing: { kind: 'subscription', pricePerMonth: 90, currency: 'EUR' }, sessions: 1 },
    });
  });

  it('refuses an empty or taken label and an amount that does not read', () => {
    expect(slotEntryOf({ ...draft, label: ' ' }, slots)).toEqual({ ok: false, field: 'label' });
    expect(slotEntryOf({ ...draft, label: 'Zai' }, slots)).toEqual({ ok: false, field: 'label' });
    expect(slotEntryOf({ ...draft, amount: 'x' }, slots)).toEqual({ ok: false, field: 'amount' });
  });
});
