import type { ClosingSignal } from '../core/closing-signals';
import { MAX_IMPROVEMENT_CONTENT } from '../core/improvements';
import { parsePromptEdits, type PromptEdit } from '../core/prompt-edits';
import { FINDING_CAUSES, oneLine, type FindingCause, type JournalFinding } from '../core/persona-journal';

/**
 * The closing round's one prompt and its answer (R14, req-169; the text is
 * in `specs/classifier-spec.md`): after the gate verdict of a noteworthy run
 * the worker's own session is asked, once, where the run stumbled — a
 * journal finding — and whether it holds a lesson for the next run. The
 * answer is one JSON object; whatever does not parse is dropped, never
 * guessed. Prompt, skill and model changes ride only as a proposal the
 * owner decides (R11): the round never adopts. A prompt.md proposal is a
 * set of exact edits against the current file (req-280, T5), applied when
 * the proposal is written (`RoundProposalWriter`).
 */

export interface ClosingRoundFacts {
  readonly ticketId: string;
  /** The gate's verdict; `none` when no gate ran (a blocked step, a scout run — req-280). */
  readonly gate: 'green' | 'red' | 'none';
  /** The gate failure's first line, on a red gate. */
  readonly gateFailure: string | null;
  readonly signals: readonly ClosingSignal[];
  readonly steerCount: number;
  readonly costUsd: number | null;
  readonly typicalCostUsd: number | null;
  readonly friction: string | null;
  /** The worker saved its one lesson through `memory_write` during the run (req-226); absent = it did not. */
  readonly lessonWritten?: boolean;
}

export type ClosingProposalTarget = 'prompt.md' | 'models.default';

export interface ClosingProposal {
  readonly target: ClosingProposalTarget;
  readonly title: string;
  /** The model id (`models.default`); empty for a prompt.md proposal, whose text the writer derives from `edits`. */
  readonly content: string;
  /** The prompt.md proposal's exact edits (req-280); absent for a model proposal. */
  readonly edits?: readonly PromptEdit[];
}

export interface ClosingAnswer {
  readonly finding: JournalFinding | null;
  readonly friction: string | null;
  readonly lesson: string | null;
  readonly proposal: ClosingProposal | null;
}

/** The caps of what the runner keeps from an answer (the round's output cap). */
export const CLOSING_FINDING_MAX = 400;
export const CLOSING_FRICTION_MAX = 200;
export const CLOSING_LESSON_MAX = 200;
export const CLOSING_TITLE_MAX = 120;

function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** One line per signal: why the run is asked at all. */
function signalLine(signal: ClosingSignal, facts: ClosingRoundFacts): string {
  switch (signal) {
    case 'red-gate':
      return `- the machine gate failed${facts.gateFailure !== null ? `: ${oneLine(facts.gateFailure, 200)}` : ''}`;
    case 'retry':
      return '- this run repeated a step whose previous run failed its gate';
    case 'steer':
      return `- the owner stepped in ${facts.steerCount} time${facts.steerCount === 1 ? '' : 's'} while you worked`;
    case 'cost':
      return `- it cost ${facts.costUsd !== null ? money(facts.costUsd) : 'far more'}${facts.typicalCostUsd !== null ? `; this persona's typical run costs ${money(facts.typicalCostUsd)}` : ''}`;
    case 'friction':
      return `- you reported friction: "${oneLine(facts.friction ?? '', CLOSING_FRICTION_MAX)}"`;
  }
}

/** The round's prompt — the second prompt of the run's own session. */
export function closingRoundPrompt(facts: ClosingRoundFacts): string {
  return [
    `The step on ${facts.ticketId} is over: ${facts.gate === 'none' ? 'no machine gate ran' : `the machine gate is ${facts.gate}`}. This is a short closing round — do not run tools, do not edit files; nothing changes any more.`,
    '',
    'Why this run is looked at:',
    ...facts.signals.map((signal) => signalLine(signal, facts)),
    '',
    'Answer with exactly one JSON object and nothing outside it — no prose, no markdown fences:',
    '{"finding":{"cause":"model|prompt|task|environment","text":"..."},"friction":"...","lesson":"...","proposal":null}',
    `- finding: where the run stumbled and why. cause "model" when a stronger or different model would have avoided it, "prompt" when the brief, the prompt or the skills lacked something, "task" when the ticket itself was unclear or wrong, "environment" for the repo, the tools or the machine. At most ${CLOSING_FINDING_MAX} characters; null when nothing stumbled.`,
    `- friction: what you lacked, guessed or hit twice — one line, at most ${CLOSING_FRICTION_MAX} characters; null when nothing.`,
    facts.lessonWritten === true
      ? "- lesson: null — you already saved this run's one lesson with memory_write while you worked."
      : `- lesson: one line the NEXT run of this persona should know — a concrete, reusable rule, not a story of this run; at most ${CLOSING_LESSON_MAX} characters. A wrong lesson misleads every later run: when in doubt, null.`,
    '- proposal: null, or a change the owner decides: {"target":"prompt.md","title":"...","edits":[{"old":"...","new":"..."}]} when the persona\'s prompt should change — each "old" copied exactly from the prompt you were given and found there once, "new" its replacement, the smallest edits that do it — or {"target":"models.default","title":"...","content":"<model id>"} when the model should.',
  ].join('\n');
}

/** The answer's JSON object: the first `{` to the last `}`, fences tolerated. */
function objectOf(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function textOf(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const line = oneLine(value, max);
  return line === '' || /^(none|null|n\/a|-)\.?$/i.test(line) ? null : line;
}

function findingOf(value: unknown): JournalFinding | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const text = textOf(obj['text'], CLOSING_FINDING_MAX);
  const cause = obj['cause'];
  if (text === null || typeof cause !== 'string' || !(FINDING_CAUSES as readonly string[]).includes(cause)) {
    return null;
  }
  return { cause: cause as FindingCause, text };
}

function proposalOf(value: unknown): ClosingProposal | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const target = obj['target'];
  const title = textOf(obj['title'], CLOSING_TITLE_MAX);
  if (title === null) {
    return null;
  }
  if (target === 'prompt.md') {
    const edits = parsePromptEdits(obj['edits']);
    return edits === null ? null : { target, title, content: '', edits };
  }
  const content = typeof obj['content'] === 'string' ? obj['content'].trim() : '';
  if (target !== 'models.default' || content === '' || content.length > MAX_IMPROVEMENT_CONTENT) {
    return null;
  }
  return { target, title, content: oneLine(content, 120) };
}

/** The round's answer, or null when no JSON object parses out of it. */
export function parseClosingAnswer(text: string): ClosingAnswer | null {
  const obj = objectOf(text);
  if (obj === null) {
    return null;
  }
  return {
    finding: findingOf(obj['finding']),
    friction: textOf(obj['friction'], CLOSING_FRICTION_MAX),
    lesson: textOf(obj['lesson'], CLOSING_LESSON_MAX),
    proposal: proposalOf(obj['proposal']),
  };
}
