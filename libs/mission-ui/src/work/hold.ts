/**
 * The persona board as Mission Control reads it (req-273, the persona board
 * concept §3, §4, §9, row 12; boards 10c v2, 10e v2, 10o v2, 10u v2). The
 * desk sends the board's holder lanes (`lanes`) and each active ticket's hold
 * (`hold`) on `/api/board` (req-270); this file reads them tolerantly and
 * carries the pure helpers the work list, the ticket screen and the cards
 * share.
 *
 * The helpers below `// --- the engine's helpers` are a local copy of
 * `packages/tickets-engine/src/contracts/persona-board.ts` (the lib imports
 * nothing from the engine, like `team.ts` and `settings/device-list.ts`); the
 * lib's spec runs both against one case table, so the two cannot drift apart.
 * Wording is the catalog's: the helpers return kinds, never sentences.
 */

/** The human persona's id — You's lane. */
export const YOU_LANE = 'you';

/** One holder lane: a persona of the crew, in the crew's order (the engine's BoardLane). */
export interface McLane {
  readonly persona: string;
  readonly title: string;
  readonly kind: 'agent' | 'human' | 'mission';
  /** `#rrggbb`; '' = none. */
  readonly color: string;
  /** The persona's own pool (`parallel:`); null = no cap. */
  readonly parallel: number | null;
  readonly min: number;
}

export type McHoldWhy = 'entry' | 'question' | 'second-send-back' | 'no-persona';

/** One send-back as the ticket records it (`x-sent-back: from>to`). */
export interface McSentBack {
  readonly from: number;
  readonly to: number;
}

/** Who holds an active ticket, and where it is in its chain (the engine's TicketHold). */
export interface McHold {
  readonly holder: string;
  readonly why: McHoldWhy;
  readonly position: number;
  readonly length: number;
  readonly chain: readonly string[];
  readonly mode: 'shape' | null;
  readonly named: string | null;
  readonly claimed: boolean;
  readonly sentBack: McSentBack | null;
  readonly questions: number;
  /** req-78: a red gate sent the ticket here from this later position; absent = none. */
  readonly returnTo?: number;
}

// --- tolerant reads ------------------------------------------------------------

type Rec = Record<string, unknown>;
const rec = (raw: unknown): Rec | null => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Rec) : null);
const text = (raw: unknown): string => (typeof raw === 'string' ? raw : '');
const whole = (raw: unknown): number | null => (typeof raw === 'number' && Number.isInteger(raw) ? raw : null);
const KINDS: readonly McLane['kind'][] = ['agent', 'human', 'mission'];
const WHYS: readonly McHoldWhy[] = ['entry', 'question', 'second-send-back', 'no-persona'];

function laneOf(raw: unknown): McLane | null {
  const lane = rec(raw);
  const persona = text(lane?.['persona']);
  if (lane === null || persona === '') {
    return null;
  }
  const kind = KINDS.find((k) => k === lane['kind']) ?? 'agent';
  const parallel = whole(lane['parallel']);
  return { persona, title: text(lane['title']) || persona, kind, color: text(lane['color']), parallel: parallel !== null && parallel >= 0 ? parallel : null, min: Math.max(0, whole(lane['min']) ?? 0) };
}

/** The board's holder lanes in the crew's order; null = no persona board (the phase board, or nothing read yet). */
export function lanesOf(board: { readonly lanes?: unknown } | null | undefined): readonly McLane[] | null {
  const raw = board?.lanes;
  if (!Array.isArray(raw)) {
    return null;
  }
  return raw.map(laneOf).filter((lane): lane is McLane => lane !== null);
}

function sentBackOf(raw: unknown): McSentBack | null {
  const value = rec(raw);
  const from = whole(value?.['from']);
  const to = whole(value?.['to']);
  return from !== null && to !== null && from >= 1 && to >= 1 ? { from, to } : null;
}

/** A ticket's hold off the wire; null when the card carries none or junk. */
export function holdOf(ticket: { readonly hold?: unknown } | null | undefined): McHold | null {
  const hold = rec(ticket?.hold);
  const holder = text(hold?.['holder']);
  const position = whole(hold?.['position']);
  const length = whole(hold?.['length']);
  if (hold === null || holder === '' || position === null || length === null || position < 1 || length < 1) {
    return null;
  }
  const chain = Array.isArray(hold['chain']) ? hold['chain'].map(text) : [];
  return {
    holder,
    why: WHYS.find((why) => why === hold['why']) ?? 'entry',
    position,
    length,
    chain,
    mode: hold['mode'] === 'shape' ? 'shape' : null,
    named: text(hold['named']) || null,
    claimed: hold['claimed'] === true,
    sentBack: sentBackOf(hold['sentBack']),
    questions: Math.max(0, whole(hold['questions']) ?? 0),
    ...returnToOf(hold['returnTo'], position),
  };
}

/** req-78: the later position a red gate sent the ticket back from; nothing when absent or junk. */
function returnToOf(raw: unknown, position: number): { readonly returnTo?: number } {
  const value = whole(raw);
  return value !== null && value > position ? { returnTo: value } : {};
}

/** A persona id's display name off the lanes; the id itself when no lane names it. */
export function laneTitleOf(lanes: readonly McLane[] | null, persona: string | null): string {
  if (persona === null || persona === '') {
    return '';
  }
  return lanes?.find((lane) => lane.persona === persona)?.title ?? persona;
}

/** The chain's initials as the cards draw them: the persona's first two letters, upper case (`BE`). */
export function initialsOf(title: string): string {
  return title.trim().slice(0, 2).toUpperCase();
}

// --- what the fleet says right now ------------------------------------------------

/** One fleet run as the hold's live half reads it (the `/api/fleet` runs, folded by the app). */
export interface McHoldRun {
  readonly ticketId?: string;
  readonly state?: string | null;
  readonly persona?: string;
  readonly activity?: string | null;
  readonly startedAt?: string;
}

/** The chain block's per-ticket words: who a ticket waits for, and the pool's queue line. */
export interface McChainWaits {
  /** Ticket id → the persona it waits for (its persona runs its maximum). */
  readonly personaWaits: Readonly<Record<string, string>>;
  /** Ticket id → the pool's line (`waits for a B slot`). */
  readonly queued: Readonly<Record<string, string>>;
}

const LIVE_RUN_STATES: readonly string[] = ['starting', 'running', 'stopping', 'detached'];

export function isLiveRun(run: McHoldRun): boolean {
  return run.state !== null && run.state !== undefined && LIVE_RUN_STATES.includes(run.state);
}

/** The live half of a card's status from the runs and the chain block. */
export function holdLiveOf(ticketId: string, runs: readonly McHoldRun[], waits: McChainWaits | null, nowMs: number, held = false): HoldLive {
  const run = runs.find((candidate) => candidate.ticketId === ticketId && isLiveRun(candidate)) ?? null;
  const started = run?.startedAt === undefined ? Number.NaN : Date.parse(run.startedAt);
  return {
    running: run !== null,
    minutes: Number.isFinite(started) ? Math.max(0, Math.round((nowMs - started) / 60_000)) : null,
    activity: run?.activity ?? null,
    queued: waits?.queued[ticketId] ?? null,
    waitsFor: waits?.personaWaits[ticketId] ?? null,
    held,
  };
}

/** The runs live now per holder persona (the group header's `2/2`). */
export function runningByPersonaOf(runs: readonly McHoldRun[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const run of runs) {
    if (isLiveRun(run) && run.persona !== undefined && run.persona !== '') {
      out.set(run.persona, (out.get(run.persona) ?? 0) + 1);
    }
  }
  return out;
}

// --- the engine's helpers (a local copy of contracts/persona-board.ts) -----------------

export type ChainCellState = 'done' | 'now' | 'again' | 'next';

export interface ChainCell {
  readonly position: number;
  readonly persona: string;
  readonly state: ChainCellState;
}

export function chainCellsOf(hold: Pick<McHold, 'chain' | 'position' | 'sentBack'>): readonly ChainCell[] {
  const againTo = hold.sentBack !== null && hold.position <= hold.sentBack.from ? hold.sentBack.from : 0;
  return hold.chain.map((persona, index) => {
    const position = index + 1;
    const state: ChainCellState = position < hold.position ? 'done' : position === hold.position ? 'now' : position <= againTo ? 'again' : 'next';
    return { position, persona, state };
  });
}

export type HoldBadge = 'sent-back-once' | 'sent-back-twice' | 'question' | 'no-persona' | 'accept';

export function holdBadgeOf(hold: McHold): HoldBadge | null {
  switch (hold.why) {
    case 'second-send-back':
      return 'sent-back-twice';
    case 'question':
      return 'question';
    case 'no-persona':
      return 'no-persona';
    default:
      break;
  }
  if (hold.holder === YOU_LANE) {
    return 'accept';
  }
  return hold.sentBack !== null && hold.position <= hold.sentBack.from ? 'sent-back-once' : null;
}

export interface HoldLive {
  readonly running: boolean;
  readonly minutes: number | null;
  readonly activity: string | null;
  readonly queued: string | null;
  readonly waitsFor: string | null;
  readonly held: boolean;
}

export type HoldStatus =
  | { readonly kind: 'running'; readonly minutes: number | null; readonly from: string | null }
  | { readonly kind: 'merging-main' }
  | { readonly kind: 'committing' }
  | { readonly kind: 'queued'; readonly line: string }
  | { readonly kind: 'waits-for'; readonly persona: string }
  | { readonly kind: 'held' }
  | { readonly kind: 'shaping' }
  | { readonly kind: 'mission-turn' }
  | { readonly kind: 'asks'; readonly persona: string | null; readonly questions: number }
  | { readonly kind: 'decide' }
  | { readonly kind: 'no-persona'; readonly position: number }
  | { readonly kind: 'ready' }
  | { readonly kind: 'your-step' }
  | { readonly kind: 'waiting' };

export function holdDotOf(status: HoldStatus): 'run' | 'wait' | 'need' {
  switch (status.kind) {
    case 'running':
    case 'merging-main':
    case 'committing':
      return 'run';
    case 'shaping':
    case 'asks':
    case 'decide':
    case 'no-persona':
    case 'ready':
    case 'your-step':
      return 'need';
    default:
      return 'wait';
  }
}

const MERGING_MAIN = 'merging main';

function ownerStatusOf(hold: McHold): HoldStatus | null {
  switch (hold.why) {
    case 'question':
      return { kind: 'asks', persona: hold.named, questions: hold.questions };
    case 'second-send-back':
      return { kind: 'decide' };
    case 'no-persona':
      return { kind: 'no-persona', position: hold.position };
    default:
      return null;
  }
}

function runStatusOf(hold: McHold, live: HoldLive, human: boolean): HoldStatus {
  if (human) {
    return { kind: 'committing' };
  }
  if ((live.activity ?? '').startsWith(MERGING_MAIN)) {
    return { kind: 'merging-main' };
  }
  // req-78: a red gate's target names the position that went red, else the persona send-back's sender.
  const from =
    hold.returnTo !== undefined
      ? (hold.chain[hold.returnTo - 1] ?? null)
      : hold.sentBack !== null && hold.position === hold.sentBack.to
        ? (hold.chain[hold.sentBack.from - 1] ?? null)
        : null;
  return { kind: 'running', minutes: live.minutes, from };
}

function idleAgentStatusOf(hold: McHold, live: HoldLive): HoldStatus {
  if (hold.mode === 'shape') {
    return { kind: 'shaping' };
  }
  if (live.held) {
    return { kind: 'held' };
  }
  if (live.waitsFor !== null) {
    return { kind: 'waits-for', persona: live.waitsFor };
  }
  return live.queued !== null ? { kind: 'queued', line: live.queued } : { kind: 'waiting' };
}

export function holdStatusOf(hold: McHold, live: HoldLive, kindOf: (persona: string) => McLane['kind'] | null): HoldStatus {
  const owner = ownerStatusOf(hold);
  if (owner !== null) {
    return owner;
  }
  const human = hold.holder === YOU_LANE || kindOf(hold.holder) === 'human';
  if (live.running) {
    return runStatusOf(hold, live, human);
  }
  if (human) {
    return hold.position >= hold.length ? { kind: 'ready' } : { kind: 'your-step' };
  }
  return kindOf(hold.holder) === 'mission' && hold.mode !== 'shape' ? { kind: 'mission-turn' } : idleAgentStatusOf(hold, live);
}

export interface LaneLoad {
  readonly running: number;
  readonly cap: number | null;
  readonly waiting: number;
  readonly atCap: boolean;
}

export function laneLoadOf(lane: McLane, running: number, waiting: number): LaneLoad | null {
  if (lane.kind !== 'agent') {
    return null;
  }
  return { running, cap: lane.parallel, waiting, atCap: lane.parallel !== null && running >= lane.parallel };
}
