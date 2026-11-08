import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import { settled, waitFor } from './run-spec-support';
import { endTurn, harness, reportUsage, runRequest, startRun, useTempDirs } from './supervisor-harness.fake';

describe('PersonaMemory — persona stamping and the lesson of a settled run (E3, ADR-0088)', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);
  const memoryFile = (): string => path.join(dirs.vault, 'tickets', '_meta', 'personas', 'pia', 'memory.md');

  it('a dispatched persona stamps RunInfo.persona at start', async () => {
    const { sup } = harness(dirs.fleet);
    const started = await sup.start(request(), { persona: 'pia' });
    expect(started.ok).toBe(true);
    expect(started.ok && started.run.persona).toBe('pia');
    // nothing settled yet — no memory file appears
    await expect(fsp.access(memoryFile())).rejects.toBeDefined();
  });

  it('a ring run carries persona null and touches no personas dir', async () => {
    const { sup } = harness(dirs.fleet);
    const started = await sup.start(request());
    expect(started.ok).toBe(true);
    expect(started.ok ? started.run.persona : 'refused').toBeNull();
    await expect(fsp.access(path.join(dirs.vault, 'tickets', '_meta', 'personas'))).rejects.toBeDefined();
  });

  it('a green persona run appends its one-line lesson (handed-over, token sum)', async () => {
    const h = harness(dirs.fleet);
    const id = await startRun(h.sup, request(), 'pia');
    await reportUsage(h, id, 0, { tokensIn: 12_000, tokensOut: 300 });
    endTurn(h.adapter.handles[0]!);
    await settled(h.sup, id, 'done');
    await waitFor(async () => {
      const memory = await fsp.readFile(memoryFile(), 'utf8');
      expect(memory.startsWith('# Memory')).toBe(true);
      expect(memory).toContain('- 2026-10-17 · T-0001 · handed-over · 12300 tokens');
    });
  });

  it('a red gate appends a failed lesson; an owner stop appends a stopped one', async () => {
    const { sup, adapter } = harness(dirs.fleet, {
      execShell: async () => {
        throw new Error('exit 1');
      },
    });
    const id = await startRun(sup, request(), 'pia');
    adapter.handles[0]!.result();
    adapter.handles[0]!.fail(1);
    await settled(sup, id, 'failed');
    await waitFor(async () => {
      expect(await fsp.readFile(memoryFile(), 'utf8')).toContain('· failed ·');
    });

    const id2 = await startRun(sup, request(), 'pia');
    await sup.stop(id2, 'test');
    await settled(sup, id2, 'stopped');
    await waitFor(async () => {
      const memory = await fsp.readFile(memoryFile(), 'utf8');
      expect(memory).toContain('· stopped ·');
      expect(memory.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(2);
    });
  });

  it('the memory file caps at 200 lines — the oldest lessons drop first, the header stays', async () => {
    const dir = path.dirname(memoryFile());
    await fsp.mkdir(dir, { recursive: true });
    const lines = ['# Memory', ''];
    for (let i = 1; i <= 198; i++) {
      lines.push(`- 2026-10-01 · T-0${String(i).padStart(3, '0')} · handed-over · ${i} tokens`);
    }
    await fsp.writeFile(memoryFile(), `${lines.join('\n')}\n`, 'utf8');

    const { sup, adapter } = harness(dirs.fleet);
    const id = await startRun(sup, request(), 'pia');
    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'done');
    await waitFor(async () => {
      expect(await fsp.readFile(memoryFile(), 'utf8')).toContain('- 2026-10-17 · T-0001 · handed-over · 0 tokens'); // the new entry landed
    });

    const memory = await fsp.readFile(memoryFile(), 'utf8');
    const nonEmpty = memory.split('\n').filter((line) => line !== '');
    expect(nonEmpty).toHaveLength(199); // the header + 198 entries — the file's 200 lines with the blank
    expect(nonEmpty[0]).toBe('# Memory');
    expect(memory).toContain('- 2026-10-01 · T-0002 · handed-over · 2 tokens'); // shifted up, kept
    expect(memory).not.toContain('- 2026-10-01 · T-0001 · handed-over · 1 tokens'); // the oldest, dropped
  });

  it('a memory write failure never fails the settle', async () => {
    // A file where the personas directory belongs: the mkdir of the
    // persona folder fails, the append must not.
    await fsp.mkdir(path.join(dirs.vault, 'tickets', '_meta'), { recursive: true });
    await fsp.writeFile(path.join(dirs.vault, 'tickets', '_meta', 'personas'), 'not a directory', 'utf8');
    const { sup, adapter, logs } = harness(dirs.fleet);
    const id = await startRun(sup, request(), 'pia');
    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'done');
    await waitFor(() => {
      expect(logs.some((line) => line.includes('persona memory append failed'))).toBe(true);
    });
  });
});
