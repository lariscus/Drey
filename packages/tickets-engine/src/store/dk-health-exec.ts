import { execFile } from 'node:child_process';
import type { ProbeExec, ProbeResult } from './dk-health';

const PROBE_TIMEOUT_MS = 15_000;

/** The probe's process adapter: `execFile`, no shell, a spawn failure comes back as `failure`. */
export const execProbe: ProbeExec = (bin, args) =>
  new Promise<ProbeResult>((resolve) => {
    execFile(bin, [...args], { timeout: PROBE_TIMEOUT_MS, windowsHide: true, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }, (error, stdout) => {
      if (error === null) {
        resolve({ code: 0, stdout, failure: null });
        return;
      }
      const e = error as NodeJS.ErrnoException & { killed?: boolean };
      if (typeof e.code === 'number') {
        resolve({ code: e.code, stdout, failure: null });
        return;
      }
      resolve({ code: null, stdout, failure: e.killed === true ? 'ETIMEDOUT' : String(e.code ?? e.message) });
    });
  });
