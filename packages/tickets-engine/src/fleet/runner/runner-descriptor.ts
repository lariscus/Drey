import * as fsSync from 'node:fs';
import { promises as fsp } from 'node:fs';
import type { RunnerDescriptor } from '../protocol';

/**
 * `<root>/runner.json` — where the standalone runner is found (port, token,
 * pid, build), and its single-instance guard: a healthy peer keeps a second
 * runner out, a stale descriptor (crashed runner) is taken over. Inside
 * Drey Service the service lock replaces both (req-164).
 */

export async function readDescriptor(descriptorPath: string): Promise<RunnerDescriptor | null> {
  try {
    const parsed = JSON.parse(await fsp.readFile(descriptorPath, 'utf8')) as RunnerDescriptor;
    return typeof parsed.port === 'number' && typeof parsed.token === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export async function peerAlive(peer: RunnerDescriptor): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${peer.port}/health`, {
      headers: { Authorization: `Bearer ${peer.token}` },
      signal: AbortSignal.timeout(1_500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Written once the server listens; readable by the owner only where the platform honours it. */
export function writeDescriptor(descriptorPath: string, descriptor: RunnerDescriptor): void {
  fsSync.writeFileSync(descriptorPath, `${JSON.stringify(descriptor)}\n`, { mode: 0o600 });
}

export function removeDescriptor(descriptorPath: string): void {
  fsSync.rmSync(descriptorPath, { force: true });
}
