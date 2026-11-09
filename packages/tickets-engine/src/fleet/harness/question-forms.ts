/**
 * A worker's question form and the owner's answer to it (req-64):
 * opencode's `question` tool asks through an ACP form (`elicitation/create`,
 * read in `acp-elicitation.ts`), Kimi through a held request; the runner
 * shows one wait shape and reads the owner's typed text back into answers.
 */
import type { QuestionAnswers, WaitQuestion } from '../protocol';

/** One line for a question form: the first question, and how many more follow. */
export function formText(questions: readonly WaitQuestion[]): string {
  const first = questions[0]?.question ?? 'The worker asks you';
  return questions.length > 1 ? `${first} (+${questions.length - 1} more)` : first;
}

/** A choice named by its number or its label, else the owner's own words. */
function pick(q: WaitQuestion, token: string): string {
  const n = /^\d+$/.test(token) ? Number(token) : NaN;
  if (n >= 1 && n <= q.options.length) {
    return q.options[n - 1]!.label;
  }
  return q.options.find((o) => o.label.toLowerCase() === token.toLowerCase())?.label ?? token;
}

/**
 * The owner's typed answer to a question form. One question takes the
 * whole text; several take one line each, in order. Comma-separated
 * choices for a multiple choice.
 */
export function answersFromText(questions: readonly WaitQuestion[], text: string): QuestionAnswers {
  const lines = questions.length > 1 ? text.split('\n').map((l) => l.trim()).filter((l) => l !== '') : [text.trim()];
  const answers: Record<string, string | string[]> = {};
  questions.forEach((q, i) => {
    const line = lines[i];
    if (line !== undefined && line !== '') {
      answers[q.key] = q.multiple ? line.split(',').map((t) => pick(q, t.trim())).filter((t) => t !== '') : pick(q, line);
    }
  });
  return answers;
}

/** One line for the transcript: what the owner answered. */
export function answersText(questions: readonly WaitQuestion[], answers: QuestionAnswers): string {
  return questions
    .map((q) => {
      const a = answers[q.key];
      const said = a === undefined ? '—' : typeof a === 'string' ? a : a.join(', ');
      return questions.length > 1 ? `${q.header ?? q.key}: ${said}` : said;
    })
    .join('; ');
}
