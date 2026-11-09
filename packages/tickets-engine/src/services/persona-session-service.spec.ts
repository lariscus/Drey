import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePersonaFile, type Persona } from '../core/persona';
import type { RunInfo, RunRequest } from '../fleet/protocol';
import type { ApiTurnInput } from './api-persona-turn';
import type { EngineHost, EngineVault } from './host';
import { PersonaSessionContext } from './persona-session-context';
import { PersonaSessionFiles } from './persona-session-files';
import { PersonaSessionService } from './persona-session-service';
import { answerAfterLastPrompt, PersonaTurnWatcher } from './persona-turn-watcher';

const BEN = "---\ntitle: Ben\nrole: builder\nworker: claude-code\nmodels:\n  default: opus\n  pool: [opus]\ncolor: '#888888'\nskills: []\n---\n";
const ANNA = "---\ntitle: Anna\nrole: reviewer\nworker: api\nmodels:\n  default: gpt\n  pool: [gpt]\ncolor: '#888888'\nskills: []\n---\n";

async function walk(root: string, rel: string, out: string[]): Promise<void> {
  for (const entry of await fsp.readdir(path.join(root, rel), { withFileTypes: true })) {
    const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      await walk(root, next, out);
    } else if (entry.name.endsWith('.md')) {
      out.push(next);
    }
  }
}

/** The runner as the spec drives it: one run list, one stream per run, a change push. */
class FakeFleet {
  readonly runsList: RunInfo[] = [];
  readonly streams = new Map<string, string>();
  readonly starts: RunRequest[] = [];
  readonly sent: { runId: string; text: string }[] = [];
  readonly listeners = new Set<() => void>();
  startError: string | null = null;

  async runs(): Promise<readonly RunInfo[]> {
    return this.runsList;
  }
  async start(request: RunRequest): Promise<{ ok: true; run: RunInfo } | { ok: false; error: string }> {
    if (this.startError !== null) {
      return { ok: false, error: this.startError };
    }
    this.starts.push(request);
    const run = { id: `R-${this.starts.length}`, ticketId: '1:1', kind: '1:1', persona: request.session!.persona, state: 'running', startedAt: '2026-11-09T10:00:00Z', lastActivity: '2026-11-09T10:00:00Z', costUsd: null, gateFailure: null } as unknown as RunInfo;
    this.runsList.push(run);
    return { ok: true, run };
  }
  async send(runId: string, text: string): Promise<{ ok: boolean }> {
    this.sent.push({ runId, text });
    this.streams.set(runId, `${this.streams.get(runId) ?? ''}${JSON.stringify({ kind: 'note', text: `you › ${text}` })}\n`);
    return { ok: true };
  }
  async stream(runId: string): Promise<string | null> {
    return this.streams.get(runId) ?? null;
  }
  /** The persona answers: text events and the turn's end, then the change push. */
  answer(runId: string, ...texts: string[]): void {
    const lines = [...texts.map((text) => ({ kind: 'text', text })), { kind: 'result', text: 'done' }];
    this.streams.set(runId, `${this.streams.get(runId) ?? ''}${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
    this.listeners.forEach((l) => l());
  }
}

describe('PersonaSessionService — the 1:1 as a persona session (req-168)', () => {
  let root = '';
  let fleet: FakeFleet;
  let changed: string[];
  let patches: unknown[];
  let bridgeCalls: ApiTurnInput[];
  let vault: EngineVault;

  const write = async (rel: string, text: string): Promise<void> => {
    await fsp.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fsp.writeFile(path.join(root, rel), text, 'utf8');
  };

  function boot(): PersonaSessionService {
    const host = {
      read: async (_v: string, p: string) => fsp.readFile(path.join(root, p), 'utf8'),
      write: (_v: string, p: string, text: string) => write(p, text),
      listMarkdownFiles: async () => {
        const out: string[] = [];
        await walk(root, '', out);
        return out;
      },
      resolveAssetPath: (_v: string, p: string) => path.join(root, p),
      announceChanges: () => undefined,
    } as unknown as EngineHost;
    const loadPersona = async (_v: EngineVault, id: string): Promise<Persona | null> => {
      const text = await fsp.readFile(path.join(root, `tickets/_meta/personas/${id}/persona.md`), 'utf8').catch(() => null);
      return text === null ? null : parsePersonaFile(id, text);
    };
    return new PersonaSessionService({
      board: { detect: async () => vault, loadPersona, personaPatch: async (input) => (patches.push(input), { ok: true }) },
      fleet,
      files: new PersonaSessionFiles({ host, log: () => undefined }),
      context: new PersonaSessionContext({ host, runs: () => fleet.runs() }),
      watcher: new PersonaTurnWatcher(fleet, (listener) => (fleet.listeners.add(listener), () => fleet.listeners.delete(listener))),
      bridge: async (input) => (bridgeCalls.push(input), { ok: true, text: 'Anna here.' }),
      onChanged: (file) => changed.push(file),
      log: () => undefined,
    });
  }

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-1on1-'));
    vault = { id: 'v', name: 'tickets', path: root, exists: true, active: true } as unknown as EngineVault;
    fleet = new FakeFleet();
    changed = [];
    patches = [];
    bridgeCalls = [];
    await write('tickets/_meta/personas/ben/persona.md', BEN);
    await write('tickets/_meta/personas/ben/prompt.md', 'Build small.');
    await write('tickets/_meta/personas/ben/memory.md', '# Memory\n\n- keep PRs small\n');
    await write('tickets/_meta/personas/anna/persona.md', ANNA);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('reads an untouched persona as no session, and creates no file', async () => {
    expect(await boot().thread('ben')).toEqual({ ok: true, messages: [], proposals: [], session: 'none' });
    expect(await fsp.readdir(path.join(root, 'tickets/_meta')).then((d) => d.includes('chat'))).toBe(false);
  });

  it("migrates thread.md once, starts a quiet session from the pool, and lands the persona's answer", async () => {
    await write('tickets/_meta/personas/ben/thread.md', "---\ntitle: \"Ben\"\ncreated: '2026-11-03T09:00:00.000Z'\n---\n\n- '2026-11-03T09:01:00.000Z' owner — Ask before any dependency bump\n");
    fleet.runsList.push({ id: 'R-old', ticketId: 'T-0007', persona: 'ben', state: 'failed', startedAt: '2026-11-08T10:00:00Z', costUsd: 1.1, gateFailure: 'npm test', model: 'opus' } as unknown as RunInfo);
    const service = boot();
    const sent = await service.send('ben', 'Why did T-0007 fail?');
    expect(sent).toMatchObject({ ok: true, session: 'starting' });
    await expect(fsp.access(path.join(root, 'tickets/_meta/personas/ben/thread.md'))).rejects.toThrow();
    const file = sent.ok ? sent.file! : '';
    expect(file).toMatch(/^tickets\/_meta\/chat\/\d{8}-\d{6}-1-1-with-ben\.md$/);

    await waitUntil(() => fleet.sent.length === 1);
    const request = fleet.starts[0]!;
    expect(request).toMatchObject({ provider: 'claude-code', model: 'opus', permissionMode: 'read-only', session: { kind: '1:1', persona: 'ben', workingDirectory: root, chatFile: file } });
    expect(request.instruction).toContain('Build small.');
    expect(request.instruction).toContain('keep PRs small');
    expect(request.instruction).toContain('- T-0007 · failed · opus · $1.10 · gate: npm test');
    expect(request.instruction).toContain('Owner: Ask before any dependency bump');
    expect(fleet.sent[0]).toEqual({ runId: 'R-1', text: 'Why did T-0007 fail?' });

    fleet.answer('R-1', 'The gate ran npm test.', 'Three specs failed.');
    await service.idle();
    const read = await service.thread('ben');
    expect(read.ok && read.messages.map((m) => [m.role, m.text])).toEqual([
      ['owner', 'Ask before any dependency bump'],
      ['owner', 'Why did T-0007 fail?'],
      ['persona', 'The gate ran npm test.\n\nThree specs failed.'],
    ]);
    expect(read).toMatchObject({ session: 'held', runId: 'R-1', releaseAt: '2026-11-09T10:15:00.000Z' });
    expect(changed).toContain(file);
  });

  it('a second line goes to the held session — no second start', async () => {
    const service = boot();
    await service.send('ben', 'first');
    await waitUntil(() => fleet.sent.length === 1);
    fleet.answer('R-1', 'one');
    await service.idle();
    await service.send('ben', 'second');
    await waitUntil(() => fleet.sent.length === 2);
    fleet.answer('R-1', 'two');
    await service.idle();
    expect(fleet.starts).toHaveLength(1);
    expect(fleet.sent.map((s) => s.runId)).toEqual(['R-1', 'R-1']);
  });

  it('turns proposal blocks into cards; an accepted one is adopted through the persona patch', async () => {
    const service = boot();
    await service.send('ben', 'Anything to change?');
    await waitUntil(() => fleet.sent.length === 1);
    fleet.answer('R-1', 'Yes.\n\n```proposal\n{"kind":"prompt","summary":"Name the date format","text":"Build small. Dates are ISO."}\n```');
    await service.idle();
    const read = await service.thread('ben');
    expect(read.ok && read.proposals).toEqual([expect.objectContaining({ id: 'p-1', state: 'pending', summary: 'Name the date format' })]);
    expect(read.ok && read.messages.at(-1)?.text).toBe('Yes.');
    const decided = await service.decide('ben', 'p-1', 'confirm');
    expect(patches).toEqual([{ id: 'ben', prompt: 'Build small. Dates are ISO.' }]);
    expect(decided.ok && decided.proposals?.[0]).toMatchObject({ state: 'confirmed', outcome: 'prompt.md written' });
    expect(await service.decide('ben', 'p-1', 'dismiss')).toEqual({ ok: false, error: 'no open proposal p-1' });
  });

  it('an api persona talks over the chat bridge with its brief — no session is started', async () => {
    const service = boot();
    expect(await service.thread('anna')).toMatchObject({ session: 'bridge' });
    await service.send('anna', 'Hello');
    await service.idle();
    expect(fleet.starts).toEqual([]);
    expect(bridgeCalls[0]).toMatchObject({ text: 'Hello', history: [] });
    expect(bridgeCalls[0]!.system).toContain('You are Anna, the reviewer of this crew');
    const read = await service.thread('anna');
    expect(read.ok && read.messages.at(-1)).toMatchObject({ role: 'persona', text: 'Anna here.' });
  });

  it('a refused start keeps the owner line and tells why; nothing answers', async () => {
    fleet.startError = 'waits: ben has spent $4.00 of $4.00 today';
    const service = boot();
    await service.send('ben', 'Hi');
    await service.idle();
    const read = await service.thread('ben');
    expect(read).toMatchObject({ ok: true, session: 'none', failure: 'waits: ben has spent $4.00 of $4.00 today' });
    expect(read.ok && read.messages.map((m) => m.role)).toEqual(['owner']);
  });

  it('refuses an empty line, an unknown persona and a line while the answer is still on its way', async () => {
    const service = boot();
    expect(await service.send('ben', '  ')).toEqual({ ok: false, error: 'the message is empty' });
    expect(await service.send('ghost', 'x')).toEqual({ ok: false, error: 'persona "ghost" not found' });
    await service.send('ben', 'first');
    expect(await service.send('ben', 'again')).toEqual({ ok: false, error: 'Ben is still answering — wait for the answer' });
    await waitUntil(() => fleet.sent.length === 1);
    fleet.answer('R-1', 'ok');
    await service.idle();
  });
});

describe('answerAfterLastPrompt — the answer is what follows the last prompt', () => {
  it('collects the text events after the last prompt and sees the turn end', () => {
    const stream = [
      { kind: 'note', text: 'you › first' },
      { kind: 'text', text: 'old answer' },
      { kind: 'result' },
      { kind: 'note', text: 'you › second' },
      { kind: 'note', text: 'thinking › hm' },
      { kind: 'text', text: 'new answer' },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n');
    expect(answerAfterLastPrompt(stream)).toEqual({ done: false, text: 'new answer' });
    expect(answerAfterLastPrompt(`${stream}\n${JSON.stringify({ kind: 'result' })}\n{"torn`)).toEqual({ done: true, text: 'new answer' });
    expect(answerAfterLastPrompt('')).toEqual({ done: false, text: '' });
  });
});

/** Waits for a condition the background answer reaches (an event, never a wall-clock budget of its own). */
async function waitUntil(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(condition()).toBe(true);
}
