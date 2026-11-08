import type { TicketsGit } from '../../core/tickets-git';
import type { RunRequest } from '../protocol';

/** The exec seam the state machine drives (a `TicketsGit` instance). */
export type GitSeam = Pick<TicketsGit, 'run'>;

export type PrepareRequest = Pick<RunRequest, 'repoPath' | 'branch' | 'baseRef' | 'links'>;

/** Guards the create path's branch-conflict healing (T-0044): true for a
 *  checkout a live run is working in. */
export type IsLive = (worktreePath: string) => boolean;

/** One worktree preparation: what the state machine's steps share. */
export interface PrepareJob {
  readonly git: GitSeam;
  readonly request: PrepareRequest;
  readonly worktreePath: string;
  readonly now: () => Date;
  readonly isLive?: IsLive | undefined;
}
