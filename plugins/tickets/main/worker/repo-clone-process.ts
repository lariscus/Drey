/**
 * The installed `git` as a child process for a clone (req-304): no shell
 * (the arguments reach git as they are), no terminal prompt (a credential
 * helper or the ssh agent answers, or git fails with its own message), no
 * timeout — a clone over a slow link takes minutes and the owner cancels
 * instead (the ADR-0014 stance). Cancelling kills the process tree, on
 * Windows through `taskkill /T`, because git starts helpers
 * (`git-remote-https`) a plain kill would orphan.
 */
import { spawn, type ChildProcess } from 'node:child_process';

export interface GitProcess {
  /** Resolves when git exits: its code (null when killed) and everything it wrote to stderr. */
  readonly done: Promise<{ readonly code: number | null; readonly stderr: string; readonly missing: boolean }>;
  kill(): void;
}

/** Starts git with `args` in `cwd`; `onStderr` gets each chunk as it arrives. */
export type GitLauncher = (args: readonly string[], cwd: string, onStderr: (chunk: string) => void) => GitProcess;

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
  } else {
    child.kill();
  }
}

export const launchGit: GitLauncher = (args, cwd, onStderr) => {
  const child = spawn('git', [...args], { cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
    onStderr(chunk);
  });
  const done = new Promise<{ code: number | null; stderr: string; missing: boolean }>((resolve) => {
    child.once('error', (error) => resolve({ code: null, stderr, missing: (error as NodeJS.ErrnoException).code === 'ENOENT' }));
    child.once('close', (code) => resolve({ code, stderr, missing: false }));
  });
  return { done, kill: () => killTree(child) };
};
