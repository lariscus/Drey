/**
 * The runner's process execs on the machine (ADR-0096: Node lives at the
 * edge, the core takes these as injected functions): the process probes,
 * the gate's shell and the trailer check.
 */
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { promisify } from 'node:util';
import { capTail, SANITY_CAP } from './capping';
import type { GateShellOptions } from './orchestrate/gate-runner';
import type { ExecFn } from './procs';
import type { RunDkTarget } from './protocol';

const execFileAsync = promisify(nodeExecFile);

const SHELL_TIMEOUT_MS = 30 * 60_000;
/** The output tail a failed gate command keeps for its failure text. */
const SHELL_OUTPUT_KEEP = 256 * 1024;

/**
 * The process probes' exec (liveness, start time): the program and its
 * arguments stay separate — no shell, no re-parsing. Joining them broke
 * `tasklist /FI "PID eq 42"`: every live worker looked dead and the lease
 * reaper killed healthy runs.
 */
export const probeExec =
  (cwd: string): ExecFn =>
  async (cmd, args) => {
    const { stdout } = await execFileAsync(cmd, [...args], { cwd, windowsHide: true });
    return stdout;
  };

/** Ends a timed-out command's whole tree: `exec`'s own timeout killed only the shell on Windows. */
function killTree(pid: number | undefined, kill: () => void): void {
  if (process.platform === 'win32' && pid !== undefined) {
    nodeExecFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => undefined);
  } else {
    kill();
  }
}

/**
 * The gate's shell exec — the owner's commands run with a shell, 30
 * minutes each; the orchestrator's `ci` check uses the same. A spawn keeps
 * just the output's tail (`exec` capped its buffer at 1 MB and a chatty
 * passing command failed the gate) and kills the whole tree on the timeout.
 * The governor's seat (req-180) adds its environment and learns the pid at
 * once, so the shell drops to low priority before it starts its children.
 */
export const execShell = (command: string, cwd: string, opts: GateShellOptions = {}): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const env = opts.env === undefined ? undefined : { ...process.env, ...opts.env };
    const child = nodeSpawn(command, { cwd, shell: true, windowsHide: true, ...(env !== undefined ? { env } : {}) });
    if (child.pid !== undefined) {
      opts.onSpawn?.(child.pid);
    }
    let output = '';
    const keep = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      if (output.length > 2 * SHELL_OUTPUT_KEEP) {
        output = output.slice(-SHELL_OUTPUT_KEEP);
      }
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, () => child.kill('SIGKILL'));
    }, SHELL_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) {
        resolve();
        return;
      }
      const why = timedOut ? `timed out after ${SHELL_TIMEOUT_MS / 60_000} minutes` : `exited with code ${code ?? 'signal'}`;
      reject(Object.assign(new Error(`Command failed: ${command} — ${why}`), { stdout: output.trim(), code }));
    });
  });

/** `dk validate --trailers <range>` inside the worktree; null = passes, else the output. */
export async function validateTrailers(target: RunDkTarget, worktree: string, range: string): Promise<string | null> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (target.dataDir !== '') {
    env['DK_DATA_DIR'] = target.dataDir;
  }
  try {
    await execFileAsync(target.bin === '' ? 'dk' : target.bin, ['--store', target.store, 'validate', '--trailers', range], { cwd: worktree, env, maxBuffer: 4 * 1024 * 1024 });
    return null;
  } catch (error) {
    const out = error as { stdout?: string; stderr?: string; message?: string };
    return capTail(`${out.stdout ?? ''}${out.stderr ?? ''}`.trim() || (out.message ?? 'failed'), SANITY_CAP).text;
  }
}
