import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEngine, type Engine } from './engine';
import type { PathsChange } from './drey-port';

/**
 * req-213: `Engine.emitPaths` is how Drey Service tells the paths channel
 * of files written outside the engine's own services — a worker's vault
 * write through the service's MCP. The listener of `onPaths` and the
 * plugin's `/api/events` stream hear it exactly as they hear a phone's note
 * save. (The wiring from the vault MCP's calls is service-host-vault.spec's.)
 */
let root: string;
let engine: Engine;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(tmpdir(), 'engine-emit-paths-'));
  const vault = path.join(root, 'vault');
  const home = path.join(root, 'home');
  await fsp.mkdir(path.join(vault, 'tickets/_meta'), { recursive: true });
  await fsp.mkdir(path.join(root, 'client'), { recursive: true });
  await fsp.mkdir(home, { recursive: true });
  await fsp.writeFile(path.join(vault, 'tickets/_meta/pipeline.md'), '---\nphases:\n  - { id: inbox, title: Inbox, handover: manual }\n---\nP\n', 'utf8');
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'spec'], ['config', 'user.email', 'spec@example.com']]) {
    await promisify(execFile)('git', args, { cwd: vault });
  }
  engine = await createEngine({ vaultPath: vault, home, clientDir: path.join(root, 'client'), log: () => undefined, seedDefaultCrew: false });
});

afterEach(async () => {
  await engine.close();
  await fsp.rm(root, { recursive: true, force: true });
});

describe('Engine.emitPaths (req-213)', () => {
  it("reaches the paths channel's listeners", () => {
    const heard: PathsChange[] = [];
    const off = engine.onPaths((change) => heard.push(change));
    engine.emitPaths({ vaultPath: 'V:/notes', changed: ['a.md'], deleted: ['old.md'] });
    off();
    engine.emitPaths({ vaultPath: 'V:/notes', changed: ['late.md'], deleted: [] });
    expect(heard).toEqual([{ vaultPath: 'V:/notes', changed: ['a.md'], deleted: ['old.md'] }]);
  });

  it("rides the plugin's event stream as a `paths` frame, never as a board change", async () => {
    const frames: string[] = [];
    const controller = new AbortController();
    const stream = await fetch(`${engine.invokeUrl}/api/events`, { headers: { authorization: `Bearer ${engine.token}` }, signal: controller.signal });
    void (async () => {
      try {
        for await (const chunk of stream.body as unknown as AsyncIterable<Uint8Array>) {
          frames.push(new TextDecoder().decode(chunk));
        }
      } catch {
        // aborted
      }
    })();
    while (engine.dreyClients() === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    engine.emitPaths({ vaultPath: 'V:/notes', changed: ['a.md'], deleted: [] });
    const deadline = Date.now() + 3_000;
    while (!frames.join('').includes('"change":"paths"') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    controller.abort();
    expect(frames.join('')).toContain('data: {"change":"paths","vaultPath":"V:/notes","changed":["a.md"],"deleted":[]}');
    expect(frames.join('')).not.toContain('"change":"board"');
  });
});
