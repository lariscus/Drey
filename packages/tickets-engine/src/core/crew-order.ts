import { isSeq, parseDocument } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';
import { crewRoot } from './crew-file';
import { patchCrewFile, type CrewWrite } from './crew-file-write';
import { inPipelineOrder, type Persona } from './persona';

/**
 * The crew's order (req-258, the persona board concept §9): `order:` in
 * `tickets/_meta/crew.md`, a list of persona ids. The Crew tab draws the
 * personas in it and its drag writes it; the board's persona columns follow
 * it (req-271). A persona the list does not name follows the listed ones in
 * the old pipeline order (role, then id, the human last), so a board whose
 * file has no `order:` yet looks as it did.
 */
export const CREW_ORDER_KEY = 'order';

/** The ids the file lists, deduplicated; tolerant — anything that is not a list of texts reads as none. */
export function crewOrderOf(text: string | null): readonly string[] {
  if (text === null) {
    return [];
  }
  const root = crewRoot(text);
  const raw = typeof root === 'string' ? undefined : root[CREW_ORDER_KEY];
  return Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()))] : [];
}

/** The personas in the crew's order: the listed ones as listed, then the rest in pipeline order. */
export function inCrewOrder<P extends Pick<Persona, 'id' | 'role' | 'kind'>>(personas: readonly P[], order: readonly string[]): P[] {
  const listed = order.map((id) => personas.find((persona) => persona.id === id)).filter((persona): persona is P => persona !== undefined);
  const rest = personas.filter((persona) => !order.includes(persona.id));
  return [...listed, ...inPipelineOrder(rest)];
}

/** The file with `order: [<ids>]` set; every other key, comment and the prose stay. A file that does not parse is refused. */
export function withCrewOrder(before: string | null, ids: readonly string[]): CrewWrite {
  const base = patchCrewFile(before, []);
  if (!base.ok) {
    return base;
  }
  const { yamlText, body } = splitFrontmatter(base.text);
  const doc = parseDocument(yamlText ?? '');
  doc.setIn([CREW_ORDER_KEY], doc.createNode([...new Set(ids)]));
  const node = doc.getIn([CREW_ORDER_KEY]);
  if (isSeq(node)) {
    node.flow = true;
  }
  return { ok: true, text: `---\n${doc.toString({ flowCollectionPadding: false })}---\n${body}` };
}
