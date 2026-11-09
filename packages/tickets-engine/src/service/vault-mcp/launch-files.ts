/**
 * The files a harness reads its vault MCP configuration from (req-167 —
 * Claude Code's `--mcp-config`): written owner-only into the run's folder
 * before the spawn, removed when the worker exits. Synchronous because the
 * spawn path is: the file must exist before the CLI starts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface LaunchFiles {
  write(file: string, text: string): void;
  remove(file: string): void;
}

export class NodeLaunchFiles implements LaunchFiles {
  write(file: string, text: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
  }

  remove(file: string): void {
    fs.rmSync(file, { force: true });
  }
}
