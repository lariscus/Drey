/**
 * The command that attaches a terminal to a run's harness session
 * (req-166, board 8b's *Copy attach command*): into the worktree, then the
 * harness's own resume of the session. The owner pastes it into a terminal;
 * a session the worker still drives is shared, so this is the workshop's
 * tool, not a takeover (that stays Drey's Thread). Pure.
 */

/** The resume arguments per harness: Claude Code `--resume`, OpenCode `--session`, Kimi `--session`. */
const RESUME: Readonly<Record<string, (ref: string) => string>> = {
  'claude-code': (ref) => `claude --resume ${ref}`,
  opencode: (ref) => `opencode --session ${ref}`,
  kimi: (ref) => `kimi --session ${ref}`,
};

/** `cd "<worktree>" && <harness resume>`; null when the run has no session yet or the harness has no resume. */
export function attachCommandOf(provider: string, sessionRef: string | null, worktreePath: string): string | null {
  const resume = RESUME[provider];
  if (resume === undefined || sessionRef === null || sessionRef === '' || !/^[\w.:-]+$/.test(sessionRef)) {
    return null;
  }
  const cd = worktreePath === '' ? '' : `cd "${worktreePath.replace(/"/g, '')}" && `;
  return `${cd}${resume(sessionRef)}`;
}
