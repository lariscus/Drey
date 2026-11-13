/**
 * The pool keys of `service.json` (req-170; machine scope, R13): `classes`
 * (req-287: the owner's class list with its session caps), `models`
 * (the model table, req-178 adds its capability columns, req-287 the
 * router switch `enabled`), `capacity` (the
 * cap), `ledgers` (the defaults) and `routing` (req-178, board 7l; req-181
 * adds its `burnRate`). A
 * row is checked on its own — a broken one is left out with its reason,
 * the others stand — against the slots of req-177: a row names a slot, or
 * a harness provider whose every slot serves it.
 */
import { classNameOf, DEFAULT_ROUTING, isWorkerProvider, WORKER_PROVIDERS, type CapacityConfig, type ClassConfig, type LedgerDefaults, type ModelRow, type PoolSettings, type RoutingSettings } from '../protocol';
import { classesOf, classKeysOf } from './class-config';
import { capabilitiesOf, capabilityKeysOf } from './model-capabilities';
import type { Slot } from './slot';

export interface PoolConfigParse {
  readonly settings: PoolSettings;
  readonly errors: readonly string[];
}

type Entry = Record<string, unknown>;

export const NO_CAPACITY: CapacityConfig = { global: null, perSlot: {} };
export const NO_LEDGERS: LedgerDefaults = { ticketAllowance: null, personaPerDay: null, providerPerDay: null };

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const amount = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/** Where a row runs: its slot (and with it the provider), or a provider's every slot. */
function placeOf(entry: Entry, slots: readonly Slot[]): Pick<ModelRow, 'slot' | 'provider'> | string {
  const slotId = text(entry['slot']);
  if (slotId !== null) {
    const slot = slots.find((s) => s.id === slotId);
    return slot === undefined ? `names slot "${slotId}", which service.json does not define` : { slot: slot.id, provider: slot.provider };
  }
  const provider = entry['provider'];
  return isWorkerProvider(provider) ? { slot: null, provider } : `needs a slot or a provider (${WORKER_PROVIDERS.join(', ')})`;
}

/** A row's cost factor (default 1), or why it does not read. req-287: the row's old `sessions` became its class's cap and is not read. */
function weightOf(entry: Entry, model: string): Pick<ModelRow, 'cost'> | string {
  const cost = entry['cost'] === undefined ? 1 : amount(entry['cost']);
  return cost === null ? `model "${model}": the cost factor must be a number of 0 or more` : { cost };
}

/** One row of `models`, or the reason it is left out. */
export function modelRowOf(raw: unknown, slots: readonly Slot[], seen: readonly ModelRow[], classes: readonly ClassConfig[]): ModelRow | string {
  const entry = (raw !== null && typeof raw === 'object' ? raw : {}) as Entry;
  const model = text(entry['model']);
  if (model === null) {
    return `a model row needs a model id (got ${JSON.stringify(entry['model'] ?? null)})`;
  }
  const place = placeOf(entry, slots);
  if (typeof place === 'string') {
    return `model "${model}" ${place}`;
  }
  const rowClass = classNameOf(entry['class']);
  if (rowClass === null || !classes.some((c) => c.name === rowClass)) {
    return `model "${model}": class must be one of ${classes.map((c) => c.name).join(', ')}`;
  }
  const weight = weightOf(entry, model);
  if (typeof weight === 'string') {
    return weight;
  }
  if (seen.some((row) => row.model === model && row.slot === place.slot && row.provider === place.provider)) {
    return `model "${model}" is named twice for ${place.slot ?? place.provider}`;
  }
  const capabilities = capabilitiesOf(entry, model);
  if (typeof capabilities === 'string') {
    return capabilities;
  }
  return { model, ...place, category: text(entry['category']) ?? '', class: rowClass, ...weight, enabled: entry['enabled'] !== false, ...capabilities };
}

function rowsOf(raw: unknown, slots: readonly Slot[], classes: readonly ClassConfig[], errors: string[]): ModelRow[] {
  const rows: ModelRow[] = [];
  for (const entry of Array.isArray(raw) ? (raw as unknown[]) : []) {
    const row = modelRowOf(entry, slots, rows, classes);
    if (typeof row === 'string') {
      errors.push(row);
    } else {
      rows.push(row);
    }
  }
  return rows;
}

function perSlotOf(raw: unknown, errors: string[]): Record<string, number> {
  const perSlot: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw !== null && typeof raw === 'object' ? raw : {})) {
    const cap = amount(value);
    if (cap === null) {
      errors.push(`capacity.perSlot.${id} must be a number of 0 or more`);
    } else {
      perSlot[id] = cap;
    }
  }
  return perSlot;
}

function capacityOf(raw: unknown, errors: string[]): CapacityConfig {
  const entry = (raw !== null && typeof raw === 'object' ? raw : {}) as Entry;
  const given = entry['global'] ?? null;
  const global = given === null ? null : amount(given);
  if (given !== null && global === null) {
    errors.push('capacity.global must be a number of 0 or more');
  }
  return { global, perSlot: perSlotOf(entry['perSlot'], errors) };
}

function ledgersOf(raw: unknown): LedgerDefaults {
  const entry = (raw !== null && typeof raw === 'object' ? raw : {}) as Entry;
  return { ticketAllowance: amount(entry['ticketAllowance']), personaPerDay: amount(entry['personaPerDay']), providerPerDay: amount(entry['providerPerDay']) };
}

/** req-178: `routing.upgradeAboveQ` (a surplus above 0, or null = never step up) and `routing.reservePerWindow` (a share 0–1). */
function upgradeOf(raw: unknown, errors: string[]): number | null {
  if (raw === undefined) {
    return DEFAULT_ROUTING.upgradeAboveQ;
  }
  if (raw === null || (typeof raw === 'number' && Number.isFinite(raw) && raw > 0)) {
    return raw;
  }
  errors.push('routing.upgradeAboveQ must be a surplus above 0, or null to never step up');
  return DEFAULT_ROUTING.upgradeAboveQ;
}

function reserveOf(raw: unknown, errors: string[]): number {
  if (raw === undefined) {
    return DEFAULT_ROUTING.reservePerWindow;
  }
  if (typeof raw === 'number' && raw >= 0 && raw < 1) {
    return raw;
  }
  errors.push('routing.reservePerWindow must be a share from 0 to below 1 (0.1 = 10 %)');
  return DEFAULT_ROUTING.reservePerWindow;
}

/** req-181: `routing.burnRate`, a share 0–1 of the weekly quota per day over all slots; 0 = off. */
function burnRateOf(raw: unknown, errors: string[]): number {
  if (raw === undefined) {
    return DEFAULT_ROUTING.burnRate;
  }
  if (typeof raw === 'number' && raw >= 0 && raw < 1) {
    return raw;
  }
  errors.push('routing.burnRate must be a share from 0 to below 1 (0.2 = 20 % of the weekly quota per day; 0 = off)');
  return DEFAULT_ROUTING.burnRate;
}

function routingOf(raw: unknown, errors: string[]): RoutingSettings {
  const entry = (raw !== null && typeof raw === 'object' ? raw : {}) as Entry;
  return {
    upgradeAboveQ: upgradeOf(entry['upgradeAboveQ'], errors),
    reservePerWindow: reserveOf(entry['reservePerWindow'], errors),
    burnRate: burnRateOf(entry['burnRate'], errors),
  };
}

/** `service.json`'s parsed root as the pool's settings. */
export function parsePoolSettings(root: unknown, slots: readonly Slot[]): PoolConfigParse {
  const config = (root !== null && typeof root === 'object' && !Array.isArray(root) ? root : {}) as Entry;
  const errors: string[] = [];
  const classes = classesOf(config['classes'], errors);
  const models = rowsOf(config['models'], slots, classes, errors);
  const settings = { classes, models, capacity: capacityOf(config['capacity'], errors), ledgers: ledgersOf(config['ledgers']), routing: routingOf(config['routing'], errors) };
  return { settings, errors };
}

/** The pool keys as `service.json` stores them: a row keeps only what it names. */
export function poolKeysOf(settings: PoolSettings): Record<string, unknown> {
  const models = settings.models.map((row) => ({
    model: row.model,
    ...(row.slot !== null ? { slot: row.slot } : { provider: row.provider }),
    category: row.category,
    class: row.class,
    cost: row.cost,
    ...(row.enabled ? {} : { enabled: false }),
    ...capabilityKeysOf(row),
  }));
  return { classes: classKeysOf(settings.classes), models, capacity: settings.capacity, ledgers: settings.ledgers, routing: settings.routing };
}
