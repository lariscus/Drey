import type { BoardSnapshot, PipelinePhase, TicketCard } from '../../contracts/tickets';
import type { ChainConfig, ChainStoreConfig } from '../protocol';
import type { StoreChainBoard } from '../store-chain-board';
import { messageOf } from './live-run';

export interface ChainBoardDeps {
  /** The store door of a chain config (production: the checkout's files + `dk`). */
  readonly doorFor: (store: ChainStoreConfig) => StoreChainBoard;
  /** Gives up the claims no live run holds, once per runner life and store, before its first dispatch. */
  readonly releaseLeftovers?: (store: ChainStoreConfig, pipeline: readonly PipelinePhase[]) => Promise<void>;
  readonly log: (message: string) => void;
}

/**
 * The chain's board (E14-5b, req-176): read from the dricket store the
 * chain config names — the one backend. A board without a store target is
 * not driven: the legacy file board has no writer left in the runner, so
 * the chain says so once and dispatches nothing.
 */
export class ChainBoard {
  private readonly doors = new Map<string, StoreChainBoard>();
  private leftoverKey: string | null = null;
  private noStoreSaid = false;

  constructor(private readonly deps: ChainBoardDeps) {}

  /** The store door of the config, or null on a board without a store. */
  door(config: ChainConfig): StoreChainBoard | null {
    if (config.store === undefined) {
      return null;
    }
    const key = JSON.stringify(config.store);
    let door = this.doors.get(key);
    if (door === undefined) {
      door = this.deps.doorFor(config.store);
      this.doors.set(key, door);
    }
    return door;
  }

  /** The board of this pass, or null (said once) when the chain has no store to read. */
  async read(config: ChainConfig): Promise<BoardSnapshot | null> {
    const door = this.door(config);
    if (door === null) {
      if (!this.noStoreSaid) {
        this.noStoreSaid = true;
        this.deps.log('the chain runs on a dricket store only (req-176) — this board has no store (tickets.backend), so nothing is dispatched');
      }
      return null;
    }
    this.noStoreSaid = false;
    return door.board(config.ticketsVaultPath, config.defaultWorker);
  }

  /** Releases a killed runner's leftover claims before the first dispatch of a store; returns the board to plan on. */
  async settleLeftovers(config: ChainConfig, snap: BoardSnapshot): Promise<BoardSnapshot> {
    const key = config.store === undefined ? null : JSON.stringify(config.store);
    if (config.store === undefined || key === this.leftoverKey || this.deps.releaseLeftovers === undefined) {
      return snap;
    }
    this.leftoverKey = key;
    await this.deps.releaseLeftovers(config.store, snap.pipeline).catch((error) => this.deps.log(`releasing leftover claims failed: ${messageOf(error)}`));
    return (await this.read(config)) ?? snap;
  }

  /** True when the ticket is no longer where the snapshot saw it. */
  async moved(config: ChainConfig, card: TicketCard): Promise<boolean> {
    const door = this.door(config);
    return door === null ? true : door.moved(card);
  }

  /** The card's text in the shape the composer reads; null when the store cannot give it. */
  async cardText(config: ChainConfig, card: TicketCard): Promise<string | null> {
    const door = this.door(config);
    return door === null ? null : door.cardText(card);
  }
}
