import type { FileSystem } from '../ports/file-system';
import { legacyTicketCopyPathFor, ticketCopyPathFor } from '../worktrees/worktree-home';

/**
 * Where a worker's ticket copy lives (D-30, req-183): `_workcopy/<id>.ticket.md`.
 * For one release the copy is also looked for at its old place,
 * `_worktrees/<id>.ticket.md` — a run started by an older runner still has
 * it there. The first read moves it into place (one migration, one log line
 * per file); when both exist the new one wins and the old one goes.
 */
export class WorkcopyFiles {
  constructor(
    private readonly fs: FileSystem,
    private readonly log: (message: string) => void,
  ) {}

  /** The path the runner writes: always the new one. */
  pathOf(vaultPath: string, ticketId: string): string {
    return ticketCopyPathFor(vaultPath, ticketId);
  }

  async write(vaultPath: string, ticketId: string, text: string): Promise<void> {
    const copy = this.pathOf(vaultPath, ticketId);
    await this.fs.mkdirp(this.fs.dirname(copy));
    await this.fs.writeText(copy, text);
  }

  /** The copy's text — the new path first, then the old one (migrated on the way) — or null when there is none. */
  async read(vaultPath: string, ticketId: string): Promise<string | null> {
    const current = this.pathOf(vaultPath, ticketId);
    const legacy = legacyTicketCopyPathFor(vaultPath, ticketId);
    const text = await this.fs.readTextOrNull(current);
    if (text !== null) {
      if (await this.fs.exists(legacy)) {
        await this.fs.remove(legacy).catch(() => undefined);
        this.log(`${ticketId}: an old working copy at ${legacy} was dropped — ${current} is the copy (req-183)`);
      }
      return text;
    }
    const old = await this.fs.readTextOrNull(legacy);
    if (old === null) {
      return null;
    }
    await this.migrate(ticketId, old, { current, legacy });
    return old;
  }

  /** Both places go with the run's end. */
  async drop(vaultPath: string, ticketId: string): Promise<void> {
    await this.fs.remove(this.pathOf(vaultPath, ticketId));
    await this.fs.remove(legacyTicketCopyPathFor(vaultPath, ticketId));
  }

  /** A failed move leaves the old copy where it is: the next read tries again, nothing is lost. */
  private async migrate(ticketId: string, text: string, paths: { readonly current: string; readonly legacy: string }): Promise<void> {
    try {
      await this.fs.mkdirp(this.fs.dirname(paths.current));
      await this.fs.writeText(paths.current, text);
      await this.fs.remove(paths.legacy);
      this.log(`${ticketId}: the working copy moved from ${paths.legacy} to ${paths.current} (req-183, read at the old place for one release)`);
    } catch (error) {
      this.log(`${ticketId}: moving the working copy to ${paths.current} failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
