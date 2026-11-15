import * as os from 'node:os';
import { describe, expect, it } from 'vitest';
import { processAlive } from './procs';
import { execShell, probeExec } from './shell-exec';

describe('probeExec — the process probes keep their arguments apart', () => {
  it('hands an argument with spaces over as one argument (no shell re-parsing)', async () => {
    const out = await probeExec(os.tmpdir())(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'PID eq 42']);
    expect(out).toBe('PID eq 42');
  });

  it('sees a live pid as alive and an impossible one as gone', async () => {
    const exec = probeExec(os.tmpdir());
    expect(await processAlive(process.pid, exec)).toBe(true);
    expect(await processAlive(2_147_483_000, exec)).toBe(false);
  });
});

describe('execShell — the gate shell', () => {
  it('resolves on exit 0 and rejects with the output on a failure', async () => {
    await expect(execShell('exit 0', os.tmpdir())).resolves.toBeUndefined();
    await expect(execShell('echo boom && exit 3', os.tmpdir())).rejects.toMatchObject({
      stdout: expect.stringContaining('boom'),
    });
  });
});
