/**
 * The `claude-code` adapter (ADR-0075): the CLI over stream-json — stdin
 * held open (`--input-format stream-json`), so injection writes a user
 * message in; resume is `--resume <sessionRef>`. Its node seam (spawn)
 * comes through the constructor; the specs run it against a fake process.
 * The vault MCP (req-167) is a `--mcp-config` file in the run's folder (the
 * token never on the command line), its tools allowed by server
 * (`--allowedTools mcp__<name>`): Drey Service enforces the rights itself.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type { SpawnFn } from '../ports/process-spawner';
import { ClaudeCodeWorker } from './claude-code-worker';
import type { NowFn, ProviderAdapter, ProviderStart, WorkerHandle, WorkerMcpLaunch, WorkerMcpServer } from './contract';

/** The CLI's `--permission-mode` for a start's mode; `read-only` (req-183, a review) is the CLI's `plan`. */
export function claudeCodePermission(mode: ProviderStart['permissionMode']): string {
  return mode === 'bypass' ? 'bypassPermissions' : mode === 'read-only' ? 'plan' : 'acceptEdits';
}

/** Claude Code's web tools — what `network: false` takes away (req-142). */
export const CLAUDE_CODE_WEB_TOOLS = ['WebFetch', 'WebSearch'] as const;

/** The settings file's name in the run's folder (req-185). */
export const CLAUDE_CODE_SETTINGS_FILE = 'claude-settings.json';

/**
 * The run's own settings (req-185, ADR-0099), passed with `--settings`: a
 * writing run's file tools may not write outside its working folders
 * (`blockWritesOutsideWorkingDirectories`, Claude Code 2.1.314+ — it holds in
 * `bypassPermissions` too), and without the network the web tools are denied
 * (a deny rule holds in every mode). Null when nothing is asked. Claude Code's
 * OS sandbox is not used: native Windows has none, and on macOS/Linux it
 * would also fence off the repository's `.git` the worker commits into.
 */
export function claudeCodeSettings(start: Pick<ProviderStart, 'permissionMode' | 'network'>): Record<string, unknown> | null {
  const permissions = {
    ...(start.permissionMode !== 'read-only' ? { blockWritesOutsideWorkingDirectories: true } : {}),
    ...(start.network === false ? { deny: [...CLAUDE_CODE_WEB_TOOLS] } : {}),
  };
  return Object.keys(permissions).length === 0 ? null : { permissions };
}

/**
 * The CLI's arguments for a start: headless stream-json both ways, the
 * permission mode, the folders beyond `cwd` (`--add-dir`), the model, the
 * resume, the web tools off without the network, the settings file, the
 * vault MCP. `--add-dir`, `--disallowedTools` and `--allowedTools` take
 * several values, so an option always follows them.
 */
export function claudeCodeArgs(start: ProviderStart, settingsFile: string | null = null): string[] {
  const dirs = start.writeDirs ?? [];
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    ...(dirs.length > 0 ? ['--add-dir', ...dirs] : []),
    '--permission-mode',
    claudeCodePermission(start.permissionMode),
    ...(start.model !== null ? ['--model', start.model] : []),
    ...(start.resumeRef !== null ? ['--resume', start.resumeRef] : []),
    ...(start.network === false ? ['--disallowedTools', ...CLAUDE_CODE_WEB_TOOLS] : []),
    ...(settingsFile !== null ? ['--settings', settingsFile] : []),
    ...(start.mcp?.args ?? []),
  ];
}

/** Writes one launch file (the settings), its folder made first; the runner's own run folder. */
export type LaunchFileWriter = (file: string, text: string) => void;

const writeLaunchFile: LaunchFileWriter = (file, text) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
};

/** The vault MCP as Claude Code takes it (req-167): one config file in the run's folder, named on the command line. */
export function claudeCodeMcpLaunch(server: WorkerMcpServer): WorkerMcpLaunch {
  const file = path.join(server.runDir, 'mcp.json');
  const config = { mcpServers: { [server.name]: { type: 'http', url: server.url, headers: { Authorization: `Bearer ${server.token}` } } } };
  return {
    files: [{ path: file, text: `${JSON.stringify(config, null, 2)}\n` }],
    args: ['--mcp-config', file, '--allowedTools', `mcp__${server.name}`],
    acpServers: [],
  };
}

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly id = 'claude-code' as const;
  readonly label = 'Claude Code';
  readonly liveInject = true;

  constructor(
    private readonly spawnFn: SpawnFn,
    private readonly now: NowFn,
    private readonly writeFile: LaunchFileWriter = writeLaunchFile,
  ) {}

  mcpLaunch(server: WorkerMcpServer): WorkerMcpLaunch {
    return claudeCodeMcpLaunch(server);
  }

  spawn(start: ProviderStart): WorkerHandle {
    // req-177: a slot's account is its CLAUDE_CONFIG_DIR, handed in through the environment.
    const opts = start.env !== undefined ? { cwd: start.cwd, env: start.env } : { cwd: start.cwd };
    return new ClaudeCodeWorker(this.spawnFn('claude', claudeCodeArgs(start, this.settingsFileOf(start)), opts), start, this.now);
  }

  /** req-185: the run's settings as a file in its folder (a JSON argument would not survive the Windows shell); null when none. */
  private settingsFileOf(start: ProviderStart): string | null {
    const settings = claudeCodeSettings(start);
    if (settings === null || start.runDir === undefined) {
      return null;
    }
    const file = path.join(start.runDir, CLAUDE_CODE_SETTINGS_FILE);
    this.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
    return file;
  }
}

export function claudeCodeAdapter(spawnFn: SpawnFn, now: NowFn = (): Date => new Date(), writeFile?: LaunchFileWriter): ProviderAdapter {
  return new ClaudeCodeAdapter(spawnFn, now, writeFile);
}
