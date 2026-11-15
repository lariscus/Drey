import type { TicketsGit } from '../../core/git/tickets-git';
import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import { messageOf } from './live-run';
import type { RunRepository } from './run-repository';

/** The largest file the takeover tab attaches. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_DIR = '.drey-attachments';

export type AttachOutcome = { ok: true; path: string } | { ok: false; error: string };

/**
 * A file the owner attaches in the takeover tab: stored inside the run's
 * worktree (`.drey-attachments/`, kept out of git through the checkout's
 * exclude file), its absolute path returned — the prompt then names it. A
 * scout run's `worktreePath` is its read ground, never written: its
 * attachments live in the run's own folder.
 */
export class AttachmentStore {
  constructor(
    private readonly repo: RunRepository,
    private readonly git: Pick<TicketsGit, 'run'>,
    private readonly fs: FileSystem,
    private readonly clock: Clock,
  ) {}

  async attach(runId: string, name: string, dataBase64: string): Promise<AttachOutcome> {
    const run = this.repo.find(runId);
    if (run === undefined) {
      return { ok: false, error: `unknown run "${runId}"` };
    }
    const bytes = Buffer.from(dataBase64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: `an attachment is 1 byte to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB` };
    }
    const scout = run.request.form === 'scout';
    const worktree = scout ? run.dir : run.info.worktreePath;
    const dir = this.fs.join(worktree, ATTACHMENT_DIR);
    const safe = name.replace(/[^\w.\- ]/g, '_').slice(-80) || 'file';
    const target = this.fs.join(dir, `${this.clock.now().getTime()}-${safe}`);
    try {
      await this.fs.mkdirp(dir);
      await this.fs.writeBytes(target, bytes);
      if (!scout) {
        await this.exclude(worktree);
      }
    } catch (error) {
      return { ok: false, error: `the attachment could not be stored: ${messageOf(error)}` };
    }
    return { ok: true, path: target };
  }

  /** The attachment folder in the checkout's exclude file, once. */
  private async exclude(worktree: string): Promise<void> {
    const excludeRel = (await this.git.run(worktree, ['rev-parse', '--git-path', 'info/exclude'])).trim();
    const exclude = this.fs.resolve(worktree, excludeRel);
    const current = (await this.fs.readTextOrNull(exclude)) ?? '';
    if (!current.split('\n').some((line) => line.trim() === `${ATTACHMENT_DIR}/`)) {
      await this.fs.mkdirp(this.fs.dirname(exclude));
      const lead = current === '' || current.endsWith('\n') ? '' : '\n';
      await this.fs.writeText(exclude, `${current}${lead}${ATTACHMENT_DIR}/\n`);
    }
  }
}
