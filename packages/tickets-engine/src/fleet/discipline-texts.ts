/**
 * The run brief's fixed closing texts (req-279): the five disciplines as
 * real files in `packages/tickets-engine/prompts/disciplines/`, shipped
 * beside the compiled engine — beside the pipeline and crew prompts, one
 * obvious place to edit them. Stable strings: the prompt cache prefix
 * and the brief digest depend on the composed bytes, so an edit here
 * changes every brief (M85, ADR-0077). `{{question}}` and `{{blocked}}`
 * are the placeholders for the protocol markers; the loader substitutes
 * them and drops exactly the one trailing newline the files carry, so
 * the composed briefs stay byte-identical to the constants they
 * replaced. A missing or empty file throws, naming the file.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { SHIPPED_PROMPTS_DIR } from '../core/default-prompts';
import { BLOCKED_MARKER, QUESTION_MARKER } from './protocol';

/** The discipline texts every run brief ends with (completion, handover, dialog, asking, scout). */
export interface DisciplineTexts {
  readonly completion: string;
  readonly handover: string;
  readonly interactive: string;
  readonly asking: string;
  readonly scout: string;
}

const DISCIPLINE_FILES: readonly (keyof DisciplineTexts)[] = ['completion', 'handover', 'interactive', 'asking', 'scout'];

/** Reads one discipline file: CRLF folded, the trailing newline dropped, the marker placeholders substituted. */
async function readDiscipline(dir: string, name: keyof DisciplineTexts): Promise<string> {
  const rel = path.join('disciplines', `${name}.md`);
  const text = await fsp.readFile(path.join(dir, rel), 'utf8').catch(() => null);
  if (text === null) {
    throw new Error(`the discipline ${rel} is missing from ${dir}`);
  }
  const stripped = text
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '')
    .replaceAll('{{question}}', QUESTION_MARKER)
    .replaceAll('{{blocked}}', BLOCKED_MARKER);
  if (stripped === '') {
    throw new Error(`the discipline ${rel} in ${dir} is empty`);
  }
  return stripped;
}

/** Every discipline text, from the shipped prompts dir by default. */
export async function loadDisciplineTexts(dir: string = SHIPPED_PROMPTS_DIR): Promise<DisciplineTexts> {
  const texts: Record<keyof DisciplineTexts, string> = { completion: '', handover: '', interactive: '', asking: '', scout: '' };
  for (const name of DISCIPLINE_FILES) {
    texts[name] = await readDiscipline(dir, name);
  }
  return texts;
}
