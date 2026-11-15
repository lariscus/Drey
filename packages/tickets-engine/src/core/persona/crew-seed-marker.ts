import { isSeq, parseDocument } from 'yaml';
import { splitFrontmatter } from '../../../../../shared/frontmatter';
import { crewRoot } from './crew-file';
import { patchCrewFile, type CrewWrite } from './crew-file-write';

/**
 * The `seeded-crew:` key of `tickets/_meta/crew.md` (req-256): the ids of the
 * shipped default crew the board has already been offered. A persona the
 * owner later deletes stays deleted because its id is in this list; a key
 * of the file the settings do not know, so a settings write keeps it (the
 * YAML patch only touches the keys it names).
 */
export const SEEDED_CREW_KEY = 'seeded-crew';

/**
 * The `seeded-pictures:` key (req-292): the ids whose shipped picture the
 * board has already been given (the default crew and `you`). A picture the
 * owner later removes stays removed because its id is in this list.
 */
export const SEEDED_PICTURES_KEY = 'seeded-pictures';

export type SeededKey = typeof SEEDED_CREW_KEY | typeof SEEDED_PICTURES_KEY;

/** The ids the file lists under `key`; tolerant — anything that is not a list of texts reads as none. */
export function seededListOf(text: string | null, key: SeededKey): readonly string[] {
  if (text === null) {
    return [];
  }
  const root = crewRoot(text);
  const raw = typeof root === 'string' ? undefined : root[key];
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()) : [];
}

/** The ids the `seeded-crew:` key lists. */
export function seededCrewOf(text: string | null): readonly string[] {
  return seededListOf(text, SEEDED_CREW_KEY);
}

/** The file with `seeded-crew: [<ids>]` set; every other key, comment and the prose stay. A file that does not parse is refused. */
export function withSeededCrew(before: string | null, ids: readonly string[]): CrewWrite {
  return withSeededList(before, SEEDED_CREW_KEY, ids);
}

/** The file with `<key>: [<ids>]` set, a flow list; every other key, comment and the prose stay. */
export function withSeededList(before: string | null, key: SeededKey, ids: readonly string[]): CrewWrite {
  const base = patchCrewFile(before, []);
  if (!base.ok) {
    return base;
  }
  const { yamlText, body } = splitFrontmatter(base.text);
  const doc = parseDocument(yamlText ?? '');
  doc.setIn([key], doc.createNode([...new Set(ids)]));
  const node = doc.getIn([key]);
  if (isSeq(node)) {
    node.flow = true;
  }
  return { ok: true, text: `---\n${doc.toString({ flowCollectionPadding: false })}---\n${body}` };
}
