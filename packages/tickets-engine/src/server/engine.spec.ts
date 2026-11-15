import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEngine, type Engine } from './engine';

/**
 * E2b acceptance: the standalone engine hosts the whole service surface
 * over the loopback invoke channel — snapshot, mutations with the one
 * git-commit discipline, config sync, live events — against a real
 * tickets vault on disk, with no Drey in the picture.
 */

const PIPELINE = `---
phases:
  - { id: inbox, title: Inbox, handover: manual }
  - { id: build, title: Build, wip: 3, claim: true, handover: agent build-default }
  - { id: done, title: Done, handover: none }
---
The pipeline.
`;

let root: string;
let vault: string;
let home: string;
let engine: Engine;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(tmpdir(), 'tickets-engine-'));
  vault = path.join(root, 'vault');
  home = path.join(root, 'home');
  await fsp.mkdir(path.join(vault, 'tickets/_meta'), { recursive: true });
  await fsp.mkdir(path.join(root, 'client'), { recursive: true });
  await fsp.mkdir(home, { recursive: true });
  await fsp.writeFile(path.join(vault, 'tickets/_meta/pipeline.md'), PIPELINE, 'utf8');
  await gitInitVault();
  // The pair-status specs read `pairing.deviceName` — the remote must be
  // on (or the status hides the pairing view behind `config.enabled`).
  await fsp.writeFile(path.join(home, 'config.json'), JSON.stringify({ 'remote.enabled': true }), 'utf8');
  // These specs count commits and personas: the default crew's seeding (req-256) has its own spec, engine-crew-seed.spec.ts.
  engine = await createEngine({ vaultPath: vault, home, clientDir: path.join(root, 'client'), log: () => undefined, seedDefaultCrew: false });
});

afterEach(async () => {
  await engine.close();
  // A just-exited dk/git child can hold the fresh-install store's directory a moment on Windows.
  await fsp.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }).catch(() => undefined);
});

describe('createEngine', () => {
  it('health-checks and exposes the invoke channel with a bearer token', async () => {
    const response = await fetch(`${engine.invokeUrl}/api/health`, {
      headers: { authorization: `Bearer ${engine.token}` },
    });
    expect(response.status).toBe(200);
    const unauthenticated = await fetch(`${engine.invokeUrl}/api/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'snapshot' }),
    });
    expect(unauthenticated.status).toBe(401);
  });

  it('closes while a Drey holds its event stream open (Settings → Background service › Stop)', async () => {
    const controller = new AbortController();
    const response = await fetch(`${engine.invokeUrl}/api/events`, {
      headers: { authorization: `Bearer ${engine.token}` },
      signal: controller.signal,
    });
    expect(response.ok).toBe(true);
    await (response.body as ReadableStream<Uint8Array>).getReader().read();
    const closed = await Promise.race([engine.close().then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000))]);
    controller.abort();
    expect(closed).toBe(true);
  });

  it('assembles a snapshot from the vault files', async () => {
    const snapshot = (await engine.invoke('snapshot')) as { vaultName: string | null; pipeline: readonly { id: string }[] };
    expect(snapshot.vaultName).toBe('vault');
    expect(snapshot.pipeline.map((p) => p.id)).toEqual(['inbox', 'build', 'done']);
  });

  it('serves the notes of the vault the config names, and reports a save on the paths channel (req-100)', async () => {
    const notesVault = path.join(root, 'notes');
    await fsp.mkdir(notesVault, { recursive: true });
    await fsp.writeFile(path.join(notesVault, 'a.md'), 'in the active vault', 'utf8');
    await fsp.writeFile(path.join(vault, 'hosted.md'), 'in the hosted vault', 'utf8');
    const status = (await engine.invoke('configure', { port: 40000 + Math.floor(Math.random() * 20000) })) as { listening: string | null };
    const client = (await engine.invoke('localClient', { name: 'Test' })) as { token: string };
    const base = `http://${status.listening}`;
    const headers = { authorization: `Bearer ${client.token}`, 'content-type': 'application/json' };
    const names = async (): Promise<string[]> => {
      const reply = (await (await fetch(`${base}/api/notes`, { headers })).json()) as { notes: { path: string }[] };
      return reply.notes.map((note) => note.path);
    };

    // Without the key it is the hosted vault, and its tickets/ stays out of the answer.
    expect(await names()).toEqual(['hosted.md']);
    await engine.invoke('configSet', { key: 'notes.vaultPath', value: notesVault });
    expect(await names()).toEqual(['a.md']);

    const reports: { vaultPath: string; changed: readonly string[] }[] = [];
    const off = engine.onPaths((change) => reports.push(change));
    const read = (await (await fetch(`${base}/api/notes/note?path=a.md`, { headers })).json()) as { mtime: number };
    const saved = await fetch(`${base}/api/notes/note`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: 'a.md', text: 'edited', baseMtime: read.mtime }),
    });
    off();
    expect(saved.status).toBe(200);
    expect(await fsp.readFile(path.join(notesVault, 'a.md'), 'utf8')).toBe('edited');
    expect(reports).toEqual([{ vaultPath: notesVault, changed: ['a.md'], deleted: [] }]);
  });

  it('round-trips config through the sync channel', async () => {
    await engine.invoke('configSet', { key: 'defaultWorker', value: 'claude-code' });
    expect(await engine.invoke('configGet', { key: 'defaultWorker' })).toBe('claude-code');
  });

  it('serves chainRefusal on the invoke channel (D-26: the plugin asks it before Run the chain)', async () => {
    // req-315: every board's store is anchored beside it — the refusal that
    // remains is a remote store without a checkout.
    await engine.invoke('configSet', { key: 'dk.store', value: 'https://example.invalid/t.git#tickets' });
    expect(await engine.invoke('chainRefusal')).toContain('checkout');
  });

  it('refuses unknown methods and survives their error', async () => {
    const response = await fetch(`${engine.invokeUrl}/api/invoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${engine.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'locate' }),
    });
    expect(response.status).toBe(404);
    // The channel is still alive afterwards.
    expect(await engine.invoke('configGet', { key: 'missing' })).toBeUndefined();
  });

  it('streams live events over the SSE channel', async () => {
    const events: string[] = [];
    const unsubscribe = engine.onEvent((what) => events.push(what));
    await engine.invoke('createTicket', { title: 'Live', priority: 'high', repo: null, description: '' });
    const deadline = Date.now() + 3_000;
    while (!events.includes('board') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    unsubscribe();
    expect(events).toContain('board');
  });
});

const PIA_PERSONA = `---
title: Pia
role: builder
worker: claude-code
models:
  default: opus
  pool: [opus, sonnet]
  router: off
color: '#a78bfa'
skills: []
---
Who Pia is.
`;

const LEGACY_PIPELINE = `---
phases:
  - { id: inbox, title: Inbox, handover: manual }
  - { id: build, title: Build, wip: 3, claim: true, handover: agent build-default, worker: opencode, model: opus, prompt: build-v2 }
  - { id: done, title: Done, handover: none }
---
The pipeline.
`;

const execFileAsync = promisify(execFile);

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'user.name=spec', '-c', 'user.email=spec@example.com', ...args], {
    cwd: vault,
  });
  return stdout;
}

async function gitInitVault(): Promise<void> {
  await git(['init', '-b', 'main']);
  await git(['config', 'user.name', 'spec']);
  await git(['config', 'user.email', 'spec@example.com']);
}

/**
 * Drey quit (req-110): the engine outlives Drey, so the plugin's event
 * stream closing is its signal — once the last one has been gone for the
 * grace span it asks the runner to retire if idle, over the runner's own
 * loopback route. A fake runner stands in; the real verdict is runner.spec's.
 */
describe('Drey gone → the runner is asked to retire (req-110)', () => {
  let runner: http.Server;
  const asked: string[] = [];

  beforeEach(async () => {
    asked.length = 0;
    runner = http.createServer((req, res) => {
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/health') {
        send(200, { ok: true, live: 0 });
      } else if (req.url === '/retire-if-idle' && req.method === 'POST') {
        asked.push(req.headers.authorization ?? '');
        send(200, { ok: true, exiting: true });
      } else {
        send(404, { ok: false });
      }
    });
    await new Promise<void>((resolve) => runner.listen(0, '127.0.0.1', resolve));
    const port = (runner.address() as AddressInfo).port;
    // The runner component's endpoint (req-164: the service hands its locator in).
    const descriptor = { port, token: 'rt', pid: 1, startedAt: '', version: 1 };
    const runnerLocator = { current: async () => descriptor, wake: async () => ({ ok: true as const, descriptor }) };
    await engine.close();
    engine = await createEngine({ vaultPath: vault, home, clientDir: path.join(root, 'client'), log: () => undefined, seedDefaultCrew: false, dreyGoneGraceMs: 150, runner: runnerLocator });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => runner.close(() => resolve()));
  });

  const openStream = async (): Promise<AbortController> => {
    const controller = new AbortController();
    const response = await fetch(`${engine.invokeUrl}/api/events`, {
      headers: { authorization: `Bearer ${engine.token}` },
      signal: controller.signal,
    });
    expect(response.ok).toBe(true);
    // The first frame (`: connected`) — the server has attached the stream.
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    void reader.read().catch(() => undefined);
    return controller;
  };

  const askedWithin = async (ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (asked.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return asked.length > 0;
  };

  it('asks once the last event stream has been closed for the grace span — with the runner\'s token', async () => {
    const stream = await openStream();
    stream.abort();
    expect(await askedWithin(3_000)).toBe(true);
    expect(asked).toEqual(['Bearer rt']);
  });

  it('a second Drey instance still on its stream keeps the runner', async () => {
    const first = await openStream();
    const second = await openStream();
    first.abort();
    expect(await askedWithin(600)).toBe(false);
    second.abort();
    expect(await askedWithin(3_000)).toBe(true);
  });

  it('serves retireIfIdle on the invoke channel for the plugin\'s own ask at deactivate', async () => {
    expect(await engine.invoke('retireIfIdle')).toEqual({ ok: true, exiting: true });
    expect(asked).toHaveLength(1);
  });
});

describe('personas (ADR-0088, E3)', () => {
  it('listPersonas parses the personas directory and starts empty', async () => {
    expect(await engine.invoke('listPersonas')).toEqual([]);
    await fsp.mkdir(path.join(vault, 'tickets/_meta/personas/pia'), { recursive: true });
    await fsp.writeFile(path.join(vault, 'tickets/_meta/personas/pia/persona.md'), PIA_PERSONA, 'utf8');
    await fsp.mkdir(path.join(vault, 'tickets/_meta/personas/ben'), { recursive: true });
    await fsp.writeFile(
      path.join(vault, 'tickets/_meta/personas/ben/persona.md'),
      PIA_PERSONA.replace('title: Pia', 'title: Ben').replace('worker: claude-code', 'worker: opencode'),
      'utf8',
    );
    const personas = (await engine.invoke('listPersonas')) as { id: string; title: string; class: string | null; legacy?: { worker: string } }[];
    expect(personas.map((p) => p.id)).toEqual(['ben', 'pia']); // sorted
    // req-288: a v2 record reads with its old keys as `legacy` until the start's migration moves it
    expect(personas[1]).toMatchObject({ title: 'Pia', class: null, legacy: { worker: 'claude-code', models: { default: 'opus', pool: ['opus', 'sonnet'] } } });
  });

  it('serves the team reads of the remote port on the invoke channel (E13-8)', async () => {
    // the owner's own persona is the one entry an empty team shows (E10-6)
    expect(((await engine.invoke('personas')) as { id: string; kind?: string }[]).map((p) => [p.id, p.kind])).toEqual([['you', 'human']]);
    await fsp.mkdir(path.join(vault, 'tickets/_meta/personas/pia'), { recursive: true });
    await fsp.writeFile(path.join(vault, 'tickets/_meta/personas/pia/persona.md'), PIA_PERSONA, 'utf8');
    const personas = (await engine.invoke('personas')) as { id: string; title: string; model: string }[];
    expect(personas.map((p) => p.id)).toEqual(['pia', 'you']);
    expect(personas[0]).toMatchObject({ title: 'Pia', model: '' });
    const thread = (await engine.invoke('personaThread', 'pia')) as { ok: boolean; messages?: unknown[] };
    expect(thread.ok).toBe(true);
    const memory = (await engine.invoke('personaMemory', 'pia')) as { ok: boolean };
    expect(memory.ok).toBe(true);
  });

  it('serves the Review tab reads on the invoke channel: no worktree -> an empty diff and a plain error (E13-7)', async () => {
    expect(await engine.invoke('ticketDiff', { id: 'T-0001' })).toEqual({ files: [], truncated: false });
    expect(await engine.invoke('ticketDiff')).toEqual({ files: [], truncated: false });
    const file = (await engine.invoke('ticketFile', { id: 'T-0001', path: 'src/a.ts' })) as { ok: boolean; error?: string };
    expect(file.ok).toBe(false);
    const unsafe = (await engine.invoke('ticketFile', { id: 'T-0001', path: '../secret' })) as { ok: boolean; error?: string };
    expect(unsafe).toEqual({ ok: false, error: 'not a path inside the repository' });
  });

  it('personaLearn appends one confirmed entry (header on creation) and refuses unknown personas', async () => {
    const ghost = (await engine.invoke('personaLearn', { id: 'ghost', entry: 'a lesson' })) as { ok: boolean; error?: string };
    expect(ghost.ok).toBe(false);
    expect(ghost.error).toContain('does not exist');

    await fsp.mkdir(path.join(vault, 'tickets/_meta/personas/pia'), { recursive: true });
    await fsp.writeFile(path.join(vault, 'tickets/_meta/personas/pia/persona.md'), PIA_PERSONA, 'utf8');

    const learned = (await engine.invoke('personaLearn', { id: 'pia', entry: '- 2026-11-01 · T-0102 · handed-over' })) as { ok: boolean };
    expect(learned.ok).toBe(true);
    expect(await fsp.readFile(path.join(vault, 'tickets/_meta/personas/pia/memory.md'), 'utf8')).toBe(
      '# Memory\n\n- 2026-11-01 · T-0102 · handed-over\n',
    );

    // One line, always: a multiline dialog entry flattens — in the owner's line form (req-169).
    await engine.invoke('personaLearn', { id: 'pia', entry: '- second lesson\n  spread over two lines' });
    expect(await fsp.readFile(path.join(vault, 'tickets/_meta/personas/pia/memory.md'), 'utf8')).toMatch(
      /^# Memory\n\n- 2026-11-01 · T-0102 · handed-over\n- \d{4}-\d{2}-\d{2} · you · second lesson spread over two lines\n$/,
    );

    const blank = (await engine.invoke('personaLearn', { id: 'pia', entry: '   ' })) as { ok: boolean; error?: string };
    expect(blank.ok).toBe(false);
  });

  it('req-257: legacy column keys no longer turn into personas — a refresh creates none and commits nothing', async () => {
    await gitInitVault();
    await fsp.writeFile(path.join(vault, 'tickets/_meta/pipeline.md'), LEGACY_PIPELINE, 'utf8');
    await git(['add', '-A']);
    await git(['commit', '-m', 'seed']);
    const head = (await git(['rev-parse', 'HEAD'])).trim();

    await engine.invoke('refresh');

    expect((await git(['rev-parse', 'HEAD'])).trim()).toBe(head);
    expect(await fsp.stat(path.join(vault, 'tickets/_meta/personas/build-v2')).then(() => true, () => false)).toBe(false);
    expect(await fsp.readFile(path.join(vault, 'tickets/_meta/pipeline.md'), 'utf8')).toBe(LEGACY_PIPELINE);
  });

  it('leaves the pipeline alone when every derived persona already exists', async () => {
    await gitInitVault();
    await fsp.writeFile(path.join(vault, 'tickets/_meta/pipeline.md'), LEGACY_PIPELINE, 'utf8');
    // The owner hand-wrote the persona the column would derive.
    await fsp.mkdir(path.join(vault, 'tickets/_meta/personas/build-v2'), { recursive: true });
    await fsp.writeFile(path.join(vault, 'tickets/_meta/personas/build-v2/persona.md'), PIA_PERSONA, 'utf8');
    await git(['add', '-A']);
    await git(['commit', '-m', 'seed']);
    const head = (await git(['rev-parse', 'HEAD'])).trim();

    await engine.invoke('refresh');

    // No rewrite, no commit: the owner's files stay exactly as written.
    expect((await git(['rev-parse', 'HEAD'])).trim()).toBe(head);
    const pipelineText = await fsp.readFile(path.join(vault, 'tickets/_meta/pipeline.md'), 'utf8');
    expect(pipelineText).toContain('worker: opencode');
    expect(pipelineText).not.toContain('persona:');
    expect(await fsp.readFile(path.join(vault, 'tickets/_meta/personas/build-v2/persona.md'), 'utf8')).toBe(PIA_PERSONA);
  });
});


describe('videos setting (E11-1c)', () => {
  it('removes a stored videos.limitMb at startup and ignores it', async () => {
    await engine.close();
    await fsp.writeFile(path.join(home, 'config.json'), JSON.stringify({ 'videos.limitMb': 2000 }), 'utf8');
    engine = await createEngine({ vaultPath: vault, home, clientDir: path.join(root, 'client'), log: () => undefined, seedDefaultCrew: false });
    await engine.ready;
    expect(await engine.config.get('videos.limitMb')).toBeUndefined();
    expect(JSON.parse(await fsp.readFile(path.join(home, 'config.json'), 'utf8'))).not.toHaveProperty('videos.limitMb');
  });
});

describe('invoke pair (M111/UX follow-up)', () => {
  it('a bare-string payload names the device — the proxy passes the first argument only', async () => {
    await engine.invoke('configSet', { key: 'remote.enabled', value: true });
    const status = (await engine.invoke('pair', 'ClaudeCode')) as {
      pairing: { deviceName: string | null } | null;
    };
    expect(status.pairing?.deviceName).toBe('ClaudeCode');
    await engine.invoke('cancelPairing');
  });

  it('an object payload carries deviceName and readOnly', async () => {
    await engine.invoke('configSet', { key: 'remote.enabled', value: true });
    const status = (await engine.invoke('pair', { deviceName: 'Pad', readOnly: true })) as {
      pairing: { deviceName: string | null; readOnly: boolean | null } | null;
    };
    expect(status.pairing?.deviceName).toBe('Pad');
    expect(status.pairing?.readOnly).toBe(true);
    await engine.invoke('cancelPairing');
  });
});

describe('invoke flow and settings (E13-11, E13-12)', () => {
  it('answers a flow for a ticket that does not exist as a refusal, not a throw', async () => {
    const reply = (await engine.invoke('flow', { id: 'T-9999', part: null })) as { ok: boolean; error?: string };
    expect(reply.ok).toBe(false);
    expect(typeof reply.error).toBe('string');
  });

  it('refuses a malformed flow edit through the router parser', async () => {
    const reply = (await engine.invoke('flowEdit', { id: 'T-0001', chain: [], edit: { op: 'nonsense' } })) as { ok: boolean };
    expect(reply.ok).toBe(false);
    const saved = (await engine.invoke('flowSave', { part: 'x' })) as { ok: boolean };
    expect(saved.ok).toBe(false);
  });

  it('reads the videos settings and writes the per-video cap', async () => {
    const read = (await engine.invoke('settingsRead')) as { ok: true; engine: { videos: { inGit: boolean; maxMb: number } } };
    expect(read.engine.videos.inGit).toBe(false);
    const written = (await engine.invoke('settingsPatch', { maxMb: 20 })) as { ok: true; engine: { videos: { maxMb: number } } };
    expect(written.engine.videos.maxMb).toBe(20);
    const refused = (await engine.invoke('settingsPatch', { inGit: true })) as { ok: boolean };
    expect(refused.ok).toBe(false);
  });
});
