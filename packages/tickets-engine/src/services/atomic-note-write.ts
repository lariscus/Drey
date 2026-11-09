/**
 * The vault-grade atomic write the engine's own writers share — the Notes API
 * (req-100) and Drey Service's vault MCP (req-167): a temp file beside the
 * target, flushed, renamed over it; a sync client or a crash sees the old note
 * or the new one, never half of it. The same steps as Drey's
 * `electron/safe-file.ts`, which the engine may not import. The temp name
 * starts with a dot, so nothing that lists notes sees it.
 */
import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';

const RENAME_RETRY_DELAYS_MS = [10, 40, 120];
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

/** Writes `text` to `target` atomically; a target another program keeps locked falls back to a plain write. */
export async function atomicWrite(target: string, text: string): Promise<void> {
  const real = await fsp.realpath(target).catch(() => target);
  const existing = await fsp.stat(real).catch(() => null);
  const tmp = path.join(path.dirname(real), `.${path.basename(real)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    const handle = await fsp.open(tmp, 'wx', existing === null ? undefined : existing.mode & 0o777);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await fsp.rename(tmp, real);
        return;
      } catch (error) {
        const delay = RENAME_RETRY_DELAYS_MS[attempt];
        if (delay === undefined || !TRANSIENT_RENAME_CODES.has(errorCode(error) ?? '')) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  } catch {
    // A target another program keeps locked: a plain write still succeeds or reports why.
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    await fsp.writeFile(real, text, 'utf8');
  }
}
