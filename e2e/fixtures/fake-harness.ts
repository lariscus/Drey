import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * A folder of fake coding-agent CLIs for model discovery's e2e (req-286):
 * `claude`, `opencode` and `kimi` shims over `fake-harness.cjs`, no
 * `copilot` (so it reads as not installed). Put first on `PATH` before the
 * app starts, it shadows any real CLI — the e2e never runs a real harness
 * against the owner's accounts.
 */
export function fakeHarnessDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-e2e-harness-'));
  const script = path.join(__dirname, 'fake-harness.cjs');
  for (const name of ['claude', 'opencode', 'kimi']) {
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(dir, `${name}.cmd`), `@"${process.execPath}" "${script}" ${name} %*\r\n`);
    } else {
      const file = path.join(dir, name);
      fs.writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${script}" ${name} "$@"\n`);
      fs.chmodSync(file, 0o755);
    }
  }
  return dir;
}

/** `PATH` with the fake folder first. */
export function pathWithFakes(dir: string): string {
  return `${dir}${path.delimiter}${process.env['PATH'] ?? process.env['Path'] ?? ''}`;
}
