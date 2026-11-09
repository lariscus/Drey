import { PERSONAS_DIR, personaRef } from '../core/persona';
import type { RepoLocation, TicketsGit } from '../core/tickets-git';
import type { EngineVault } from './host';

/** The board as the commit ages need it: where the tickets vault is. */
export interface CommitAgeBoard {
  detect(): Promise<EngineVault | null>;
}

/** The slice of the git plumbing the read uses. */
export type CommitAgeGit = Pick<TicketsGit, 'locate' | 'run'>;

interface Known {
  readonly head: string;
  readonly at: string | null;
}

/**
 * When `personas/<id>/` was last committed (req-239, the Persona page's
 * `Saved · committed 2 days ago`): one `git log -1 --format=%cI` per
 * persona folder. The Crew list asks on every board change, so the answer
 * is kept per persona until `HEAD` moves — a quiet repository costs one
 * `rev-parse` per ask. A vault outside git, or a persona with no commit
 * yet, has no age; a failing git leaves the persona out and never fails
 * the list.
 */
export class PersonaCommitAges {
  private readonly known = new Map<string, Known>();
  private location: { readonly path: string; readonly value: RepoLocation | null } | null = null;

  constructor(
    private readonly board: CommitAgeBoard,
    private readonly git: CommitAgeGit,
  ) {}

  /** The ISO committer date per persona id; a persona without a known commit is absent. */
  async of(personaIds: readonly string[]): Promise<Readonly<Record<string, string>>> {
    const vault = await this.board.detect();
    if (vault === null) {
      return {};
    }
    const location = await this.locationOf(vault.path);
    if (location === null) {
      return {};
    }
    let head: string;
    try {
      head = (await this.git.run(location.root, ['rev-parse', 'HEAD'])).trim();
    } catch {
      return {}; // an empty repository: nothing committed yet
    }
    const ages: Record<string, string> = {};
    for (const id of personaIds) {
      const at = await this.ageOf(location, head, id);
      if (at !== null) {
        ages[id] = at;
      }
    }
    return ages;
  }

  private async ageOf(location: RepoLocation, head: string, id: string): Promise<string | null> {
    const key = `${location.root}\n${id}`;
    const cached = this.known.get(key);
    if (cached !== undefined && cached.head === head) {
      return cached.at;
    }
    let at: string | null = null;
    try {
      const dir = `${location.prefix}${PERSONAS_DIR}/${personaRef(id)}`;
      const out = (await this.git.run(location.root, ['log', '-1', '--format=%cI', '--', dir])).trim();
      at = out === '' || Number.isNaN(Date.parse(out)) ? null : out;
    } catch {
      return null;
    }
    this.known.set(key, { head, at });
    return at;
  }

  private async locationOf(vaultPath: string): Promise<RepoLocation | null> {
    if (this.location?.path === vaultPath && this.location.value !== null) {
      return this.location.value;
    }
    const value = await this.git.locate(vaultPath);
    this.location = { path: vaultPath, value };
    return value;
  }
}
