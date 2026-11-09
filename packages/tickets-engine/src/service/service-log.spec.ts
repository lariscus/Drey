import { describe, expect, it } from 'vitest';
import { DailyLogFiles, dayOf, expiredLogFiles, type LogFileSystem } from './daily-log-files';
import { ServiceLog, componentOfLine, type LogSink } from './service-log';

/** The service log (req-165): the level applied live, the ring, the subscribers, and the files per component per day. */
describe('ServiceLog', () => {
  const sink = (): LogSink & { lines: string[] } => {
    const lines: string[] = [];
    return { lines, write: (_c, _at, line) => lines.push(line), flush: async () => undefined };
  };
  const at = new Date('2026-11-09T08:12:03.000Z');

  it('normal keeps info and up, quiet only warnings and errors, detailed everything — switched live', () => {
    const files = sink();
    const log = new ServiceLog({ sink: files, now: () => at });
    log.log('runner', 'debug line', 'debug');
    log.log('runner', 'info line');
    log.setThreshold('quiet');
    log.log('runner', 'quiet info');
    log.log('runner', 'a warning', 'warn');
    log.setThreshold('detailed');
    log.log('engine', 'now debug', 'debug');
    expect(files.lines.map((l) => l.slice(25))).toEqual(['info  runner  info line', 'warn  runner  a warning', 'debug engine  now debug']);
  });

  it('keeps a ring the tail reads, by component, and tells every subscriber until it leaves', () => {
    const log = new ServiceLog({ sink: sink(), now: () => at });
    const seen: string[] = [];
    const off = log.subscribe((line) => seen.push(componentOfLine(line) ?? ''));
    log.log('runner', 'a');
    log.log('engine', 'b');
    off();
    log.log('runner', 'c');
    expect(seen).toEqual(['runner', 'engine']);
    expect(log.tail(10, 'runner')).toHaveLength(2);
    expect(log.tail(1)).toHaveLength(1);
  });
});

describe('DailyLogFiles', () => {
  const memoryFs = (): LogFileSystem & { files: Map<string, string> } => {
    const files = new Map<string, string>();
    return {
      files,
      append: async (file, text) => void files.set(file, (files.get(file) ?? '') + text),
      size: async (file) => (files.has(file) ? files.get(file)!.length : null),
      keepTail: async (file, bytes) => void files.set(file, files.get(file)!.slice(-bytes)),
      list: async (dir) => [...files.keys()].filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1)),
      remove: async (file) => void files.delete(file),
      mkdir: async () => undefined,
      join: (...parts) => parts.join('/'),
    };
  };

  it('writes one file per component per day and the combined service.log', async () => {
    const fs = memoryFs();
    const files = new DailyLogFiles('H', fs);
    const now = new Date(2026, 10, 9, 8, 0, 0);
    files.write('runner', now, 'r1');
    files.write('engine', now, 'e1');
    await files.flush();
    expect(fs.files.get(`H/logs/runner-${dayOf(now)}.log`)).toBe('r1\n');
    expect(fs.files.get(`H/logs/engine-${dayOf(now)}.log`)).toBe('e1\n');
    expect(fs.files.get('H/service.log')).toBe('r1\ne1\n');
    expect(files.folder).toBe('H/logs');
  });

  it('removes the files older than 14 days on the first write of a day', async () => {
    const fs = memoryFs();
    fs.files.set('H/logs/runner-2026-10-20.log', 'old');
    fs.files.set('H/logs/runner-2026-10-26.log', 'kept');
    const files = new DailyLogFiles('H', fs);
    files.write('runner', new Date(2026, 10, 9, 8), 'new');
    await files.flush();
    expect(fs.files.has('H/logs/runner-2026-10-20.log')).toBe(false);
    expect(fs.files.has('H/logs/runner-2026-10-26.log')).toBe(true);
  });

  it('expiredLogFiles reads only its own file names', () => {
    expect(expiredLogFiles(['runner-2026-10-01.log', 'notes.txt', 'engine-2026-11-08.log'], '2026-11-09', 14)).toEqual(['runner-2026-10-01.log']);
  });
});
