/**
 * The project's own store reference (req-316): `store:` in pipeline.md's
 * frontmatter — a local folder or a remote (`remote#branch`). The default
 * stays beside the repository (`store/fresh-store.ts`); the machine-wide
 * `dk.store` setting is the override for projects that name none. Pure
 * string in, pure string out; the fence rule is the one of
 * `shared/frontmatter.ts` (anchored at offset 0, a `---` further down is a
 * horizontal rule).
 */

const FENCE = /^---\n([\s\S]*?)\n(---[ \t]*(?:\n|$))([\s\S]*)$/;
const STORE_LINE = /^store:[ \t]*/;

/** The `store:` value of the frontmatter; `null` when the file has no fence or names none. */
export function readStoreRef(pipelineText: string | null): string | null {
  if (pipelineText === null) {
    return null;
  }
  const match = FENCE.exec(pipelineText);
  if (match === null) {
    return null;
  }
  const line = match[1].split('\n').find((candidate) => STORE_LINE.test(candidate));
  if (line === undefined) {
    return null;
  }
  const value = line.replace(STORE_LINE, '').trim();
  const unquoted = value.replace(/^(['"])(.*)\1$/, '$2').trim();
  return unquoted === '' ? null : unquoted;
}

/** Sets `store:` in pipeline.md's frontmatter, keeping every other line and the body. */
export function withStoreRef(pipelineText: string, store: string): string {
  const quoted = /^[a-z][a-z0-9+.-]*:\/\//i.test(store) || /[\s#"']/.test(store) ? `'${store}'` : store;
  const match = FENCE.exec(pipelineText);
  if (match === null) {
    return `---\nstore: ${quoted}\n---\n${pipelineText}`;
  }
  const [, yaml, , body] = match;
  const lines = yaml.split('\n');
  const at = lines.findIndex((candidate) => STORE_LINE.test(candidate));
  if (at >= 0) {
    lines[at] = `store: ${quoted}`;
  } else {
    lines.unshift(`store: ${quoted}`);
  }
  return `---\n${lines.join('\n')}\n---\n${body}`;
}
