import { CREW_FILE } from '../contracts/crew-config';
import { parseCrewFile, type CrewParse } from '../core/crew-file';
import type { TicketsGit } from '../core/tickets-git';
import type { EngineHost, EngineVault } from './host';

/** The file as read: its text (null = absent) and its parse. */
export interface CrewRead {
  readonly text: string | null;
  readonly parse: CrewParse;
}

/**
 * `tickets/_meta/crew.md` on disk (req-173): read through the host, written
 * with one commit of exactly that file and the vault's change round — the
 * same discipline as `repos.md` and `pipeline.md`. Writes queue, so two
 * patches never race on the same text.
 */
export class CrewConfigFiles {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly host: Pick<EngineHost, 'read' | 'write' | 'announceChanges' | 'log'>,
    private readonly git: Pick<TicketsGit, 'locate' | 'commitPaths'>,
  ) {}

  async read(vault: EngineVault): Promise<CrewRead> {
    let text: string | null;
    try {
      text = await this.host.read(vault.id, CREW_FILE);
    } catch {
      text = null;
    }
    return { text, parse: parseCrewFile(text) };
  }

  /** Runs one read-modify-write after every earlier one. */
  serial<T>(op: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(op);
    this.tail = next;
    return next;
  }

  /** Writes the text and nothing else — for the one writer that commits the file together with others (the crew seeder, req-256). */
  put(vault: EngineVault, text: string): Promise<void> {
    return this.host.write(vault.id, CREW_FILE, text);
  }

  /** Writes the text and commits the file; a vault outside git keeps the write unversioned (logged). */
  async write(vault: EngineVault, text: string, message: string): Promise<void> {
    await this.put(vault, text);
    const location = await this.git.locate(vault.path);
    if (location === null) {
      this.host.log('the tickets vault is not a git repository — crew.md is not versioned', 'info');
    } else {
      try {
        await this.git.commitPaths(location.root, [`${location.prefix}${CREW_FILE}`], message);
      } catch (error) {
        this.host.log(`git commit of crew.md failed: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      }
    }
    this.host.announceChanges(vault.id, [CREW_FILE]);
  }
}
