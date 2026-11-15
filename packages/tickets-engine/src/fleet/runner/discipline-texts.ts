/**
 * The run brief's fixed texts (req-279, req-280): the disciplines as real
 * files in `packages/tickets-engine/prompts/disciplines/`, shipped beside
 * the compiled engine — beside the pipeline and crew prompts, one obvious
 * place to edit them. Each says one thing once; the composer appends the
 * ones a run kind needs (`instruction.ts`, `scout-instruction.ts`), so a
 * step prompt carries its role only (req-280, T1/T2). Stable strings: the
 * prompt cache prefix and the brief digest depend on the composed bytes,
 * so an edit here changes every brief (M85, ADR-0077). `{{question}}` and
 * `{{blocked}}` are the placeholders for the protocol markers; the loader
 * substitutes them (`prompt-file.ts` folds CRLF, drops the version marker
 * and the one trailing newline). A missing or empty file throws.
 */
import path from 'node:path';
import { SHIPPED_PROMPTS_DIR } from '../../core/config/default-prompts';
import { FOLLOWUPS_MARKER, MAX_FOLLOWUPS } from '../../core/ticket/followups';
import { loadPromptFragments, readPromptFile, type PromptFragments } from '../../core/config/prompt-file';
import { BLOCKED_MARKER, QUESTION_MARKER, SEND_BACK_MARKER } from '../protocol';

/** The discipline texts a run brief is composed from, plus the shared fragments a step prompt pulls in. */
export interface DisciplineTexts {
  /** Gated, non-interactive runs: what "done" means. */
  readonly completion: string;
  /** Writing, non-interactive runs: the `## Handover` the next step reads. */
  readonly handover: string;
  /** Interactive dialogs: the turn ends nothing. */
  readonly interactive: string;
  /** Every brief, last: the `QUESTION:` shape. */
  readonly asking: string;
  /** Scout runs: the end of an exploration. */
  readonly scout: string;
  /** Every brief's closing: the markers the runner acts on. */
  readonly signals: string;
  /** Every brief: reading, context, verification, the final message. */
  readonly working: string;
  /** Writing runs: writable places, the smallest change, criteria kept, commits. */
  readonly writing: string;
  /** Review and tester runs: no file changes, findings in the final message. */
  readonly readOnly: string;
  /** Writing runs: where the ticket lives and who writes which section. */
  readonly ticketFile: string;
  /**
   * req-299: dispatched runs that may propose follow-up tickets (every
   * non-interactive run but a scout): work beyond the step goes into a final
   * `FOLLOWUPS:` list, never into the diff.
   */
  readonly followups: string;
  /** Every brief: the language of what the owner reads. */
  readonly language: string;
  /** Every brief: this brief beats the repo's instructions. */
  readonly precedence: string;
  /**
   * req-257: a chain run's brief — the positions and the `SEND-BACK:` marker; `{{at}}`, `{{length}}`
   * and `{{positions}}` are filled per run by the composer (`instruction-sections.ts` `chainSection`).
   */
  readonly chain: string;
  /** The shared fragments (`{{plan-format}}`, `{{chain-grammar}}`). */
  readonly fragments: PromptFragments;
}

type DisciplineName = Exclude<keyof DisciplineTexts, 'fragments'>;

const DISCIPLINE_FILES: Readonly<Record<DisciplineName, string>> = {
  completion: 'completion.md',
  handover: 'handover.md',
  interactive: 'interactive.md',
  asking: 'asking.md',
  scout: 'scout.md',
  signals: 'signals.md',
  working: 'working.md',
  writing: 'writing.md',
  readOnly: 'read-only.md',
  ticketFile: 'ticket-file.md',
  followups: 'followups.md',
  language: 'language.md',
  precedence: 'precedence.md',
  chain: 'chain.md',
};

/** Reads one discipline file with the marker placeholders substituted. */
async function readDiscipline(dir: string, file: string): Promise<string> {
  const text = await readPromptFile(dir, path.join('disciplines', file), 'discipline');
  return text
    .replaceAll('{{question}}', QUESTION_MARKER)
    .replaceAll('{{blocked}}', BLOCKED_MARKER)
    .replaceAll('{{sendBack}}', SEND_BACK_MARKER)
    .replaceAll('{{followups}}', FOLLOWUPS_MARKER)
    .replaceAll('{{maxFollowups}}', String(MAX_FOLLOWUPS));
}

/** Every discipline text and fragment, from the shipped prompts dir by default. */
export async function loadDisciplineTexts(dir: string = SHIPPED_PROMPTS_DIR): Promise<DisciplineTexts> {
  const texts: Partial<Record<DisciplineName, string>> = {};
  for (const [name, file] of Object.entries(DISCIPLINE_FILES) as [DisciplineName, string][]) {
    texts[name] = await readDiscipline(dir, file);
  }
  return { ...(texts as Record<DisciplineName, string>), fragments: await loadPromptFragments(dir) };
}
