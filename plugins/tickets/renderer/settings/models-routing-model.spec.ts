import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import { ledgerPayload, moneyText, parseMoney, parseRouting, routingPayload, routingSummary, routingViewOf } from './models-routing-model';
import { pool } from './models-fixtures';

describe('the Routing fold', () => {
  it('reads the three values on the folded row', () => {
    expect(routingSummary(pool.routing, i18n)).toBe('step up above q 1.3 · reserve 10 % · burn rate 80 %');
    expect(routingSummary({ ...pool.routing, upgradeAboveQ: null }, i18n)).toBe('never step up · reserve 10 % · burn rate 80 %');
  });

  it('shows the engine values: q as it is, the shares as percent, a q of null as empty', () => {
    expect(routingViewOf(pool.routing, i18n)).toEqual({ upgradeAboveQ: '1.3', reservePerWindow: '10', burnRate: '80' });
    expect(routingViewOf({ ...pool.routing, upgradeAboveQ: null }, i18n).upgradeAboveQ).toBe('');
  });

  it('checks typed values like the engine', () => {
    expect(parseRouting('upgradeAboveQ', '1,5')).toEqual({ ok: true, value: 1.5 });
    expect(parseRouting('upgradeAboveQ', '0')).toEqual({ ok: false });
    expect(parseRouting('upgradeAboveQ', '')).toEqual({ ok: true, value: null });
    expect(parseRouting('burnRate', '25 %')).toEqual({ ok: true, value: 0.25 });
    expect(parseRouting('burnRate', '100')).toEqual({ ok: false });
  });

  it('sends the whole routing key with the one field changed', () => {
    expect(routingPayload(pool.routing, 'burnRate', 0.25)).toEqual({ routing: { ...pool.routing, burnRate: 0.25 } });
  });
});

describe('the ledger defaults', () => {
  it('shows an amount as dollars and an empty field as no limit', () => {
    expect(moneyText(2.5, i18n)).toBe('$2.50');
    expect(moneyText(null, i18n)).toBe('');
    expect(parseMoney('$2,50')).toEqual({ ok: true, value: 2.5 });
    expect(parseMoney('')).toEqual({ ok: true, value: null });
    expect(parseMoney('abc')).toEqual({ ok: false });
  });

  it('writes one default and keeps the other two', () => {
    expect(ledgerPayload(pool, 'personaPerDay', 7)).toEqual({ ledgers: { ticketAllowance: 2.5, personaPerDay: 7, providerPerDay: 15 } });
  });
});
