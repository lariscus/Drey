// i18n: catalog
/**
 * Settings → Tickets → Models (board 7l v3, req-286/287): the pure half of
 * the harness rows, the class groups and the new-model cards. What the page
 * says is read from the engine's two answers — `poolModels` (the classes, the
 * model table, the caps, the live load, what the harnesses found) and `slots`
 * (the accounts) — and what an edit sends back is built here. DOM-free, so
 * the page and its specs share it. The accounts' half is `models-accounts-model.ts`,
 * the routing fold's `models-routing-model.ts`.
 */
import type {
  CapabilityClass,
  ClassConfig,
  DiscoveredModel,
  DiscoveryReport,
  HarnessReport,
  ModelRow,
  ModelsReply,
  SlotView,
  WorkerProviderId,
} from '../../../../packages/tickets-engine/src/fleet/protocol';
import { classNameOf } from '../../../../packages/tickets-engine/src/contracts/capability-class';
import type { I18n } from '../../../../shared/i18n/types';
import { RUNNER_LABEL } from './workers.ts/settings-workers';

export const trimmedNumber = (i18n: I18n, value: number): string => i18n.formatNumber(value, { maximumFractionDigits: 2 });

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

export const invalid = { ok: false } as const;

/** A decimal typed in a field (`0.4`, `2,5`); empty = nothing. */
export function numberOf(text: string): number | null | 'invalid' {
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

/** A stepper's next value: `−` at 1 lifts the cap (null), `+` on no cap starts at 1. */
export function stepOf(value: number | null, delta: 1 | -1): number | null {
  if (value === null) {
    return delta === 1 ? 1 : null;
  }
  return value + delta < 1 ? null : value + delta;
}

// --- the harnesses -----------------------------------------------------------

export function harnessLabelOf(provider: WorkerProviderId, harnesses: readonly HarnessReport[]): string {
  return harnesses.find((h) => h.provider === provider)?.label ?? RUNNER_LABEL[provider];
}

export interface HarnessView {
  readonly provider: WorkerProviderId;
  readonly label: string;
  readonly version: string;
  /** The model providers it is set up for, else its sign-in state. */
  readonly state: string;
  readonly models: string;
  readonly installed: boolean;
  /** The failed probe's own words; '' = none. */
  readonly error: string;
}

const STATE_KEY: Readonly<Record<HarnessReport['state'], string>> = {
  'signed-in': 'tickets.settings.models.harness.signed_in',
  'signed-out': 'tickets.settings.models.harness.signed_out',
  'not-installed': 'tickets.settings.models.harness.not_installed',
  failed: 'tickets.settings.models.harness.failed',
};

export function harnessViewsOf(discovery: DiscoveryReport, i18n: I18n): readonly HarnessView[] {
  return discovery.harnesses.map((harness) => ({
    provider: harness.provider,
    label: harness.label,
    version: harness.version ?? '',
    state: harness.providers.length > 0 && harness.state !== 'not-installed' ? harness.providers.join(', ') : i18n.lookup(STATE_KEY[harness.state]),
    models: i18n.t('tickets.settings.models.harness.models', { count: harness.models }),
    installed: harness.state !== 'not-installed',
    error: harness.error ?? '',
  }));
}

/** The title's `Checked 2 min ago`; while a probe runs, `Checking…`. */
export function checkedWords(discovery: DiscoveryReport, now: Date, i18n: I18n): string {
  if (discovery.running) {
    return i18n.t('tickets.settings.models.checking');
  }
  const at = discovery.checkedAt === null ? Number.NaN : Date.parse(discovery.checkedAt);
  if (Number.isNaN(at)) {
    return i18n.t('tickets.settings.models.checked_never');
  }
  const minutes = Math.max(0, Math.floor((now.getTime() - at) / 60_000));
  if (minutes < 1) {
    return i18n.t('tickets.settings.models.checked_now');
  }
  if (minutes < 60) {
    return i18n.t('tickets.settings.models.checked_minutes', { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? i18n.t('tickets.settings.models.checked_hours', { n: hours }) : i18n.t('tickets.settings.models.checked_days', { n: Math.floor(hours / 24) });
}

// --- accounts a model runs on --------------------------------------------------

export function providerLabelOf(row: Pick<ModelRow, 'slot' | 'provider'>, slots: readonly SlotView[]): string {
  if (row.slot !== null) {
    return slots.find((slot) => slot.id === row.slot)?.label ?? row.slot;
  }
  return RUNNER_LABEL[row.provider];
}

/** `Claude Code · Claude A`: the harness and the account — a provider row names its one account, or `2 accounts`. */
export function chipOf(place: Pick<ModelRow, 'slot' | 'provider'>, slots: readonly SlotView[], harnesses: readonly HarnessReport[], i18n: I18n): string {
  const harness = harnessLabelOf(place.provider, harnesses);
  const serving = slots.filter((slot) => slot.provider === place.provider);
  if (place.slot === null && serving.length === 0) {
    return harness;
  }
  const account = place.slot !== null ? providerLabelOf(place, slots) : serving.length === 1 ? serving[0]!.label : i18n.t('tickets.settings.models.accounts_count', { count: serving.length });
  return i18n.t('tickets.settings.models.chip', { harness, account });
}

/** The context window as `1M`, `256k`; '' when the model declares none. */
export function contextWords(tokens: number | undefined, i18n: I18n): string {
  if (tokens === undefined || tokens <= 0) {
    return '';
  }
  return tokens >= 1_000_000
    ? i18n.t('tickets.settings.models.context_m', { n: trimmedNumber(i18n, Math.round(tokens / 100_000) / 10) })
    : i18n.t('tickets.settings.models.context_k', { n: i18n.formatNumber(Math.max(1, Math.round(tokens / 1000))) });
}

// --- the class groups -----------------------------------------------------------

export interface ClassRowView {
  /** The row's place in `reply.models` — the list a write sends whole. */
  readonly index: number;
  readonly row: ModelRow;
  readonly chip: string;
  readonly tools: boolean;
  readonly image: boolean;
  readonly context: string;
  readonly cost: string;
}

export interface ClassGroupView {
  readonly name: CapabilityClass;
  readonly sessions: number | null;
  readonly count: string;
  readonly busy: string;
  readonly rows: readonly ClassRowView[];
}

export function classGroupsOf(reply: ModelsReply, slots: readonly SlotView[], i18n: I18n): readonly ClassGroupView[] {
  const harnesses = reply.discovery.harnesses;
  const named = reply.classes.map((c) => c.name);
  // A row whose class the list lacks still shows — after the listed ones, at no cap.
  const extra = [...new Set(reply.models.map((row) => row.class))].filter((name) => !named.includes(name));
  const classes: readonly ClassConfig[] = [...reply.classes, ...extra.map((name): ClassConfig => ({ name, sessions: null }))];
  return classes.map((cls) => {
    const rows = reply.models
      .map((row, index): ClassRowView => ({
        index,
        row,
        chip: chipOf(row, slots, harnesses, i18n),
        tools: row.tools === true,
        image: row.input?.includes('image') === true,
        context: contextWords(row.context, i18n),
        cost: i18n.t('tickets.settings.models.cost_factor', { n: trimmedNumber(i18n, row.cost) }),
      }))
      .filter((view) => view.row.class === cls.name);
    const load = reply.now.classes.find((entry) => entry.name === cls.name);
    return {
      name: cls.name,
      sessions: cls.sessions,
      count: i18n.t('tickets.settings.models.class_models', { count: rows.length }),
      busy: i18n.t(load?.cap === null || load === undefined ? 'tickets.settings.models.busy_open' : 'tickets.settings.models.busy', { busy: load?.busy ?? 0, cap: load?.cap ?? 0 }),
      rows,
    };
  });
}

// --- the new-model cards --------------------------------------------------------

export interface FoundCardView {
  readonly key: string;
  readonly provider: WorkerProviderId;
  readonly model: string;
  readonly chip: string;
  readonly suggested: CapabilityClass;
}

export function foundCardsOf(reply: ModelsReply, slots: readonly SlotView[], i18n: I18n): readonly FoundCardView[] {
  return reply.discovery.found.map((found: DiscoveredModel) => ({
    key: `${found.provider}:${found.model}`,
    provider: found.provider,
    model: found.model,
    chip: chipOf(found, slots, reply.discovery.harnesses, i18n),
    suggested: found.suggested,
  }));
}

// --- what a write sends -----------------------------------------------------------

/** One row as `poolModelsConfig` takes it: the stored keys, the declared capabilities kept as they are. */
export function storedRowOf(row: ModelRow): Record<string, unknown> {
  return {
    model: row.model,
    ...(row.slot !== null ? { slot: row.slot } : { provider: row.provider }),
    category: row.category,
    class: row.class,
    cost: row.cost,
    ...(row.enabled ? {} : { enabled: false }),
    ...(row.input !== undefined ? { input: row.input } : {}),
    ...(row.tools !== undefined ? { tools: row.tools } : {}),
    ...(row.context !== undefined ? { context: row.context } : {}),
    ...(row.output !== undefined ? { output: row.output } : {}),
  };
}

/** The whole table with one row changed — what every row edit and a move write. */
export function modelsPayload(rows: readonly ModelRow[], index: number, change: Partial<Pick<ModelRow, 'class' | 'cost' | 'enabled'>>): { models: readonly Record<string, unknown>[] } {
  return { models: rows.map((row, i) => storedRowOf(i === index ? { ...row, ...change } : row)) };
}

export function classesPayload(classes: readonly ClassConfig[]): { classes: readonly ClassConfig[] } {
  return { classes: classes.map((c) => ({ name: c.name, sessions: c.sessions })) };
}

/** The class list with one class's cap changed. */
export function classSessionsPayload(classes: readonly ClassConfig[], name: CapabilityClass, sessions: number | null): { classes: readonly ClassConfig[] } {
  return classesPayload(classes.map((c) => (c.name === name ? { ...c, sessions } : c)));
}

export function capacityPayload(reply: ModelsReply, global: number | null): { capacity: { global: number | null; perSlot: Readonly<Record<string, number>> } } {
  return { capacity: { global, perSlot: reply.capacity.perSlot } };
}

/** The class list with a new class put above `before` (a class name), else last; the refusal's key when the name does not read or exists. */
export function classAdded(
  classes: readonly ClassConfig[],
  typed: string,
  before: CapabilityClass | null,
): { readonly ok: true; readonly classes: readonly ClassConfig[] } | { readonly ok: false; readonly error: 'name' | 'taken' } {
  const name = classNameOf(typed);
  if (name === null) {
    return { ok: false, error: 'name' };
  }
  if (classes.some((c) => c.name === name)) {
    return { ok: false, error: 'taken' };
  }
  const entry: ClassConfig = { name, sessions: null };
  const at = before === null ? -1 : classes.findIndex((c) => c.name === before);
  return { ok: true, classes: at < 0 ? [...classes, entry] : [...classes.slice(0, at), entry, ...classes.slice(at)] };
}

/** The class list without an empty class; unchanged when models still sit in it. */
export function classRemoved(classes: readonly ClassConfig[], rows: readonly ModelRow[], name: CapabilityClass): readonly ClassConfig[] {
  return rows.some((row) => row.class === name) ? classes : classes.filter((c) => c.name !== name);
}

// --- the Runners line of the desk ----------------------------------------------

/** `Claude A 2 · z.ai 3`: the slots and the sessions each serves. */
export function slotSessionsLine(slots: readonly SlotView[], i18n: I18n): string {
  if (slots.length === 0) {
    return i18n.t('tickets.settings.models.runners_none');
  }
  return slots.map((slot) => (slot.total === null ? slot.label : `${slot.label} ${i18n.formatNumber(slot.total)}`)).join(' · ');
}
