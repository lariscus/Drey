import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { harness, runRequest, startRun, useTempDirs } from './supervisor-harness.fake';
import { gitRecorder } from './tickets-git.fake';

describe('AttachmentStore — files the owner attaches in the takeover tab', () => {
  const dirs = useTempDirs();

  it('a scout run stores owner attachments in its run dir — the read ground is never written', async () => {
    const git = gitRecorder();
    const { sup } = harness(dirs.fleet, { ticketsGit: git.ticketsGit });
    const scout = runRequest(dirs.vault, { form: 'scout', acceptance: [], gate: 'none', nextPhase: null, nextPhaseDir: null, worktreePath: 'W:/kt', instruction: 'Scout it.' });
    const id = await startRun(sup, scout);

    const attached = await sup.attachFile(id, 'log.txt', Buffer.from('evidence').toString('base64'));
    expect(attached.ok).toBe(true);
    if (attached.ok) {
      expect(attached.path.startsWith(path.join(dirs.fleet, 'runs', id))).toBe(true);
    }
    // No worktree exclude dance — nothing in the read ground may be touched.
    expect(git.calls.some((c) => c.args.includes('--git-path'))).toBe(false);
  });
});
