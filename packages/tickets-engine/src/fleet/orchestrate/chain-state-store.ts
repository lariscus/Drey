import { autopilotAtBoot, autopilotOfMaster, restoreAutopilot } from '../autopilot';
import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import type { ChainTrip, ColumnMode } from '../protocol';
import type { ChainFile, ChainState, OwnerHold, TicketFailure } from './chain-state';
import { restoreTranche } from './tranche/tranche-record';

const CHAIN_FILE = 'chain.json';

/** How fresh a retiring runner's handover stamp must be for its successor to keep the master. */
export const HANDOVER_MASTER_MS = 5 * 60_000;

const isStamp = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isCount = (value: unknown): value is number => typeof value === 'number' && value >= 0;
const isText = (value: unknown): value is string => typeof value === 'string';
const isMode = (value: unknown): value is ColumnMode => value === 'playing' || value === 'held';
const isFailure = (value: unknown): value is TicketFailure => typeof (value as TicketFailure | null)?.count === 'number' && typeof (value as TicketFailure).until === 'string';
const isHold = (value: unknown): value is OwnerHold => typeof (value as OwnerHold | null)?.phase === 'string' && typeof (value as OwnerHold).at === 'string';
const isKeys = (value: unknown): value is string[] => Array.isArray(value) && value.every((key) => typeof key === 'string');
const isTrip = (value: unknown): value is ChainTrip => typeof (value as ChainTrip | null)?.reason === 'string' && typeof (value as ChainTrip).at === 'string';

/** Copies the entries a check accepts; a broken entry of an older or torn file is dropped. */
function copyValid<T>(source: Readonly<Record<string, unknown>> | undefined, target: Record<string, T>, valid: (value: unknown) => value is T, pick: (value: T) => T = (v) => v): void {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (valid(value)) {
      target[key] = pick(value);
    }
  }
}

/** Every map of a parsed file, each entry checked; a trip holds only for a column that still holds. */
function restoreMaps(state: ChainState, parsed: ChainFile): void {
  copyValid(parsed.columns, state.columns, isMode);
  copyValid(parsed.redStreak, state.redStreak, isCount);
  copyValid(parsed.tokensUsed, state.tokensUsed, isCount);
  copyValid(parsed.tokensDay, state.tokensDay, isText);
  copyValid(parsed.cooldownUntil, state.cooldownUntil, isStamp);
  copyValid(parsed.ciBackoff, state.ciBackoff, isStamp);
  copyValid(parsed.ticketFailures, state.ticketFailures, isFailure, (f) => ({ count: f.count, until: f.until }));
  copyValid(parsed.ownerHold, state.ownerHold, isHold, (h) => ({ phase: h.phase, at: h.at }));
  copyValid(parsed.ledgerCards, state.ledgerCards, isKeys, (keys) => [...keys]);
  const held = Object.fromEntries(Object.entries(parsed.tripped ?? {}).filter(([phase]) => state.columns[phase] === 'held'));
  copyValid(held, state.tripped, isTrip, (t) => ({ reason: t.reason, at: t.at }));
  for (const persona of (parsed.pausedPersonas ?? []).filter((p) => typeof p === 'string' && p.trim() !== '')) {
    state.pausedPersonas.add(persona.trim());
  }
}

/**
 * `<root>/chain.json`: the chain's control state across runner restarts.
 * The Autopilot never resumes — every boot ends as Off, "On" is a
 * per-session decision (ADR-0077, O-5) — except across a handover to a
 * newer build moments ago (`handoverAt`).
 */
export class ChainStateStore {
  constructor(
    private readonly root: string,
    private readonly fs: FileSystem,
    private readonly clock: Clock,
    private readonly log: (message: string) => void,
  ) {}

  /** Restores the state; true when the file held a moving Autopilot that the boot rule switched Off (write it back). */
  async load(state: ChainState): Promise<boolean> {
    const raw = await this.fs.readTextOrNull(this.fs.join(this.root, CHAIN_FILE));
    if (raw === null) {
      return false;
    }
    try {
      const parsed = JSON.parse(raw) as ChainFile;
      if (parsed.version !== 1) {
        return false;
      }
      state.config = parsed.config;
      const moving = this.restoreAutopilot(state, parsed);
      restoreMaps(state, parsed);
      state.tranche = restoreTranche(parsed.tranche); // req-179: a restart continues the same tranche
      return moving;
    } catch {
      return false; // a torn chain.json is noise; the plugin re-configures on the next board round
    }
  }

  /** Temp file + rename: a torn chain.json would lose all control state. */
  async persist(state: ChainState, handoverAt?: string): Promise<void> {
    await this.fs
      .writeAtomic(this.fs.join(this.root, CHAIN_FILE), `${JSON.stringify(state.file(handoverAt), null, 2)}\n`)
      .catch((error: unknown) => this.log(`chain.json write failed: ${String(error)}`));
  }

  private restoreAutopilot(state: ChainState, parsed: ChainFile): boolean {
    const persisted = restoreAutopilot(parsed.autopilot) ?? autopilotOfMaster(parsed.master === 'run' ? 'run' : 'halted');
    const handoverMs = typeof parsed.handoverAt === 'string' ? Date.parse(parsed.handoverAt) : Number.NaN;
    const handedOver = !Number.isNaN(handoverMs) && Math.abs(this.clock.now().getTime() - handoverMs) <= HANDOVER_MASTER_MS;
    state.autopilot = autopilotAtBoot(persisted, handedOver);
    if (persisted.state === 'on' && handedOver) {
      this.log('the chain keeps running across the handover from the previous build');
    } else if (persisted.state === 'paused' && handedOver) {
      this.log('the autopilot stays paused across the handover from the previous build');
    } else if (persisted.state !== 'off') {
      this.log(`the autopilot was ${persisted.state} before this start — it is off now (boot rule)`);
    }
    return persisted.state !== 'off';
  }
}
