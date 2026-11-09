import { hostname } from 'node:os';
import { VerifyService } from '../services/verify-service';
import { VideoService } from '../services/video-service';
import type { BoardParts } from './compose-board-parts';
import type { EngineOptions } from './engine-types';
import type { FileConfigStore } from './file-config';
import { createPlaywrightVerifyHarness } from './verify-harness';

type Log = NonNullable<EngineOptions['log']>;

export interface VerifyParts {
  readonly videos: VideoService;
  readonly verify: VerifyService;
  /** Settles once the startup housekeeping behind the engine has finished (the videos folder). */
  readonly startupWork: Promise<void>;
}

/**
 * E4: the machine verification step — the harness runs the ticket
 * worktree's built app headless; the service persists the proofs and moves
 * the ticket to the owner's checkpoint. The engine listens only after the
 * board was checked for verify candidates (and the scan's startup IO has
 * settled).
 */
export async function composeVerifyParts(opts: EngineOptions, config: FileConfigStore, parts: BoardParts, log: Log): Promise<VerifyParts> {
  const { board, host, git, events } = parts;
  const videos = new VideoService({ board, host, git, config, log });
  const verify = new VerifyService({
    board,
    host,
    harness: opts.verifyHarness ?? createPlaywrightVerifyHarness(),
    config,
    git,
    actor: `verify@${hostname().toLowerCase()}`,
    events,
    videos,
    log,
  });
  await verify.initialScan;
  // E11-1: the videos folder and its ignore rule exist from the start (E11-1c: nothing is ever deleted).
  const startupWork = videos.prepare().then(() => undefined, () => undefined);
  return { videos, verify, startupWork };
}
