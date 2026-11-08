import type { BoardSnapshot, PipelinePhase, TicketCard } from '../../contracts/tickets';
import { parseHandover } from '../../contracts/tickets';
import { nextPhaseIdOf } from '../chain';
import type { Clock } from '../ports/clock';
import type { ChainConfig } from '../protocol';
import type { ChainBoard } from './chain-board';
import type { ChainState } from './chain-state';
import type { GateShell } from './gate-runner';
import { messageOf } from './live-run';
import type { RunBookkeeper } from './run-bookkeeper';

/** A failed ci check backs off before its next attempt. */
export const CI_BACKOFF_MS = 10 * 60_000;

export interface CiSweepDeps {
  readonly state: ChainState;
  readonly board: ChainBoard;
  readonly bookkeeper: RunBookkeeper;
  readonly shell: GateShell;
  readonly clock: Clock;
  readonly log: (message: string) => void;
  /** The pass read the pipeline: drop stale phase state and write `chain.json`. */
  readonly pipelineRead: () => Promise<void>;
  readonly persist: () => Promise<void>;
}

/**
 * The ci handover's round (M85): a `handover: ci` column leaves its tickets
 * to an executable check — green moves one column right (the machine's
 * move, one `put`), red backs the ticket off for ten minutes. Checks run in
 * the ticket's work repo outside the dispatch pass, so a slow check never
 * blocks a dispatch.
 */
export class CiSweep {
  private sweeping = false;

  constructor(private readonly deps: CiSweepDeps) {}

  async sweep(): Promise<void> {
    const config = this.deps.state.config;
    if (config === null || this.sweeping) {
      return;
    }
    this.sweeping = true;
    try {
      const snap = await this.deps.board.read(config);
      if (snap !== null) {
        this.deps.state.phases = snap.pipeline;
        await this.deps.pipelineRead();
        await this.sweepBoard(config, snap);
      }
    } catch (error) {
      this.deps.log(`ci sweep failed: ${messageOf(error)}`);
    } finally {
      this.sweeping = false;
    }
  }

  private async sweepBoard(config: ChainConfig, snap: BoardSnapshot): Promise<void> {
    for (const column of snap.columns) {
      const phase = column.phase;
      const nextPhaseId = nextPhaseIdOf(snap.columns, phase.id);
      if (parseHandover(phase.handover).mode !== 'ci' || phase.ci === null || nextPhaseId === null) {
        continue;
      }
      if (this.deps.state.modeOf(phase.id) !== 'playing' || this.deps.state.master !== 'run') {
        continue;
      }
      for (const card of column.tickets.filter((c) => this.due(c))) {
        await this.check(config, snap, { phase, nextPhaseId }, card);
        if (await this.deps.board.moved(config, card)) {
          break; // the sweep's column snapshot is stale — the next tick re-reads
        }
      }
    }
  }

  /** Free, unblocked (T-0050) and past its back-off. */
  private due(card: TicketCard): boolean {
    const backoff = this.deps.state.ciBackoff[card.id];
    const waiting = backoff !== undefined && this.deps.clock.now().getTime() < Date.parse(backoff);
    return card.meta.run === null && card.meta.claimedBy === null && card.blocked.length === 0 && !waiting;
  }

  private async check(config: ChainConfig, snap: BoardSnapshot, column: { readonly phase: PipelinePhase; readonly nextPhaseId: string }, card: TicketCard): Promise<void> {
    const { phase, nextPhaseId } = column;
    const repo = card.meta.repo === null ? null : (snap.repos.find((r) => r.name === card.meta.repo) ?? null);
    const door = this.deps.board.door(config);
    if (repo === null || repo.path === null || phase.ci === null || door === null) {
      return; // a card without a checkout is the board's badge, not the runner's guess
    }
    this.deps.log(`ci ${phase.id}: ${card.id} — ${phase.ci}`);
    try {
      await this.deps.shell(phase.ci, repo.path);
    } catch (error) {
      const detail = messageOf(error).split('\n')[0] ?? 'failed';
      this.deps.state.ciBackoff[card.id] = new Date(this.deps.clock.now().getTime() + CI_BACKOFF_MS).toISOString();
      await this.deps.persist();
      await this.deps.bookkeeper.logCard(door, card, `ci check failed — ${detail.slice(0, 300)} (retry in 10 min)`);
      return;
    }
    if (await this.deps.bookkeeper.moveCard(door, card, nextPhaseId, `ci check passed — moving to ${nextPhaseId}`)) {
      this.deps.log(`ci moved ${card.id} to ${nextPhaseId}`);
      delete this.deps.state.ciBackoff[card.id];
      await this.deps.persist();
    }
  }
}
