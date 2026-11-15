import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nodeSpawnFn } from '../runner/procs';
import type { NormalizedEvent, ProviderAdapter, ProviderStart, WorkerHandle } from './contract';
import { copilotAdapter } from './copilot';
import { opencodeAdapter } from './opencode';

/**
 * The ACP harnesses against the real CLIs (req-182). Each block skips when
 * its CLI is not installed. The protocol cases — the session opens, the
 * read-only mode is taken, a running turn is interrupted, the session is
 * resumed — run in a temporary data home (opencode's `XDG_DATA_HOME`,
 * Copilot's `COPILOT_HOME`), never the owner's. The cases that need the
 * model to call tools (a permission, a question form, usage) run only when
 * `DREY_LIVE_ACP_MODEL` names a model (e.g. `opencode/big-pickle`).
 */

function installed(cmd: string): boolean {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

const LIVE_MODEL = process.env['DREY_LIVE_ACP_MODEL'] ?? '';
const homes: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'drey-acp-live-'));
  homes.push(dir);
  return dir;
}

afterAll(() => homes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

async function waitFor(what: string, test: () => boolean, ms = 45_000): Promise<void> {
  const until = Date.now() + ms;
  while (!test()) {
    if (Date.now() > until) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

interface Live {
  readonly handle: WorkerHandle;
  readonly events: NormalizedEvent[];
  ref(): string | null;
  resumeFailed(): string | null;
}

function spawn(adapter: ProviderAdapter, over: Partial<ProviderStart> & Pick<ProviderStart, 'cwd' | 'env'>): Live {
  const events: NormalizedEvent[] = [];
  let ref: string | null = null;
  let failed: string | null = null;
  const handle = adapter.spawn({
    instruction: 'Reply with the single word OK.',
    model: null,
    permissionMode: 'accept-edits',
    resumeRef: null,
    ticketId: 'T-LIVE',
    onEvent: (e) => events.push(e),
    onSessionRef: (r) => (ref = r),
    onResumeFailed: (reason) => (failed = reason),
    ...over,
  });
  return { handle, events, ref: () => ref, resumeFailed: () => failed };
}

/** Starts a turn and interrupts it at once: the session stays, the worker lives. */
async function openAndInterrupt(live: Live): Promise<void> {
  await waitFor('the session', () => live.ref() !== null || live.resumeFailed() !== null);
  expect(live.resumeFailed()).toBeNull();
  await waitFor('the busy turn', () => live.events.some((e) => e.turn === 'busy'));
  expect(await live.handle.interrupt?.()).toBe(true);
  await waitFor('the idle turn', () => live.events.some((e) => e.turn === 'idle'));
  expect(live.events.filter((e) => e.kind === 'error')).toEqual([]);
}

describe.skipIf(!installed('opencode'))('opencode over ACP, live (req-182)', { timeout: 120_000 }, () => {
  const data = tempHome();
  const cwd = tempHome();
  const env = { XDG_DATA_HOME: data };
  let sessionRef: string | null = null;

  it('opens a read-only session, interrupts its turn with session/cancel and keeps the worker', async () => {
    const live = spawn(opencodeAdapter(nodeSpawnFn()), { cwd, env, permissionMode: 'read-only' });
    await openAndInterrupt(live);
    sessionRef = live.ref();
    await live.handle.stop();
  });

  it('resumes that session (session/resume)', async () => {
    expect(sessionRef).not.toBeNull();
    const live = spawn(opencodeAdapter(nodeSpawnFn()), { cwd, env, resumeRef: sessionRef });
    await openAndInterrupt(live);
    expect(live.ref()).toBe(sessionRef);
    await live.handle.stop();
  });

  it.skipIf(LIVE_MODEL === '')('carries a permission request, a question form and the turn usage', async () => {
    const live = spawn(opencodeAdapter(nodeSpawnFn()), {
      cwd,
      env: { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { bash: 'ask' } }) },
      model: LIVE_MODEL,
      instruction: 'Use your bash tool to run: echo live-ok . Then use your question tool to ask me whether I prefer red or blue. Then reply with the colour I picked.',
    });
    const wait = (kind: 'permission' | 'question'): NonNullable<NormalizedEvent['waiting']> | undefined => [...live.events].reverse().find((e) => e.waiting?.kind === kind)?.waiting ?? undefined;
    await waitFor('the permission', () => wait('permission') !== undefined, 90_000);
    expect(await live.handle.answerPermission?.(wait('permission')!.requestId!, 'once')).toBe(true);
    await waitFor('the question', () => wait('question') !== undefined, 90_000);
    expect(await live.handle.answerQuestion?.(wait('question')!.requestId!, { q0: 'Blue' })).toBe(true);
    await waitFor('the result', () => live.events.some((e) => e.kind === 'result'), 90_000);
    const result = live.events.find((e) => e.kind === 'result')!;
    expect(result.text?.toLowerCase()).toContain('blue');
    expect(result.tokensIn ?? 0).toBeGreaterThan(0);
    await live.handle.stop();
  });
});

describe.skipIf(!installed('copilot'))('Copilot CLI over ACP, live (req-182)', { timeout: 120_000 }, () => {
  it('opens a session and interrupts its turn with session/cancel', async () => {
    const live = spawn(copilotAdapter(nodeSpawnFn()), { cwd: tempHome(), env: { COPILOT_HOME: process.env['COPILOT_HOME'] ?? path.join(os.homedir(), '.copilot') } });
    await openAndInterrupt(live);
    await live.handle.stop();
  });
});
