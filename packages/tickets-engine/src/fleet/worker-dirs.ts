/**
 * The folders a worker may write beyond its working folder (req-185,
 * ADR-0099): the folder of its ticket file — the store's working copy in
 * `_workcopy/`, else the ticket's folder in the tickets repository — and the
 * worktrees of the ticket's further repositories (req-72). A free session or
 * a 1:1 works in its one folder and gets none. The runner's own run folder is
 * never one of them: it holds the worker's vault token.
 *
 * Pure: path discipline only.
 */
import * as path from 'node:path';
import type { RunRequest } from './protocol';
import { ticketCopyPathFor } from './worktree-home';

export function workerWriteDirsOf(request: Pick<RunRequest, 'session' | 'dk' | 'ticketsVaultPath' | 'ticketRelPath' | 'ticketId' | 'extraRepos'>): readonly string[] {
  if (request.session !== undefined || !request.ticketRelPath || !request.ticketsVaultPath) {
    return [];
  }
  const ticketFile = request.dk !== undefined ? ticketCopyPathFor(request.ticketsVaultPath, request.ticketId) : path.join(request.ticketsVaultPath, request.ticketRelPath);
  return [path.dirname(ticketFile), ...(request.extraRepos ?? []).map((extra) => extra.worktreePath)];
}
