import * as path from 'node:path';
import { TicketsGit, type GitExecFn } from '../../core/git/tickets-git';

/** A git seam that records every call: `rev-parse` answers a fixed root, `worktree add` finds its path taken, `worktree list` answers what the spec set. */
export interface GitRecorder {
  readonly ticketsGit: TicketsGit;
  readonly calls: Array<{ args: readonly string[]; cwd: string }>;
  worktreeList: string;
}

export function gitRecorder(): GitRecorder {
  const recorder: GitRecorder = {
    calls: [],
    worktreeList: '',
    ticketsGit: undefined as unknown as TicketsGit,
  };
  const exec: GitExecFn = async (_exe, args, cwd) => {
    recorder.calls.push({ args, cwd });
    if (args[0] === 'rev-parse') {
      return `${path.sep}root${path.sep}tk\n`;
    }
    // The default prepareWorktree: an existing registration at the same path throws — the reuse rule answers with the list.
    if (args[0] === 'worktree' && args[1] === 'add') {
      throw new Error(`fatal: '${args[2] ?? ''}' already exists`);
    }
    if (args[0] === 'worktree' && args[1] === 'list') {
      return recorder.worktreeList;
    }
    return '';
  };
  return Object.assign(recorder, { ticketsGit: new TicketsGit(() => 'git', exec) });
}
