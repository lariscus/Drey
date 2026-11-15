/**
 * The wiring of the leaving actions (req-267): the git port, "main", the
 * two actions, the run-end part and the commit's machine run — built once
 * per supervisor by `compose-supervisor.ts`, kept here so that root stays
 * inside the file-size rule (ADR-0096).
 */
import type { Clock } from '../ports/clock';
import type { BackgroundWork } from '../runner/background-work';
import { CommitAction } from './commit-action';
import { CommitRun } from './commit-run';
import { FinishedWorktrees } from '../worktrees/finished-worktrees';
import { GitWorktreeRemover } from '../worktrees/git-worktree-remover';
import type { GateSeats } from '../runner/gate-runner';
import type { LeavingGit } from './leaving-git';
import { MainRef } from '../runner/main-ref';
import type { RunBookkeeper } from '../runner/run-bookkeeper';
import type { RunClaims } from '../lease/run-claims';
import { RunLeaving } from './run-leaving';
import type { RunRepository } from '../runner/run-repository';
import type { RunSettler } from '../runner/run-settler';
import type { RunStreams } from '../runner/run-streams';
import { SyncMainAction } from './sync-main-action';
import type { RunStateMachine } from '../runner/run-state-machine';

export interface LeavingWiring {
  readonly git: LeavingGit;
  readonly bookkeeper: RunBookkeeper;
  readonly repo: RunRepository;
  readonly claims: RunClaims;
  readonly seats?: GateSeats;
}

function seatsOf(seats: GateSeats | undefined): { seats?: GateSeats } {
  return seats !== undefined ? { seats } : {};
}

/** The builder's `sync-main` at a run's green end. */
export function runLeavingOf(w: LeavingWiring): RunLeaving {
  const sync = new SyncMainAction(w.git, new MainRef(w.git));
  return new RunLeaving({ sync, bookkeeper: w.bookkeeper, repo: w.repo, trailers: (run, op) => w.claims.trailers(run, op), ...seatsOf(w.seats) });
}

export interface CommitRunWiring extends LeavingWiring {
  readonly machine: RunStateMachine;
  readonly streams: RunStreams;
  readonly settler: RunSettler;
  readonly background: BackgroundWork;
  readonly clock: Clock;
  readonly log: (message: string) => void;
  readonly retiring: () => boolean;
}

/** You's commit after the sign-off, as a machine run. */
export function commitRunOf(w: CommitRunWiring): CommitRun {
  const action = new CommitAction(w.git, new MainRef(w.git));
  const { machine, repo, streams, claims, bookkeeper, settler, background, clock, log, retiring } = w;
  const finished = new FinishedWorktrees(new GitWorktreeRemover(w.git));
  return new CommitRun({ machine, repo, streams, claims, bookkeeper, settler, action, background, clock, log, retiring, finished, ...seatsOf(w.seats) });
}
