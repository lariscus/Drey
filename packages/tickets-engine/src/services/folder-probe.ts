/**
 * What a folder the owner picked is (req-304): a git repository — its root,
 * or any folder inside one — or a plain folder. Everything goes through the
 * installed git over the `TicketsGit` seam (`rev-parse`, the `origin` remote,
 * the branch); a folder git does not know is plain, and one that is not
 * there is missing.
 */
import * as path from 'node:path';
import type { RepoSeed } from '../core/repo-entry';

/** The git seam — `TicketsGit.run` (one queue per working directory). */
export type FolderProbeGit = (cwd: string, args: readonly string[]) => Promise<string>;

export type FolderProbeResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'plain'; readonly path: string }
  | { readonly kind: 'repository'; readonly seed: RepoSeed };

export interface FolderProbeDeps {
  readonly git: FolderProbeGit;
  readonly isDirectory: (folder: string) => Promise<boolean>;
}

export class FolderProbe {
  constructor(private readonly deps: FolderProbeDeps) {}

  async probe(folder: string): Promise<FolderProbeResult> {
    if (!(await this.deps.isDirectory(folder))) {
      return { kind: 'missing' };
    }
    const root = await this.read(folder, ['rev-parse', '--show-toplevel']);
    if (root === null) {
      return { kind: 'plain', path: folder };
    }
    const url = await this.read(root, ['remote', 'get-url', 'origin']);
    const branch = await this.read(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return {
      kind: 'repository',
      seed: { name: path.basename(root), url: url ?? root, branch: branch === null || branch === 'HEAD' ? null : branch, path: root },
    };
  }

  /** One git probe: trimmed stdout, or null when git fails or answers nothing (no remote, no commit, not a repository). */
  private async read(cwd: string, args: readonly string[]): Promise<string | null> {
    try {
      const out = (await this.deps.git(cwd, args)).trim();
      return out === '' ? null : out;
    } catch {
      return null;
    }
  }
}
