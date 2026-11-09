import type { FileSystem } from '../ports/file-system';
import type { TreeMode } from '../ports/tree-mode';
import type { ReviewCheckoutRecord, RunRequest } from '../protocol';
import { messageOf, type LiveRun } from './live-run';

/** The git the review checkout drives (a `TicketsGit`): one command in one folder, its stdout. */
export interface ReviewGit {
  run(cwd: string, args: readonly string[]): Promise<string>;
}

export interface ReviewCheckoutDeps {
  readonly git: ReviewGit;
  readonly mode: TreeMode;
  readonly fs: FileSystem;
  readonly log: (message: string) => void;
}

const short = (commit: string): string => commit.slice(0, 10);

/**
 * The review phase's own checkout (req-183): the reviewer reads the ticket
 * branch in a second git worktree, `<id>-review`, detached at the exact
 * commit the builder handed over, with its files read-only on disk — never
 * in the builder's worktree. The gate fails a review whose branch moved past
 * that commit; the checkout goes with the run's end.
 */
export class ReviewCheckout {
  constructor(private readonly deps: ReviewCheckoutDeps) {}

  /** Opens the request's review checkout; null when the run is no review. Throws with the reason when it cannot. */
  async open(request: RunRequest): Promise<ReviewCheckoutRecord | null> {
    const checkout = request.reviewCheckout;
    if (checkout === undefined) {
      return null;
    }
    const commit = await this.headOf(request);
    if (await this.deps.fs.exists(checkout)) {
      this.deps.log(`${request.ticketId}: a leftover review checkout at ${checkout} is removed first`);
      await this.remove(request.repoPath, checkout);
    }
    await this.deps.git.run(request.repoPath, ['worktree', 'add', '--detach', checkout, commit]);
    try {
      await this.deps.mode.setReadOnly(checkout, true);
    } catch (error) {
      await this.remove(request.repoPath, checkout);
      throw new Error(`the review checkout could not be made read-only — ${messageOf(error)}`);
    }
    return { checkout, commit };
  }

  /** The gate's first question on a review: null while the branch still points at the reviewed commit, else the failure. */
  async moved(run: LiveRun): Promise<string | null> {
    const review = run.info.review;
    if (review === undefined) {
      return null;
    }
    const branch = run.request.branch;
    let head: string;
    try {
      head = await this.headOf(run.request);
    } catch (error) {
      return `the branch ${branch} cannot be read after the review — ${messageOf(error)}`;
    }
    if (head === review.commit) {
      return null;
    }
    return (
      `the branch ${branch} moved after the review began: the reviewer judged ${short(review.commit)}, the branch is at ${short(head)} now — ` +
      'a later commit was never reviewed, so the review fails'
    );
  }

  /** The checkout goes with the run's end; a failure is a log line, the next open clears what is left. */
  async close(run: LiveRun): Promise<void> {
    const review = run.info.review;
    if (review === undefined) {
      return;
    }
    await this.remove(run.request.repoPath, review.checkout).catch((error: unknown) => {
      this.deps.log(`${run.request.ticketId}: the review checkout ${review.checkout} could not be removed — ${messageOf(error)}`);
    });
  }

  /** The commit the branch points at — the builder's hand-over. */
  private async headOf(request: RunRequest): Promise<string> {
    try {
      return (await this.deps.git.run(request.repoPath, ['rev-parse', '--verify', `refs/heads/${request.branch}^{commit}`])).trim();
    } catch {
      throw new Error(`the branch ${request.branch} does not exist — nothing was handed over to review`);
    }
  }

  /** Writable again, `git worktree remove --force` (not registered: nothing to remove), then a prune for the admin entry. */
  private async remove(repoPath: string, checkout: string): Promise<void> {
    await this.deps.mode.setReadOnly(checkout, false).catch(() => undefined);
    await this.deps.git.run(repoPath, ['worktree', 'remove', '--force', checkout]).catch(() => undefined);
    await this.deps.git.run(repoPath, ['worktree', 'prune']).catch(() => undefined);
    if (await this.deps.fs.exists(checkout)) {
      throw new Error(`${checkout} is still there after git worktree remove`);
    }
  }
}
