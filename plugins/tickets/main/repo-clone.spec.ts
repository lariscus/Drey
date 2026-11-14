import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoCloner } from './repo-clone';
import type { CloneProgress } from './repo-clone-errors';
import type { GitLauncher } from './repo-clone-process';

let parent: string;

beforeEach(() => {
  parent = mkdtempSync(path.join(tmpdir(), 'drey-clone-spec-'));
});

afterEach(() => {
  rmSync(parent, { recursive: true, force: true });
});

interface Script {
  readonly stderr?: string;
  readonly code?: number | null;
  readonly missing?: boolean;
  /** Creates the target the way git does while it works. */
  readonly makesTarget?: boolean;
  /** The process stays until `kill()`. */
  readonly hangs?: boolean;
}

/** A launcher standing in for git: it records the arguments and plays the script. */
function launcherOf(script: Script) {
  const runs: { args: readonly string[]; cwd: string }[] = [];
  let killed = false;
  const launch: GitLauncher = (args, cwd, onStderr) => {
    runs.push({ args, cwd });
    const target = args[args.length - 1]!;
    if (script.makesTarget === true) {
      mkdirSync(path.join(target, '.git'), { recursive: true });
    }
    if (script.stderr !== undefined) {
      onStderr(script.stderr);
    }
    let release: () => void = () => undefined;
    const gate = script.hangs === true ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();
    return {
      done: gate.then(() => ({ code: killed ? null : (script.code ?? 0), stderr: script.stderr ?? '', missing: script.missing === true })),
      kill: () => {
        killed = true;
        release();
      },
    };
  };
  return { launch, runs };
}

describe('RepoCloner (req-304)', () => {
  it('clones into <parent>/<repository name> with git clone --progress and reports the phases', async () => {
    const { launch, runs } = launcherOf({ makesTarget: true, stderr: "Cloning into 'drey'...\rReceiving objects:  50% (5/10)\rReceiving objects: 100% (10/10), done.\n" });
    const seen: CloneProgress[] = [];
    const result = await new RepoCloner(launch).clone({ url: 'https://example.com/owner/drey.git', parent }, (p) => seen.push(p));
    expect(result).toEqual({ ok: true, path: path.join(parent, 'drey'), name: 'drey' });
    expect(runs[0]!.args).toEqual(['-c', 'protocol.ext.allow=never', 'clone', '--progress', '--', 'https://example.com/owner/drey.git', path.join(parent, 'drey')]);
    expect(seen).toEqual([{ phase: 'Receiving objects', percent: 50 }, { phase: 'Receiving objects', percent: 100 }]);
  });

  it('refuses a folder that already holds something, before git runs', async () => {
    mkdirSync(path.join(parent, 'drey'));
    writeFileSync(path.join(parent, 'drey', 'a.txt'), 'x');
    const { launch, runs } = launcherOf({});
    expect(await new RepoCloner(launch).clone({ url: 'https://example.com/drey.git', parent }, () => undefined)).toEqual({ ok: false, code: 'exists', error: path.join(parent, 'drey') });
    expect(runs).toHaveLength(0);
  });

  it('clones into an empty folder that is already there', async () => {
    mkdirSync(path.join(parent, 'drey'));
    const { launch } = launcherOf({});
    expect((await new RepoCloner(launch).clone({ url: 'https://example.com/drey.git', parent }, () => undefined)).ok).toBe(true);
  });

  it('refuses a bad URL and a URL with credentials without starting git', async () => {
    const { launch, runs } = launcherOf({});
    const cloner = new RepoCloner(launch);
    expect(await cloner.clone({ url: 'not a url', parent }, () => undefined)).toMatchObject({ ok: false, code: 'bad_url' });
    expect(await cloner.clone({ url: 'https://me:pw@example.com/a.git', parent }, () => undefined)).toMatchObject({ ok: false, code: 'credentials' });
    expect(runs).toHaveLength(0);
  });

  it('names the failure: login refused, offline, git missing, and clears what a failed clone began', async () => {
    const auth = launcherOf({ makesTarget: true, code: 128, stderr: "fatal: Authentication failed for 'https://example.com/drey.git/'\n" });
    expect(await new RepoCloner(auth.launch).clone({ url: 'https://example.com/drey.git', parent }, () => undefined)).toEqual({ ok: false, code: 'auth', error: "Authentication failed for 'https://example.com/drey.git/'" });
    expect(readdirSync(parent)).toEqual([]);
    const offline = launcherOf({ code: 128, stderr: "fatal: unable to access 'https://example.com/drey.git/': Could not resolve host: example.com\n" });
    expect(await new RepoCloner(offline.launch).clone({ url: 'https://example.com/drey.git', parent }, () => undefined)).toMatchObject({ ok: false, code: 'offline' });
    const nogit = launcherOf({ code: null, missing: true });
    expect(await new RepoCloner(nogit.launch).clone({ url: 'https://example.com/drey.git', parent }, () => undefined)).toMatchObject({ ok: false, code: 'no_git' });
  });

  it('cancels a running clone, removes its folder and takes the next one afterwards', async () => {
    const { launch } = launcherOf({ makesTarget: true, hangs: true });
    const cloner = new RepoCloner(launch);
    const running = cloner.clone({ url: 'https://example.com/drey.git', parent }, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cloner.busy).toBe(true);
    expect(await cloner.clone({ url: 'https://example.com/other.git', parent }, () => undefined)).toMatchObject({ ok: false, code: 'busy' });
    cloner.cancel();
    expect(await running).toMatchObject({ ok: false, code: 'cancelled' });
    expect(readdirSync(parent)).toEqual([]);
    expect(cloner.busy).toBe(false);
  });
});
