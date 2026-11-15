import { autopilotAtBoot, autopilotOfMaster, restoreAutopilot } from '../autopilot';
import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import type { ChainTrip, ColumnMode } from '../protocol';
import { locatorOf, type ChainFile, type ChainState, type ChainVaultLocator, type HoldMark, type OwnerHold, type TicketFailure } from './chain-state';
import { ChainStatePaths } from './chain-state-paths';
import { PreVaultChainMove } from './pre-vault-chain-move';
import { restoreTranche } from './tranche/tranche-record';

/** How fresh a retiring runner's handover stamp must be for its successor to keep the master. */
export const HANDOVER_MASTER_MS = 5 * 60_000;

const isStamp = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isCount = (value: unknown): value is number => typeof value === 'number' && value >= 0;
const isText = (value: unknown): value is string => typeof value === 'string';
const isMode = (value: unknown): value is ColumnMode => value === 'playing' || value === 'held';
const isFailure = (value: unknown): value is TicketFailure => typeof (value as TicketFailure | null)?.count === 'number' && typeof (value as TicketFailure).until === 'string';
const isHold = (value: unknown): value is OwnerHold => typeof (value as OwnerHold | null)?.phase === 'string' && typeof (value as OwnerHold).at === 'string';
const isPosition = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1);
const isHoldMark = (value: unknown): value is HoldMark =>
  typeof (value as HoldMark | null)?.persona === 'string' && isPosition((value as HoldMark).position) && isPosition((value as HoldMark).length);
const isKeys = (value: unknown): value is string[] => Array.isArray(value) && value.every((key) => typeof key === 'string');
const isTrip = (value: unknown): value is ChainTrip => typeof (value as ChainTrip | null)?.reason === 'string' && typeof (value as ChainTrip).at === 'string';
const isLocator = (value: unknown): value is ChainVaultLocator =>
  typeof (value as ChainVaultLocator | null)?.ticketsVaultPath === 'string' && (value as ChainVaultLocator).ticketsVaultPath !== '' && typeof (value as ChainVaultLocator).git === 'string';

/** Copies the entries a check accepts; a broken entry of an older or torn file is dropped. */
function copyValid<T>(source: Readonly<Record<string, unknown>> | undefined, target: Record<string, T>, valid: (value: unknown) => value is T, pick: (value: T) => T = (v) => v): void {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (valid(value)) {
      target[key] = pick(value);
    }
  }
}

/** Every map of a parsed file, each entry checked; a persona's trip holds only while the persona is paused. */
function restoreMaps(state: ChainState, parsed: ChainFile): void {
  copyValid(parsed.columns, state.columns, isMode);
  copyValid(parsed.ticketFailures, state.ticketFailures, isFailure, (f) => ({ count: f.count, until: f.until }));
  copyValid(parsed.ownerHold, state.ownerHold, isHold, (h) => ({ phase: h.phase, at: h.at }));
  copyValid(parsed.ledgerCards, state.ledgerCards, isKeys, (keys) => [...keys]);
  copyValid(parsed.holds, state.holds, isHoldMark, (h) => ({ persona: h.persona, position: h.position, length: h.length }));
  for (const persona of (parsed.pausedPersonas ?? []).filter((p) => typeof p === 'string' && p.trim() !== '')) {
    state.pausedPersonas.add(persona.trim());
  }
  copyValid(parsed.personaRedStreak, state.personaRedStreak, isCount);
  copyValid(parsed.personaCooldownUntil, state.personaCooldownUntil, isStamp);
  const trippedPersonas = Object.fromEntries(Object.entries(parsed.personaTripped ?? {}).filter(([persona]) => state.pausedPersonas.has(persona)));
  copyValid(trippedPersonas, state.personaTripped, isTrip, (t) => ({ reason: t.reason, at: t.at }));
}

/**
 * The chain's runtime state across runner restarts, one file per tickets
 * vault (ADR-0077, req-173: `<root>/chains/<vault key>/chain.json`, the
 * vault served last named by `<root>/chain-vault.json`). The Autopilot
 * never resumes — every boot, and every switch to another vault, ends as
 * Off ("On" is a per-session decision, ADR-0077 O-5) — except across a
 * handover to a newer build moments ago (`handoverAt`). The file keeps no
 * configuration: the board sends the resolved config, held in memory only.
 */
export class ChainStateStore {
  private readonly paths: ChainStatePaths;
  private pointed: string | null = null;

  constructor(
    root: string,
    private readonly fs: FileSystem,
    private readonly clock: Clock,
    private readonly log: (message: string) => void,
  ) {
    this.paths = new ChainStatePaths(root, fs);
  }

  /** The file of a vault's state (the specs and the docs read it). */
  fileFor(vaultPath: string): string {
    return this.paths.fileFor(vaultPath);
  }

  /** Restores the state of the vault served last; true when the file held a moving Autopilot that the boot rule switched Off (write it back). */
  async load(state: ChainState): Promise<boolean> {
    const moved = await new PreVaultChainMove(this.paths, this.fs, this.log).run();
    const vault = moved ?? (await this.pointer());
    return vault === null ? false : this.loadInto(state, vault);
  }

  /**
   * Points the state at a vault: the same vault keeps its state (its
   * locator refreshed); the first vault of a runner that booted without one
   * adopts the state as it stands; another one writes the current state
   * away, empties it and loads that vault's file under the boot rule. True
   * when the vault changed (the caller writes the file).
   */
  async switchTo(state: ChainState, vault: ChainVaultLocator): Promise<boolean> {
    const next = locatorOf(vault);
    if (state.vault !== null && state.vault.ticketsVaultPath === next.ticketsVaultPath) {
      state.vault = next;
      return false;
    }
    if (state.vault === null) {
      // The first vault this runner learns (no file named one at boot): the state so far is that vault's.
      state.vault = next;
      return true;
    }
    await this.persist(state);
    this.log(`the chain moves from ${state.vault.ticketsVaultPath} to ${next.ticketsVaultPath} — each vault keeps its own state`);
    state.reset();
    await this.loadInto(state, next);
    return true;
  }

  /** Temp file + rename: a torn chain.json would lose all control state. Nothing to write before a vault is known. */
  async persist(state: ChainState, handoverAt?: string): Promise<void> {
    const vault = state.vault;
    if (vault === null) {
      return;
    }
    const file = this.paths.fileFor(vault.ticketsVaultPath);
    try {
      await this.fs.mkdirp(this.fs.dirname(file));
      await this.fs.writeAtomic(file, `${JSON.stringify(state.file(handoverAt), null, 2)}\n`);
      await this.point(vault);
    } catch (error) {
      this.log(`chain.json write failed: ${String(error)}`);
    }
  }

  private async loadInto(state: ChainState, vault: ChainVaultLocator): Promise<boolean> {
    state.vault = vault;
    await this.point(vault);
    const raw = await this.fs.readTextOrNull(this.paths.fileFor(vault.ticketsVaultPath));
    if (raw === null) {
      return false;
    }
    try {
      const parsed = JSON.parse(raw) as ChainFile;
      if (parsed.version !== 1) {
        return false;
      }
      const moving = this.restoreAutopilot(state, parsed);
      restoreMaps(state, parsed);
      state.tranche = restoreTranche(parsed.tranche); // req-179: a restart continues the same tranche
      return moving;
    } catch {
      return false; // a torn chain.json is noise; the board re-configures on its next round
    }
  }

  private async pointer(): Promise<ChainVaultLocator | null> {
    const raw = await this.fs.readTextOrNull(this.paths.pointer());
    try {
      const vault = raw === null ? null : (JSON.parse(raw) as { vault?: unknown }).vault;
      return isLocator(vault) ? locatorOf(vault) : null;
    } catch {
      return null;
    }
  }

  private async point(vault: ChainVaultLocator): Promise<void> {
    const text = `${JSON.stringify({ vault }, null, 2)}\n`;
    if (text !== this.pointed) {
      await this.fs.mkdirp(this.fs.dirname(this.paths.pointer()));
      await this.fs.writeAtomic(this.paths.pointer(), text);
      this.pointed = text;
    }
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
