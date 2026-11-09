/**
 * The tranche on every client (req-179, boards 10t and 10u): the tolerant
 * reading of the chain status's `tranche` block, the Autopilot popover's
 * chips and progress, and the one card model the desktop Mission Control
 * card and the phone / iPad card both draw — so every device says the same
 * words from the catalog. The engine half is
 * `packages/tickets-engine/src/fleet/orchestrate/tranche/`.
 */
import type { MessageKey } from './i18n';

export type AnomalyRuleView = 'gate_rate' | 'same_ticket' | 'change_growth' | 'cost_outlier';

export interface RedTicketView {
  readonly ticket: string;
  readonly phase: string | null;
  readonly persona: string | null;
  readonly red: number;
}

export interface EarlyStopView {
  readonly rule: AnomalyRuleView;
  readonly red: number;
  readonly window: number;
  readonly runsLeft: number | null;
  readonly ticket: string | null;
  readonly value: number | null;
  readonly median: number | null;
  readonly tickets: readonly RedTicketView[];
}

export interface CheckpointView {
  readonly kind: 'end' | 'early';
  readonly at: string;
  readonly runs: number;
  readonly spent: number;
  readonly minutes: number;
  readonly gates: { readonly green: number; readonly total: number };
  readonly change: { readonly added: number; readonly removed: number } | null;
  readonly cost: { readonly median: number; readonly max: number } | null;
  readonly repeated: { readonly ticket: string; readonly runs: number } | null;
  readonly earlyStop: EarlyStopView | null;
}

/** The chain status's `tranche` (`TrancheStatus`), as a client reads it. */
export interface TrancheView {
  readonly index: number;
  readonly of: number | null;
  readonly done: number;
  readonly total: number | null;
  readonly spent: number;
  readonly budget: number | null;
  readonly startedAt: string;
  readonly endsAt: string | null;
  readonly checkpoint: 'waiting' | null;
  readonly report: CheckpointView | null;
}

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => (typeof value === 'object' && value !== null ? (value as Rec) : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const RULES: readonly AnomalyRuleView[] = ['gate_rate', 'same_ticket', 'change_growth', 'cost_outlier'];

function earlyStopOf(value: unknown): EarlyStopView | null {
  const raw = rec(value);
  const rule = RULES.find((r) => r === raw?.['rule']);
  if (raw === null || rule === undefined) {
    return null;
  }
  const tickets = (Array.isArray(raw['tickets']) ? raw['tickets'] : []).flatMap((row): RedTicketView[] => {
    const r = rec(row);
    const ticket = text(r?.['ticket']);
    return r === null || ticket === null ? [] : [{ ticket, phase: text(r['phase']), persona: text(r['persona']), red: num(r['red']) ?? 0 }];
  });
  return { rule, red: num(raw['red']) ?? 0, window: num(raw['window']) ?? 0, runsLeft: num(raw['runsLeft']), ticket: text(raw['ticket']), value: num(raw['value']), median: num(raw['median']), tickets };
}

function pairOf<K extends string>(value: unknown, a: K, b: K): Record<K, number> | null {
  const raw = rec(value);
  const x = num(raw?.[a]);
  const y = num(raw?.[b]);
  return x === null || y === null ? null : ({ [a]: x, [b]: y } as Record<K, number>);
}

function reportOf(value: unknown): CheckpointView | null {
  const raw = rec(value);
  const at = text(raw?.['at']);
  if (raw === null || at === null || (raw['kind'] !== 'end' && raw['kind'] !== 'early')) {
    return null;
  }
  const repeated = rec(raw['repeated']);
  const ticket = text(repeated?.['ticket']);
  return {
    kind: raw['kind'],
    at,
    runs: num(raw['runs']) ?? 0,
    spent: num(raw['spent']) ?? 0,
    minutes: num(raw['minutes']) ?? 0,
    gates: pairOf(raw['gates'], 'green', 'total') ?? { green: 0, total: 0 },
    change: pairOf(raw['change'], 'added', 'removed'),
    cost: pairOf(raw['cost'], 'median', 'max'),
    repeated: ticket === null ? null : { ticket, runs: num(repeated?.['runs']) ?? 2 },
    earlyStop: earlyStopOf(raw['earlyStop']),
  };
}

/** The tranche off a chain block (`ChainStatus.tranche`); null when the runner reports none (an older one, tranches off). */
export function trancheViewOf(chain: unknown): TrancheView | null {
  const raw = rec(rec(chain)?.['tranche']);
  const index = num(raw?.['index']);
  const startedAt = text(raw?.['startedAt']);
  if (raw === null || index === null || startedAt === null) {
    return null;
  }
  const report = reportOf(raw['report']);
  return {
    index,
    of: num(raw['of']),
    done: num(raw['done']) ?? 0,
    total: num(raw['total']),
    spent: num(raw['spent']) ?? 0,
    budget: num(raw['budget']),
    startedAt,
    endsAt: text(raw['endsAt']),
    checkpoint: raw['checkpoint'] === 'waiting' ? 'waiting' : null,
    report: raw['checkpoint'] === 'waiting' ? report : null,
  };
}

/** The catalog's lookup, the money format and (optionally) a persona's display name. */
export interface TrancheFormat {
  readonly t: (key: MessageKey, params?: Record<string, string | number>) => string;
  /** Dollars as the surface writes them (`$0.41`, `$15`). */
  readonly money: (usd: number) => string;
  readonly personaName?: (id: string) => string;
}

/** `2 h 10 min`, `45 min` (board 10t's words, not `Intl`'s `2 hr`). */
export function spanText(ms: number, t: TrancheFormat['t']): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? t('autopilot.span.h_min', { h, m }) : t('autopilot.span.min', { m });
}

/** The time left in the tranche's span; null without one. */
export function trancheMsLeftOf(view: TrancheView, now: Date): number | null {
  return view.endsAt === null ? null : Math.max(0, Date.parse(view.endsAt) - now.getTime());
}

/** How far the tranche is (0–1): the limit nearest its end — runs, spend or time. */
export function trancheProgressOf(view: TrancheView, now: Date): number {
  const shares: number[] = [];
  if (view.total !== null && view.total > 0) {
    shares.push(view.done / view.total);
  }
  if (view.budget !== null && view.budget > 0) {
    shares.push(view.spent / view.budget);
  }
  if (view.endsAt !== null) {
    const span = Date.parse(view.endsAt) - Date.parse(view.startedAt);
    shares.push(span > 0 ? (now.getTime() - Date.parse(view.startedAt)) / span : 1);
  }
  return Math.min(1, Math.max(0, ...shares, 0));
}

/** The popover's On chips (board 10t): `Tranche 4 of 10 runs` and `2 h 10 min left`; each null when it has nothing to say. */
export function trancheChipsOf(view: TrancheView, now: Date, t: TrancheFormat['t']): { readonly runs: string; readonly left: string | null } {
  const runs = view.total === null ? t('autopilot.tranche_open', { index: view.index, done: view.done }) : t('autopilot.tranche', { done: view.done, total: view.total });
  const ms = trancheMsLeftOf(view, now);
  return { runs, left: ms === null ? null : t('autopilot.tranche_left', { span: spanText(ms, t) }) };
}

export type TrancheCardActionId = 'release' | 'adjust' | 'open_report' | 'release_anyway';

export interface TrancheCardMetric {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  /** The sub sits on the value's line (`7 of 8 green`), else under it (`median lines`). */
  readonly inline: boolean;
}

/** The Lead's card of a checkpoint or an early stop (board 10u parts 1 and 6, 7 on the phone). */
export interface TrancheCard {
  /** Stable per checkpoint: `tranche-<index>-<at>`. */
  readonly id: string;
  readonly kind: 'checkpoint' | 'early';
  /** Peach for a checkpoint, red for an early stop. */
  readonly tone: 'attention' | 'negative';
  readonly title: string;
  readonly body: string | null;
  readonly metrics: readonly TrancheCardMetric[];
  /** The red tickets of an early stop: `T-0119 · build · Ben · red twice`. */
  readonly rows: readonly string[];
  /** `Autopilot paused · 10 runs · $4.10 · 2 h 10 min` (the checkpoint card only). */
  readonly summary: string | null;
  /** ISO instant the checkpoint was raised (the card's meta line). */
  readonly at: string;
  readonly actions: readonly { readonly id: TrancheCardActionId; readonly label: string; readonly primary: boolean }[];
}

function metricsOf(report: CheckpointView, f: TrancheFormat): TrancheCardMetric[] {
  const { t } = f;
  return [
    { label: t('checkpoint.gate_rate'), value: t('checkpoint.gate_rate.value', { green: report.gates.green, total: report.gates.total }), sub: t('checkpoint.gate_rate.sub'), inline: true },
    report.change === null
      ? { label: t('checkpoint.change_size'), value: t('checkpoint.unknown'), sub: '', inline: false }
      : { label: t('checkpoint.change_size'), value: t('checkpoint.change_size.value', { added: report.change.added, removed: report.change.removed }), sub: t('checkpoint.change_size.sub'), inline: false },
    report.cost === null
      ? { label: t('checkpoint.cost_per_run'), value: t('checkpoint.unknown'), sub: '', inline: false }
      : { label: t('checkpoint.cost_per_run'), value: f.money(report.cost.median), sub: t('checkpoint.cost_per_run.sub', { max: f.money(report.cost.max) }), inline: false },
    report.repeated === null
      ? { label: t('checkpoint.repeated'), value: t('checkpoint.none'), sub: '', inline: true }
      : { label: t('checkpoint.repeated'), value: report.repeated.ticket, sub: t('checkpoint.repeated.sub', { runs: report.repeated.runs }), inline: true },
  ];
}

function earlyBodyOf(stop: EarlyStopView, f: TrancheFormat): string {
  const figure = (value: number | null): string | number => (stop.rule === 'cost_outlier' ? f.money(value ?? 0) : Math.round(value ?? 0));
  const params = { red: stop.red, window: stop.window, ticket: stop.ticket ?? '', value: figure(stop.value), median: figure(stop.median) };
  const key = `checkpoint.early.body.${stop.rule}${stop.runsLeft === null ? '_open' : ''}` as MessageKey;
  return f.t(key, stop.runsLeft === null ? params : { ...params, left: stop.runsLeft });
}

function rowOf(row: RedTicketView, f: TrancheFormat): string {
  const persona = row.persona === null ? null : (f.personaName?.(row.persona) ?? row.persona);
  const red = row.red >= 2 ? f.t('checkpoint.early.red_times', { red: row.red }) : null;
  return [row.ticket, row.phase, persona, red].filter((part): part is string => part !== null && part !== '').join(' · ');
}

/**
 * The card of a waiting checkpoint; null while none waits. `withReport`
 * adds the metric grid to an early stop's card (its "Open report").
 */
export function trancheCardOf(view: TrancheView, f: TrancheFormat, withReport = false): TrancheCard | null {
  const report = view.report;
  if (view.checkpoint !== 'waiting' || report === null) {
    return null;
  }
  const id = `tranche-${view.index}-${report.at}`;
  const stop = report.kind === 'early' ? report.earlyStop : null;
  if (stop === null) {
    return {
      id,
      kind: 'checkpoint',
      tone: 'attention',
      title: view.of === null ? f.t('checkpoint.title_open', { index: view.index }) : f.t('checkpoint.title', { index: view.index, of: view.of }),
      body: null,
      metrics: metricsOf(report, f),
      rows: [],
      summary: f.t('checkpoint.summary', { runs: report.runs, spent: f.money(report.spent), span: spanText(report.minutes * 60_000, f.t) }),
      at: report.at,
      actions: [
        { id: 'release', label: f.t('autopilot.release_next'), primary: true },
        { id: 'adjust', label: f.t('autopilot.adjust'), primary: false },
      ],
    };
  }
  return {
    id,
    kind: 'early',
    tone: 'negative',
    title: f.t(`checkpoint.early.title.${stop.rule}` as MessageKey),
    body: earlyBodyOf(stop, f),
    metrics: withReport ? metricsOf(report, f) : [],
    rows: stop.tickets.map((row) => rowOf(row, f)),
    summary: null,
    at: report.at,
    actions: [
      { id: 'open_report', label: f.t('checkpoint.open_report'), primary: true },
      { id: 'release_anyway', label: f.t('checkpoint.release_anyway'), primary: false },
    ],
  };
}
