import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startRunner, type RunnerHandle } from './runner';

/**
 * `GET /events` on the real daemon, in-process (req-176 step 5): bearer
 * auth like every route, the event-stream content type and the opening
 * frame, and the stream ends when the runner stops — a server close would
 * otherwise wait for it.
 */

describe('the runner event stream over HTTP', () => {
  let root = '';
  let runner: RunnerHandle | null = null;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-runner-'));
    runner = await startRunner({ root: path.join(root, 'fleet'), idleMs: 60 * 60_000 }, { exit: () => undefined, stdout: () => undefined, signals: false });
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  it('refuses a request without the token', async () => {
    const res = await fetch(`http://127.0.0.1:${runner!.port}/events`);
    expect(res.status).toBe(401);
    await res.text();
    await runner!.stop();
  });

  it('opens a server-sent event stream, and the runner stop ends it', async () => {
    const res = await fetch(`http://127.0.0.1:${runner!.port}/events`, { headers: { Authorization: `Bearer ${runner!.token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('retry: 3000\n\n');
    await runner!.stop();
    let done = false;
    while (!done) {
      done = (await reader.read()).done;
    }
    expect(done).toBe(true);
  });
});
