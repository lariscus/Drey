import { isSeq, parseDocument } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';
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

/** The ids the file lists; tolerant — anything that is not a list of texts reads as none. */
export function seededCrewOf(text: string | null): readonly string[] {
  if (text === null) {
    return [];
  }
  const root = crewRoot(text);
  const raw = typeof root === 'string' ? undefined : root[SEEDED_CREW_KEY];
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()) : [];
}

/** The file with `seeded-crew: [<ids>]` set; every other key, comment and the prose stay. A file that does not parse is refused. */
export function withSeededCrew(before: string | null, ids: readonly string[]): CrewWrite {
  const base = patchCrewFile(before, []);
  if (!base.ok) {
    return base;
  }
  const { yamlText, body } = splitFrontmatter(base.text);
  const doc = parseDocument(yamlText ?? '');
  doc.setIn([SEEDED_CREW_KEY], doc.createNode([...new Set(ids)]));
  const node = doc.getIn([SEEDED_CREW_KEY]);
  if (isSeq(node)) {
    node.flow = true;
  }
  return { ok: true, text: `---\n${doc.toString({ flowCollectionPadding: false })}---\n${body}` };
}
