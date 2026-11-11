import { defaultGitRun, type GitRun } from './store-git-probe';

/**
 * The text of a dricket store's `dricket.toml` (D-11, req-265): where dk finds it and how a table of
 * it is cut out. The file lives on the store's `main` branch, never on the ticket branch. Pure apart
 * from {@link readStoreConfigText}, which asks git.
 */

/** Where dk finds the config: its private ref of a remote store, the local `main`, the checkout's remote branch. */
export const CONFIG_REFS = ['refs/dricket/config', 'main', 'origin/main'] as const;

/** One line without its `#` comment (a `#` inside a quoted string stays). */
export function stripTomlComment(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      quoted = !quoted;
    } else if (line[i] === '#' && !quoted) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** The body of `[name]` without comments, or null when the file has no such table. */
export function tomlTable(toml: string, name: string): string | null {
  const lines = toml.split(/\r?\n/).map(stripTomlComment);
  const start = lines.findIndex((line) => line.trim() === `[${name}]`);
  if (start === -1) {
    return null;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\s*\[[^\]"]*\]\s*$/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** A `key = ["a", "b"]` list of a table body; null when the key is absent. */
export function tomlList(table: string, key: string): string[] | null {
  const values = new RegExp(`(?:^|\\n)\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`).exec(table)?.[1];
  return values === undefined ? null : [...values.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

/** A `key = "value"` string of a table body; null when the key is absent. */
export function tomlString(table: string, key: string): string | null {
  return new RegExp(`(?:^|\\n)\\s*${key}\\s*=\\s*"([^"]+)"`).exec(table)?.[1] ?? null;
}

/** The store's `dricket.toml` and the ref it came from, or null when no ref holds one. */
export async function readStoreConfigText(checkout: string, run: GitRun = defaultGitRun): Promise<{ readonly ref: string; readonly text: string } | null> {
  for (const ref of CONFIG_REFS) {
    try {
      return { ref, text: await run(['show', `${ref}:dricket.toml`], checkout) };
    } catch {
      // Not this ref: the next one, then "unknown".
    }
  }
  return null;
}
