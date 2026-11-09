/**
 * `tickets/_meta/crew.md` written (req-173): a patch applied to the YAML
 * document in place — the keys it does not name, their comments, keys of
 * other features (req-169's closing-round signals) and the prose under the
 * fence all stay. A file whose YAML does not parse is refused, never
 * overwritten.
 */
import { isMap, parseDocument, type Document } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';
import { crewFieldOf, type CrewOverridePatch, type CrewPatch } from '../contracts/crew-config';
import { crewValueOf, overridePath } from './crew-file';

export type { CrewOverridePatch } from '../contracts/crew-config';

export type CrewWrite = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };

/** What a fresh file says under its frontmatter. */
export const CREW_PROSE = 'The crew\'s defaults and limits for every device that works this tickets repository. Absent keys take the built-in defaults.\n';

function valueText(value: number | string | null): unknown {
  return value === null ? 'off' : value;
}

/** Removes the now-empty parent mappings of a deleted key (`caps:` with nothing left in it goes). */
function prune(doc: Document, path: readonly string[]): void {
  for (let depth = path.length - 1; depth > 0; depth--) {
    const parent = doc.getIn(path.slice(0, depth));
    if (isMap(parent) && parent.items.length === 0) {
      doc.deleteIn(path.slice(0, depth));
    }
  }
}

function applyValue(doc: Document, patch: CrewPatch): string | null {
  const field = crewFieldOf(patch.key);
  if (field === null) {
    return `crew.md has no key "${patch.key}"`;
  }
  if (patch.value === undefined) {
    doc.deleteIn(field.path);
    prune(doc, field.path);
    return null;
  }
  if (crewValueOf(field, patch.value === null ? 'off' : patch.value) === undefined) {
    return `${patch.key}: "${String(patch.value)}" is not a valid ${field.kind}`;
  }
  doc.setIn(field.path, valueText(patch.value));
  return null;
}

function applyOverride(doc: Document, patch: CrewOverridePatch): string | null {
  if (patch.name.trim() === '') {
    return 'an override names its worker';
  }
  const path = [...overridePath(patch.map), patch.name.trim()];
  if (patch.value === undefined) {
    doc.deleteIn(path);
    prune(doc, path);
    return null;
  }
  if (!Number.isFinite(patch.value) || patch.value < 0) {
    return `${path.join('.')}: ${patch.value} is not a number of tokens`;
  }
  doc.setIn(path, patch.value);
  return null;
}

/**
 * The file with the patches applied; `before` null = a fresh file with
 * the default prose. The result always carries a fence.
 */
export function patchCrewFile(before: string | null, values: readonly CrewPatch[], overrides: readonly CrewOverridePatch[] = []): CrewWrite {
  const split = before === null ? { yamlText: '', body: '', hadFence: false } : splitFrontmatter(before);
  const body = split.hadFence ? split.body : `\n${before ?? CREW_PROSE}`;
  const doc = parseDocument(split.yamlText ?? '');
  if (doc.errors.length > 0) {
    return { ok: false, error: `crew.md does not parse: ${doc.errors[0]!.message} — fix the file first` };
  }
  if (doc.contents === null) {
    doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  }
  for (const patch of values) {
    const error = applyValue(doc, patch);
    if (error !== null) {
      return { ok: false, error };
    }
  }
  for (const patch of overrides) {
    const error = applyOverride(doc, patch);
    if (error !== null) {
      return { ok: false, error };
    }
  }
  const yaml = isMap(doc.contents) && doc.contents.items.length === 0 ? '\n' : doc.toString();
  return { ok: true, text: `---\n${yaml}---\n${body}` };
}
