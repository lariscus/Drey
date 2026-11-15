import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import type { FileSystem } from '../ports/file-system';
import { newLiveRun, type LiveRun } from './live-run';
import { PersonaMemory } from './persona-memory';
import { runInfo, runRequest } from './supervisor-harness.fake';

const FILE = 'V:/vault/tickets/_meta/personas/ben/memory.md';
const clock = { now: () => new Date('2026-11-09T12:00:00Z') };

function run(persona: string | null = 'ben'): LiveRun {
  return newLiveRun({ info: runInfo({ id: 'r-1', ticketId: 'T-0102', persona, model: 'sonnet' }), request: runRequest('V:/vault'), dir: 'F:/runs/r-1' });
}

describe('PersonaMemory — the closing round\'s lesson (req-169)', () => {
  it('writes one line with ticket and persona/model under a fresh header', async () => {
    const fs = new MemoryFileSystem();
    const line = await new PersonaMemory(clock, fs, () => undefined).appendLesson(run(), 'run the verify script');
    expect(line).toBe('- 2026-11-09 · T-0102 · ben/sonnet · run the verify script');
    expect(fs.files.get(FILE)).toBe('# Memory\n\n- 2026-11-09 · T-0102 · ben/sonnet · run the verify script\n');
  });

  it('a ring run or an empty lesson writes nothing', async () => {
    const fs = new MemoryFileSystem();
    const memory = new PersonaMemory(clock, fs, () => undefined);
    expect(await memory.appendLesson(run(null), 'x')).toBeNull();
    expect(await memory.appendLesson(run(), '  ')).toBeNull();
    expect(fs.files.size).toBe(0);
  });

  it('caps the file at 200 lines — the oldest lesson drops first, the header stays', async () => {
    const fs = new MemoryFileSystem();
    const lines = ['# Memory', '', ...Array.from({ length: 198 }, (_, i) => `- 2026-10-01 · you · lesson ${i + 1}`)];
    fs.files.set(FILE, `${lines.join('\n')}\n`);
    await new PersonaMemory(clock, fs, () => undefined).appendLesson(run(), 'the newest');
    const text = fs.files.get(FILE) as string;
    expect(text.split('\n').filter((l) => l !== '')).toHaveLength(199);
    expect(text).not.toContain('lesson 1\n');
    expect(text).toContain('lesson 2\n');
    expect(text.trimEnd().endsWith('the newest')).toBe(true);
  });

  it('a write failure is a log line, never a thrown error', async () => {
    const logs: string[] = [];
    const broken = Object.assign(new MemoryFileSystem(), {
      writeText: async (): Promise<void> => {
        throw new Error('disk full');
      },
    }) as FileSystem;
    expect(await new PersonaMemory(clock, broken, (m) => logs.push(m)).appendLesson(run(), 'x')).toBeNull();
    expect(logs).toEqual(['run r-1: persona memory append failed — disk full']);
  });
});
