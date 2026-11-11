import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { BoardSnapshot } from '../contracts/tickets';
import type { TicketDetail } from '../ports/ticket-store';
import { diffBoards, renderBoardDiff, type BoardDiff } from './board-diff';
import { assembleBoardFromRecords, type RecordsBoardInput } from './store-board';
import type { StoreSettings } from './store-settings';

/**
 * Shadow mode (E14-2): builds the board from the store, compares it with the board the UI shows and
 * writes `board-diff.md` / `board-diff.json`. Fire and forget (never throws, never delays the
 * snapshot), one run at a time, at most one per interval. Goes with the files backend (E14-9b).
 */
export class StoreShadow {
  private running = false;
  private done: Promise<unknown> = Promise.resolve();
  private at = 0;
  private last: BoardDiff | null = null;

  constructor(
    /** Where the report lands (`<userRoot>/shadow`). */
    private readonly reportDir: string,
    private readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void,
    /** Minimum gap between two runs (every snapshot would otherwise cost a `dk` pass). */
    private readonly intervalMs: number,
    private readonly records: (settings: StoreSettings) => Promise<readonly TicketDetail[]>,
  ) {}

  /** The last comparison, or null before the first run finished. */
  get lastDiff(): BoardDiff | null {
    return this.last;
  }

  /** Resolves when a running comparison is over. */
  idle(): Promise<unknown> {
    return this.done;
  }

  schedule(settings: StoreSettings, input: Omit<RecordsBoardInput, 'records'>, shown: BoardSnapshot): void {
    const now = Date.now();
    if (this.running || now - this.at < this.intervalMs) {
      return;
    }
    this.running = true;
    this.at = now;
    this.done = this.run(settings, input, shown).finally(() => {
      this.running = false;
    });
  }

  /** The awaitable core of {@link schedule} (specs call it directly). */
  async run(settings: StoreSettings, input: Omit<RecordsBoardInput, 'records'>, shown: BoardSnapshot): Promise<BoardDiff | null> {
    const info = { generatedAt: new Date().toISOString(), leftName: 'files', rightName: 'dricket' };
    let diff: BoardDiff | null = null;
    let error: string | undefined;
    try {
      const candidate = assembleBoardFromRecords({ ...input, records: await this.records(settings) });
      diff = diffBoards(shown, candidate);
      this.last = diff;
      if (!diff.equal) {
        this.log(`tickets shadow: boards differ (${diff.differing.length} tickets differ, ${diff.onlyLeft.length} only in files, ${diff.onlyRight.length} only in dricket) - see ${path.join(this.reportDir, 'board-diff.md')}`, 'warn');
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      this.log(`tickets shadow: the dricket board could not be built: ${error}`, 'warn');
    }
    try {
      await fsp.mkdir(this.reportDir, { recursive: true });
      await fsp.writeFile(path.join(this.reportDir, 'board-diff.md'), renderBoardDiff(diff, { ...info, ...(error === undefined ? {} : { error }) }), 'utf8');
      await fsp.writeFile(path.join(this.reportDir, 'board-diff.json'), JSON.stringify({ ...info, error: error ?? null, diff }, null, 2) + '\n', 'utf8');
    } catch (e) {
      this.log(`tickets shadow: the report could not be written: ${e instanceof Error ? e.message : String(e)}`, 'warn');
    }
    return diff;
  }
}
