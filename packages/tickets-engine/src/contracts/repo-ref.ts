/**
 * One work repository of `tickets/_meta/repos.md` (ADR-0075,
 * `specs/ticket-schema.md`). Split out of `tickets.ts` with req-177; that
 * file re-exports it. Req-290 retired the `profile:` key a repository
 * once carried: every slot may serve every repository.
 */

/** One work repo from `tickets/_meta/repos.md`. */
export interface RepoRef {
  readonly name: string;
  readonly url: string;
  readonly branch: string | null;
  readonly policy: string | null;
  /** Local checkout / worktree to open for testing (T-0004); the clone
   *  URL stays `url`. Null when not configured. */
  readonly path: string | null;
  /** The repo's default fleet worker (`worker: opencode`), or null. */
  readonly worker: string | null;
  /**
   * The repo's worktree base override (`worktrees:`, T-0044): where the
   * fleet's checkouts for this repo live — `<base>/<ticket-id>`.
   * Absolute, or relative to the tickets repo root. Null = the default
   * `<ticketsRepo>/_worktrees` (ADR-0080).
   */
  readonly worktrees: string | null;
  /**
   * The command that starts the repository's program in a worktree, run
   * there in a new console — req-75 W3 / T-0057; null = `dev.ps1 -Built
   * -Multi` when the worktree has a `dev.ps1`, else no launch.
   */
  readonly launch: string | null;
  /**
   * The file inlined as a fleet run's agent instructions (`instructions:`,
   * req-79), relative to the checkout at `path`; null = `CLAUDE.md`, else
   * `AGENTS.md` (the context pack, T-0048).
   */
  readonly instructions: string | null;
  /** Git-ignored folders a fleet worktree links from the checkout (`link:`, req-56); absent = none. */
  readonly link?: readonly string[];
}
