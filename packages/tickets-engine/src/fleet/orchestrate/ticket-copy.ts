import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { mergeWorkerChapters } from '../../core/ticket-chapters';
import type { RunRequest } from '../protocol';
import { ticketCopyPathFor } from '../worktree-home';
import { messageOf, type LiveRun } from './live-run';
import type { StoreClaims } from './store-claims';

/** The ticket text the worker's copy started from, in the run's folder (D-30). */
const TICKET_GIVEN_FILE = 'ticket-given.md';

/**
 * The worker's ticket on a store (D-30, E14-5c): the virtual path of a
 * store card is on no disk, and a worker told to edit it went looking and
 * wrote a legacy file into the meta vault. So it gets a copy of the
 * ticket; the text it was given stays in the run's folder, so a later
 * take-back knows what the worker changed.
 */
export class TicketCopy {
  constructor(
    private readonly claims: StoreClaims,
    private readonly log: (message: string) => void,
  ) {}

  /** A failed read is a log line: the worker then has no copy to edit, nothing more. */
  async write(request: RunRequest, dir: string): Promise<void> {
    try {
      const { text } = await this.claims.storeOf(request.dk!).show(request.ticketId);
      const copy = ticketCopyPathFor(request.ticketsVaultPath, request.ticketId);
      await fsp.mkdir(path.dirname(copy), { recursive: true });
      await fsp.writeFile(copy, text, 'utf8');
      await fsp.writeFile(path.join(dir, TICKET_GIVEN_FILE), text, 'utf8');
    } catch (error) {
      this.log(`${request.ticketId}: the worker's copy of the ticket could not be written - ${messageOf(error)}`);
    }
  }

  /** What the worker changed in its copy goes into the store, inside the claim; calling it again changes nothing. */
  async sync(run: LiveRun): Promise<void> {
    if (run.request.dk === undefined || run.lease === undefined) {
      return;
    }
    const givenPath = path.join(run.dir, TICKET_GIVEN_FILE);
    const given = await fsp.readFile(givenPath, 'utf8').catch(() => null);
    const worker = await fsp.readFile(ticketCopyPathFor(run.request.ticketsVaultPath, run.request.ticketId), 'utf8').catch(() => null);
    if (given === null || worker === null || given === worker) {
      return;
    }
    if (await run.lease.patchInClaim((current) => mergeWorkerChapters(given, worker, current))) {
      await fsp.writeFile(givenPath, worker, 'utf8').catch(() => undefined);
    }
  }

  /** The ticket as the store holds it after the worker's changes went in; null without a store or when unreadable. */
  async syncedText(run: LiveRun): Promise<string | null> {
    if (run.request.dk === undefined) {
      return null; // a record from before the cut-over: nothing is read from the frozen tree (D-42)
    }
    await this.sync(run);
    return this.claims
      .storeOf(run.request.dk)
      .show(run.request.ticketId)
      .then((d) => d.text)
      .catch(() => null);
  }

  /** The copy goes with the run's end. */
  async drop(run: LiveRun): Promise<void> {
    if (run.request.dk !== undefined) {
      await fsp.rm(ticketCopyPathFor(run.request.ticketsVaultPath, run.request.ticketId), { force: true }).catch(() => undefined);
    }
  }
}
