import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeShared } from '../compose-supervisor';
import { drainSupervisors, settled } from '../orchestrate/run-spec-support';
import { harness, planStore, runRequest } from '../orchestrate/supervisor-harness.fake';
import type { RunnerEvent } from '../ports/event-sink';
import { EventHub } from './event-hub';
import { EventStream, sseFrame } from './event-stream';
import type { EventChannel, RouteContext } from './route-context';

/**
 * The runner's event stream (req-176 step 5): the core publishes a run's
 * record when it is persisted and every stream line when it is written;
 * `GET /events` sends them as server-sent events.
 */

function channel(): EventChannel & { written: string[]; ended: boolean; close: () => void } {
  const closers: Array<() => void> = [];
  const ch = {
    written: [] as string[],
    ended: false,
    write: (text: string) => ch.written.push(text),
    end: () => {
      ch.ended = true;
      closers.forEach((cb) => cb());
    },
    onClose: (cb: () => void) => closers.push(cb),
    close: () => closers.forEach((cb) => cb()),
  };
  return ch;
}

function ctx(method: string, pathname: string, ch: EventChannel): RouteContext {
  return { method, pathname, parts: pathname.split('/').filter((p) => p !== ''), search: new URLSearchParams(), body: async () => ({}), respond: () => undefined, raw: () => undefined, stream: () => ch };
}

const LINE: RunnerEvent = { kind: 'line', runId: 'R-1', event: { ts: 't', kind: 'note', text: 'gate: npm test' } };

describe('EventHub', () => {
  it('fans out to every listener until it unsubscribes, and drops one that throws', () => {
    const hub = new EventHub();
    const seen: string[] = [];
    const off = hub.subscribe((e) => seen.push(`a:${e.kind}`));
    hub.subscribe(() => {
      throw new Error('broken listener');
    });
    hub.publish(LINE);
    expect(seen).toEqual(['a:line']);
    expect(hub.size).toBe(1);
    off();
    hub.publish(LINE);
    expect(seen).toEqual(['a:line']);
  });
});

describe('GET /events', () => {
  afterEach(() => vi.useRealTimers());

  it('opens with the retry hint, sends each event as a frame and stops listening when the client goes', async () => {
    const hub = new EventHub();
    const route = new EventStream(hub);
    const ch = channel();
    expect(await route.handle(ctx('GET', '/events', ch))).toBe(true);
    hub.publish(LINE);
    expect(ch.written).toEqual(['retry: 3000\n\n', sseFrame(LINE)]);
    expect(sseFrame(LINE)).toBe('event: line\ndata: {"runId":"R-1","event":{"ts":"t","kind":"note","text":"gate: npm test"}}\n\n');
    ch.close();
    expect(hub.size).toBe(0);
  });

  it('beats while quiet, answers no other route, and ends every stream when the runner goes', async () => {
    vi.useFakeTimers();
    const hub = new EventHub();
    const route = new EventStream(hub, 1_000);
    const ch = channel();
    expect(await route.handle(ctx('POST', '/events', ch))).toBe(false);
    expect(await route.handle(ctx('GET', '/status', ch))).toBe(false);
    await route.handle(ctx('GET', '/events', ch));
    vi.advanceTimersByTime(2_000);
    expect(ch.written.filter((w) => w === ': ping\n\n')).toHaveLength(2);
    route.closeAll();
    expect(ch.ended).toBe(true);
    expect(hub.size).toBe(0);
  });
});

describe('the core publishes', () => {
  let root = '';
  let vault = '';
  afterEach(async () => {
    await drainSupervisors();
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(vault, { recursive: true, force: true });
  });

  it("a run's records and its stream lines, in order, as the run goes", async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-fleet-'));
    vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-vault-'));
    const hub = new EventHub();
    const events: RunnerEvent[] = [];
    hub.subscribe((e) => events.push(e));
    const store = planStore();
    const shared = composeShared(() => store, () => undefined, () => new Date('2026-10-17T12:00:00Z'), { sink: hub });
    const { sup, adapter } = harness(root, { shared }, store);
    const started = await sup.start(runRequest(vault));
    const id = (started as { run: { id: string } }).run.id;
    adapter.handles[0]!.result();
    adapter.handles[0]!.fail(0);
    await settled(sup, id, 'done');
    const states = events.filter((e): e is Extract<RunnerEvent, { kind: 'run' }> => e.kind === 'run').map((e) => e.info.state);
    expect(states[0]).toBe('running');
    expect(states.at(-1)).toBe('done');
    const lines = events.filter((e): e is Extract<RunnerEvent, { kind: 'line' }> => e.kind === 'line').map((e) => e.event.text);
    expect(lines[0]).toContain(`run ${id} for T-0001`);
    expect(lines).toContain('gate: npm run verify:unit');
    expect(lines).toContain('run finished (exit 0)');
  });
});
