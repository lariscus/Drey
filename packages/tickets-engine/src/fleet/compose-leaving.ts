/**
 * The wiring of the leaving actions (req-267): the git port, "main", the
 * two actions, the run-end part and the commit's machine run — built once
 * per supervisor by `compose-supervisor.ts`, kept here so that root stays
 * inside the file-size rule (ADR-0096).
 */
import type { Clock } from './ports/clock';
import type { BackgroundWork } from './orchestrate/background-work';
import { CommitAction } from './orchestrate/commit-action';
import { CommitRun } from './orchestrate/commit-run';
import { FinishedWorktrees } from './orchestrate/finished-worktrees';
import { GitWorktreeRemover } from './git-worktree-remover';
import type { GateSeats } from './orchestrate/gate-runner';
import type { LeavingGit } from './orchestrate/leaving-git';
import { MainRef } from './orchestrate/main-ref';
import type { RunBookkeeper } from './orchestrate/run-bookkeeper';
import type { RunClaims } from './orchestrate/run-claims';
import { RunLeaving } from './orchestrate/run-leaving';
import type { RunRepository } from './orchestrate/run-repository';
import type { RunSettler } from './orchestrate/run-settler';
import type { RunStreams } from './orchestrate/run-streams';
import { SyncMainAction } from './orchestrate/sync-main-action';
import type { RunStateMachine } from './run/run-state-machine';

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
