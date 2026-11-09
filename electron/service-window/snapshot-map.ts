/**
 * The service's, the runner's and the engine's answers as the window's
 * contract shapes them (req-165/166). Pure: tolerant of absent fields, so an
 * older service still draws.
 */
import type {
  ComponentState,
  LoadFacts,
  LogLevel,
  LogLine,
  ServiceSnapshot,
  SessionRun,
  SlotFacts,
  StreamEvent,
} from '../../shared/service-window/contract';

type Json = Record<string, unknown>;

const STATES: ReadonlySet<string> = new Set(['starting', 'running', 'sleeping', 'stopped', 'failed', 'external']);
const LIVE: ReadonlySet<string> = new Set(['starting', 'running', 'stopping']);

const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const stateOf = (record: Json): ComponentState => (STATES.has(String(record['state'])) ? (record['state'] as ComponentState) : 'stopped');
const baseName = (p: string): string => p.split(/[\\/]/).filter((s) => s !== '').pop() ?? p;

export const DEFAULT_LOAD: LoadFacts = { heavySeats: 2, reserve: 25, lowPriority: true, quietHours: '' };

export function loadOf(settings: Json): LoadFacts {
  return {
    heavySeats: num(settings['heavySeats']) ?? DEFAULT_LOAD.heavySeats,
    reserve: num(settings['reserve']) ?? DEFAULT_LOAD.reserve,
    lowPriority: typeof settings['lowPriority'] === 'boolean' ? settings['lowPriority'] : DEFAULT_LOAD.lowPriority,
    quietHours: str(settings['quietHours']) ?? '',
  };
}

/** The component rows of `GET /status` (the local model is added by the probe). */
export function componentsOf(status: Json, liveRuns: number): Omit<ServiceSnapshot['components'], 'model'> {
  const components = obj(status['components']);
  const engine = obj(components['engine']);
  const runner = obj(components['runner']);
  const gateway = obj(components['gateway']);
  const gatewayState = stateOf(gateway);
  const enginePort = num(engine['port']);
  const vault = str(status['vaultPath']);
  return {
    engine: { state: stateOf(engine), address: enginePort === null ? null : `127.0.0.1:${enginePort}`, vaultName: vault === null ? null : baseName(vault) },
    runner: { state: stateOf(runner), reason: stateOf(runner) === 'failed' ? str(runner['detail']) : null, liveRuns },
    mcp: { state: stateOf(obj(components['mcp'])), detail: null },
    gateway: {
      state: gatewayState,
      address: gatewayState === 'running' ? (str(gateway['detail'])?.split(' · ')[0] ?? null) : null,
      devices: gatewayState === 'running' ? Number(/(\d+) paired/.exec(String(gateway['detail']))?.[1] ?? 0) : 0,
      reason: gatewayState === 'failed' ? str(gateway['detail']) : null,
    },
  };
}

/** One slot of `GET /slots`: the tightest window drawn, its reliability the chip. */
export function slotFactsOf(view: Json): SlotFacts {
  const windows = Array.isArray(view['windows']) ? (view['windows'] as unknown[]).map(obj) : [];
  const known = windows.filter((w) => num(w['remaining']) !== null);
  const tightest = known.sort((a, b) => num(a['remaining'])! - num(b['remaining'])!)[0] ?? null;
  const busy = num(view['busy']) ?? 0;
  const reliability = String(tightest?.['reliability'] ?? windows[0]?.['reliability'] ?? 'unknown');
  return {
    id: String(view['id'] ?? ''),
    label: String(view['label'] ?? view['id'] ?? ''),
    busy,
    total: num(view['total']) ?? Math.max(busy, 1),
    left: tightest === null ? null : num(tightest['remaining']),
    q: num(view['q']),
    resetsAt: tightest === null ? null : str(tightest['resetsAt']),
    reliability: reliability === 'measured' || reliability === 'estimated' ? reliability : 'unknown',
  };
}

/** Today's spend against the provider ledgers (`GET /models` `providerDay`). */
export function spendOf(models: Json | null): ServiceSnapshot['spend'] {
  if (models === null || !Array.isArray(models['providerDay'])) {
    return null;
  }
  const figures = (models['providerDay'] as unknown[]).map(obj);
  const spent = figures.reduce((sum, f) => sum + (num(f['spent']) ?? 0), 0);
  const limits = figures.map((f) => num(f['limit']));
  const limit = limits.length > 0 && limits.every((l) => l !== null) ? limits.reduce<number>((sum, l) => sum + l!, 0) : null;
  return { spent, limit };
}

export function isLive(run: Json): boolean {
  return LIVE.has(String(run['state']));
}

/** A runner `RunInfo` as the Sessions tab needs it. */
export function sessionRunOf(info: Json): SessionRun {
  const slot = obj(info['slot']);
  const grant = obj(info['grant']);
  return {
    id: String(info['id'] ?? ''),
    ticketId: String(info['ticketId'] ?? ''),
    persona: str(info['persona']),
    provider: String(info['provider'] ?? ''),
    model: str(grant['model']) ?? str(info['model']),
    phase: str(info['phase']),
    state: (str(info['state']) ?? 'failed') as SessionRun['state'],
    pid: num(info['pid']),
    startedAt: String(info['startedAt'] ?? ''),
    endedAt: str(info['endedAt']),
    lastActivity: String(info['lastActivity'] ?? info['startedAt'] ?? ''),
    sessionRef: str(info['sessionRef']),
    tokensIn: num(info['tokensIn']) ?? 0,
    cacheReadTokens: num(info['cacheReadTokens']) ?? 0,
    tokensOut: num(info['tokensOut']) ?? 0,
    costUsd: num(info['costUsd']),
    turn: info['turn'] === 'busy' || info['turn'] === 'idle' ? info['turn'] : null,
    turns: num(info['turns']),
    held: info['held'] === true,
    interactive: info['interactive'] !== undefined && info['interactive'] !== null && info['interactive'] !== false,
    origin: str(info['origin']),
    handoverMode: str(info['handoverMode']),
    worktreePath: String(info['worktreePath'] ?? ''),
    slot: str(slot['id']) === null ? null : { id: String(slot['id']), label: String(slot['label'] ?? slot['id']) },
    grantClass: str(grant['class']),
    permission: str(info['permissionMode']),
  };
}

/** The live runs plus today's ended ones, newest first. */
export function sessionsOf(runs: readonly Json[], now: Date): readonly SessionRun[] {
  const today = now.toDateString();
  return runs
    .filter((run) => isLive(run) || (str(run['endedAt']) !== null && new Date(String(run['endedAt'])).toDateString() === today))
    .map(sessionRunOf)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** A run's `stream.jsonl` text, line by line; broken lines are skipped. */
export function streamEventsOf(text: string): readonly StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const line of text.split('\n')) {
    try {
      const parsed = JSON.parse(line) as StreamEvent;
      if (typeof parsed === 'object' && parsed !== null && typeof parsed.kind === 'string') {
        events.push(parsed);
      }
    } catch {
      // the tail's first line may be cut
    }
  }
  return events;
}

const LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error']);

/** One service log line (`<ISO> <level> <component> <message>`); null for anything else. */
export function logLineOf(line: string): LogLine | null {
  const match = /^(\S+)\s+(\S+)\s+(\S+)\s(.*)$/.exec(line.trimEnd());
  if (match === null || !LEVELS.has(match[2]!) || Number.isNaN(Date.parse(match[1]!))) {
    return null;
  }
  return { at: match[1]!, level: match[2] as LogLevel, component: match[3]!, message: match[4]!.trimStart() };
}
