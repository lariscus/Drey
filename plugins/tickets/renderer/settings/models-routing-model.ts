// i18n: catalog
/**
 * Settings → Models, the Routing fold (board 7l v3): the one summary line,
 * the three routing fields (req-178 / req-181) and the three ledger defaults
 * the board no longer draws as a group of their own. The pure half.
 */
import type { LedgerDefaults, ModelsReply, RoutingSettings } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { I18n } from '../../../../shared/i18n/types';
import { invalid, numberOf, trimmedNumber, type Parsed } from './models-model';

export type RoutingKey = keyof RoutingSettings;
export type LedgerKey = keyof LedgerDefaults;

const percentText = (share: number, i18n: I18n): string => i18n.formatNumber(Math.round(share * 1000) / 10, { maximumFractionDigits: 1 });

/** What the Routing fold's three fields show: `1.3` (empty = never), the two shares as percent (`10`, `80`). */
export interface RoutingView {
  readonly upgradeAboveQ: string;
  readonly reservePerWindow: string;
  readonly burnRate: string;
}

export function routingViewOf(routing: RoutingSettings, i18n: I18n): RoutingView {
  return {
    upgradeAboveQ: routing.upgradeAboveQ === null ? '' : trimmedNumber(i18n, routing.upgradeAboveQ),
    reservePerWindow: percentText(routing.reservePerWindow, i18n),
    burnRate: percentText(routing.burnRate, i18n),
  };
}

/** The folded row: `step up above q 1.3 · reserve 10 % · burn rate 80 %`. */
export function routingSummary(routing: RoutingSettings, i18n: I18n): string {
  const view = routingViewOf(routing, i18n);
  return [
    routing.upgradeAboveQ === null ? i18n.t('tickets.settings.models.routing.sum_no_step') : i18n.t('tickets.settings.models.routing.sum_step', { q: view.upgradeAboveQ }),
    i18n.t('tickets.settings.models.routing.sum_reserve', { share: view.reservePerWindow }),
    i18n.t('tickets.settings.models.routing.sum_burn', { share: view.burnRate }),
  ].join(' · ');
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

export function parseRouting(key: RoutingKey, text: string): Parsed<number | null> {
  return key === 'upgradeAboveQ' ? parseUpgrade(text) : parsePercentShare(text);
}

/** What `poolModelsConfig` takes for one changed field: the whole `routing` key, the others as the engine has them. */
export function routingPayload(routing: RoutingSettings, key: RoutingKey, value: number | null): { routing: RoutingSettings } {
  return { routing: { ...routing, [key]: value } };
}

/** A dollar amount (`$2.50`, `2.5`); empty = no limit. */
export function parseMoney(text: string): Parsed<number | null> {
  const value = numberOf(text.replace(/[$\s]/g, ''));
  return value === 'invalid' ? invalid : { ok: true, value };
}

export function moneyText(value: number | null, i18n: I18n): string {
  return value === null ? '' : i18n.formatCurrency(value);
}

export function ledgerPayload(reply: ModelsReply, key: LedgerKey, value: number | null): { ledgers: LedgerDefaults } {
  return { ledgers: { ...reply.ledgers, [key]: value } };
}
