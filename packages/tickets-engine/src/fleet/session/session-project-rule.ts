/**
 * Which project a free session works in (req-283, concept §2): the one the
 * owner picked, or — with none picked — its folder's: the one project whose
 * repository's checkout (`repos.md` `path:`) holds the directory. No project,
 * or more than one, naming such a repository leaves the session without a
 * project, and so without a vault. A picked project the board does not know
 * refuses the start. Pure — the caller reads the records and `repos.md`.
 */
import type { ProjectRecord } from '../../contracts/projects';

export interface SessionProjectInput {
  /** The project the owner picked; absent/blank = the folder decides. */
  readonly picked?: string | null;
  /** Absolute, already checked by the directory rule. */
  readonly directory: string;
  readonly projects: readonly Pick<ProjectRecord, 'id' | 'repos'>[];
  /** `repos.md`'s entries; a repository without a local checkout has no path. */
  readonly repos: readonly { readonly name: string; readonly path: string | null }[];
}

export type SessionProjectVerdict = { readonly ok: true; readonly project: string | null } | { readonly ok: false; readonly error: string };

/** A path compared the way Windows and POSIX folders both match: forward slashes, no trailing slash, case folded. */
function comparable(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export class SessionProjectRule {
  pick(input: SessionProjectInput): SessionProjectVerdict {
    const picked = input.picked?.trim() ?? '';
    if (picked !== '') {
      return input.projects.some((p) => p.id === picked) ? { ok: true, project: picked } : { ok: false, error: `project "${picked}" not found` };
    }
    return { ok: true, project: this.folderProject(input) };
  }

  /** The one project naming a repository whose checkout holds the directory; null for none or several. */
  private folderProject(input: SessionProjectInput): string | null {
    const dir = comparable(input.directory);
    const holding = new Set(
      input.repos
        .filter((repo) => repo.path !== null && repo.path.trim() !== '')
        .filter((repo) => {
          const root = comparable(repo.path!);
          return dir === root || dir.startsWith(`${root}/`);
        })
        .map((repo) => repo.name),
    );
    const projects = input.projects.filter((p) => p.repos.some((name) => holding.has(name)));
    return projects.length === 1 ? projects[0]!.id : null;
  }
}
