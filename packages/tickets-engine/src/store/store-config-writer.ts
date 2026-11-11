import { execFile } from 'node:child_process';

/**
 * Commits a new `dricket.toml` to a LOCAL store's `main` branch (req-265; Q-05's exception: the engine
 * writes the store's config only for the stage migration, on the owner's confirmation — the store
 * creation of E14-9b will be the second user of this class). Plain git plumbing in the store's
 * directory: the blob, a tree with the one file replaced, a commit on `main`, and a compare-and-swap
 * `update-ref`. The ticket checkout (the store's working tree on the ticket branch) is never touched,
 * and nothing is pushed.
 */

/** One git call, optionally with stdin; resolves stdout (trimmed), rejects with git's message. */
export type GitPlumbingRun = (args: readonly string[], cwd: string, input?: string) => Promise<string>;

export const defaultGitPlumbing: GitPlumbingRun = (args, cwd, input) =>
  new Promise<string>((resolve, reject) => {
    const child = execFile('git', [...args], { cwd, windowsHide: true, timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(String(stderr).trim() || error.message));
      } else {
        resolve(String(stdout).trim());
      }
    });
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });

const MAIN = 'refs/heads/main';
const CONFIG_FILE = 'dricket.toml';

export class StoreConfigWriter {
  constructor(
    /** The local store's directory (a git repository whose `main` holds `dricket.toml`). */
    private readonly dir: string,
    private readonly git: GitPlumbingRun = defaultGitPlumbing,
  ) {}

  /** Null when the config can be committed here, else why not (the owner then edits the file by hand). */
  async refusal(): Promise<string | null> {
    try {
      await this.git(['rev-parse', '--verify', '--quiet', MAIN], this.dir);
    } catch {
      return 'the store has no local main branch (a remote store: dricket.toml is edited there)';
    }
    const head = await this.git(['symbolic-ref', '-q', 'HEAD'], this.dir).catch(() => '');
    if (head === MAIN) {
      return 'main is checked out in the store directory; check out the ticket branch first';
    }
    return null;
  }

  /** One commit on `main` replacing `dricket.toml` with `text`; throws when `main` moved meanwhile or git refuses. */
  async commit(text: string, message: string): Promise<string> {
    const refusal = await this.refusal();
    if (refusal !== null) {
      throw new Error(refusal);
    }
    const parent = await this.git(['rev-parse', '--verify', MAIN], this.dir);
    const blob = await this.git(['hash-object', '-w', '--stdin'], this.dir, text);
    const entries = (await this.git(['ls-tree', parent], this.dir))
      .split('\n')
      .filter((line) => line !== '' && !line.endsWith(`\t${CONFIG_FILE}`));
    const tree = await this.git(['mktree'], this.dir, [...entries, `100644 blob ${blob}\t${CONFIG_FILE}`].join('\n') + '\n');
    const commit = await this.git(['commit-tree', tree, '-p', parent, '-m', message], this.dir);
    await this.git(['update-ref', MAIN, commit, parent], this.dir);
    return commit;
  }
}
