import * as path from 'node:path';

/** opencode's `auth.json`: `$XDG_DATA_HOME/opencode/auth.json`, else `~/.local/share/opencode/auth.json`. */
export function opencodeAuthFileOf(env: Readonly<Record<string, string | undefined>>, userHome: string): string {
  const data = env['XDG_DATA_HOME'];
  return path.join(data !== undefined && data !== '' ? data : path.join(userHome, '.local', 'share'), 'opencode', 'auth.json');
}
