/**
 * The `claude-code` adapter (ADR-0075): the CLI over stream-json — stdin
 * held open (`--input-format stream-json`), so injection writes a user
 * message in; resume is `--resume <sessionRef>`. Its node seam (spawn)
 * comes through the constructor; the specs run it against a fake process.
 */
import type { SpawnFn } from '../procs';
import { ClaudeCodeWorker } from './claude-code-worker';
import type { NowFn, ProviderAdapter, ProviderStart, WorkerHandle } from './contract';

/** The CLI's arguments for a start: headless stream-json both ways, the permission mode, the model, the resume. */
export function claudeCodeArgs(start: ProviderStart): string[] {
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    start.permissionMode === 'bypass' ? 'bypassPermissions' : 'acceptEdits',
    ...(start.model !== null ? ['--model', start.model] : []),
    ...(start.resumeRef !== null ? ['--resume', start.resumeRef] : []),
  ];
}

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly id = 'claude-code' as const;
  readonly label = 'Claude Code';
  readonly liveInject = true;

  constructor(
    private readonly spawnFn: SpawnFn,
    private readonly now: NowFn,
  ) {}

  spawn(start: ProviderStart): WorkerHandle {
    return new ClaudeCodeWorker(this.spawnFn('claude', claudeCodeArgs(start), { cwd: start.cwd }), start, this.now);
  }
}

export function claudeCodeAdapter(spawnFn: SpawnFn, now: NowFn = (): Date => new Date()): ProviderAdapter {
  return new ClaudeCodeAdapter(spawnFn, now);
}
