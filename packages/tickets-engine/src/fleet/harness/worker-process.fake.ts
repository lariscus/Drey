import { vi } from 'vitest';
import type { RunnerProcess, SpawnFn } from '../procs';
import type { NormalizedEvent, ProviderStart } from './contract';

/**
 * The worker adapters' spec seams (no real CLIs): a scripted process and
 * the collected events of one start. What the owner's live spike rounds
 * verify against installed binaries, the specs pin as behavior.
 */

/** A scripted process: the spec pushes stdout lines, reads stdin writes. */
export type FakeProcess = RunnerProcess & {
  stdout: (line: string) => void;
  stdinWrites: string[];
  killTree: ReturnType<typeof vi.fn>;
  exit: (code: number | null) => void;
};

export function fakeProcess(): FakeProcess {
  // Multiple listeners, like the real child's `once('exit')` (T-0049:
  // the resume-failure report registers a second one).
  const exitListeners: Array<(code: number | null) => void> = [];
  const listeners = {
    stdout: (_line: string): void => undefined,
  };
  const stdinWrites: string[] = [];
  const killTree = vi.fn(async () => undefined);
  const proc: FakeProcess = {
    pid: 4242,
    write: (text) => {
      stdinWrites.push(text);
    },
    endInput: () => {
      stdinWrites.push('<<end>>');
    },
    onStdout: (cb) => {
      listeners.stdout = cb;
    },
    onStderr: () => undefined,
    onExit: (cb) => {
      exitListeners.push(cb);
    },
    stdout: (line) => listeners.stdout(`${line}\n`),
    stdinWrites,
    killTree,
    exit: (code) => {
      for (const cb of [...exitListeners]) {
        cb(code);
      }
    },
  };
  return proc;
}

export const spawnOf = (proc: FakeProcess): SpawnFn => () => proc;

export const collect = (
  overrides: Partial<ProviderStart> = {},
): { events: NormalizedEvent[]; sessions: string[]; start: ProviderStart } => {
  const events: NormalizedEvent[] = [];
  const sessions: string[] = [];
  const start: ProviderStart = {
    cwd: 'W:/kt',
    instruction: 'Do the ticket.',
    model: null,
    permissionMode: 'accept-edits',
    resumeRef: null,
    ticketId: 'T-0001',
    onEvent: (event) => events.push(event),
    onSessionRef: (ref) => sessions.push(ref),
    ...overrides,
  };
  return { events, sessions, start };
};
