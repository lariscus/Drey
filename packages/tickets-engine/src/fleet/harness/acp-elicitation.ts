/**
 * A question form over ACP (req-182): opencode's `question` tool reaches a
 * client that advertises `elicitation.form` as an `elicitation/create`
 * request — `requestedSchema` holds one property per question (`q0`, a
 * string with `oneOf` choices, or an array with `items.anyOf` for several)
 * and, where the owner may answer in their own words, a companion
 * `<key>_custom` string. The reply is `{ action: 'accept', content }`.
 * Measured against opencode 2.0.32.
 */
import type { QuestionAnswers, WaitQuestion } from '../protocol';

/** The suffix of the free-text companion of a question's choices. */
const CUSTOM_SUFFIX = '_custom';

type Choice = { readonly const?: unknown; readonly title?: unknown; readonly description?: unknown };

interface Property {
  readonly type?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly oneOf?: readonly Choice[];
  readonly items?: { readonly anyOf?: readonly Choice[] };
}

/** The asked form: its questions, and which keys take free text. */
export interface ElicitedForm {
  readonly questions: readonly WaitQuestion[];
  /** Question keys whose companion `<key>_custom` takes the owner's own words. */
  readonly customKeys: ReadonlySet<string>;
  /** Per question key: the choice labels by their wire value. */
  readonly values: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function choicesOf(p: Property): readonly Choice[] {
  return (Array.isArray(p.oneOf) ? p.oneOf : Array.isArray(p.items?.anyOf) ? p.items!.anyOf : []) ?? [];
}

/** The questions of an `elicitation/create` request's schema; empty when it holds none. */
export function elicitedForm(params: Readonly<Record<string, unknown>>): ElicitedForm {
  const schema = (params['requestedSchema'] ?? {}) as { properties?: Record<string, Property> };
  const props = Object.entries(schema.properties ?? {});
  const keys = new Set(props.map(([k]) => k));
  const questions: WaitQuestion[] = [];
  const values = new Map<string, Map<string, string>>();
  for (const [key, p] of props.filter(([k]) => !(k.endsWith(CUSTOM_SUFFIX) && keys.has(k.slice(0, -CUSTOM_SUFFIX.length))))) {
    const choices = choicesOf(p).filter((c) => str(c.const) !== '');
    values.set(key, new Map(choices.map((c) => [str(c.title) || str(c.const), str(c.const)])));
    const header = str(p.title).trim();
    questions.push({
      key,
      ...(header !== '' ? { header } : {}),
      question: str(p.description).trim() || header || str(params['message']) || 'The worker asks you',
      options: choices.map((c) => ({ label: str(c.title) || str(c.const), ...(typeof c.description === 'string' ? { description: c.description } : {}) })),
      multiple: p.type === 'array',
    });
  }
  return { questions, customKeys: new Set([...keys].filter((k) => keys.has(`${k}${CUSTOM_SUFFIX}`))), values };
}

/** One answer: a choice goes in by its wire value, anything else into the free-text companion when there is one. */
function answerOne(form: ElicitedForm, q: WaitQuestion, said: string | readonly string[], content: Record<string, unknown>): void {
  const byLabel = form.values.get(q.key) ?? new Map<string, string>();
  const valueOf = (text: string): string | null => {
    const hit = [...byLabel.entries()].find(([label, value]) => label.toLowerCase() === text.toLowerCase() || value.toLowerCase() === text.toLowerCase());
    return hit === undefined ? null : hit[1];
  };
  const parts = (typeof said === 'string' ? [said] : [...said]).map((t) => t.trim()).filter((t) => t !== '');
  const chosen = parts.map(valueOf).filter((v): v is string => v !== null);
  const own = parts.filter((t) => valueOf(t) === null);
  if (chosen.length > 0) {
    content[q.key] = q.multiple ? chosen : chosen[0];
  }
  if (own.length > 0 && form.customKeys.has(q.key)) {
    content[`${q.key}${CUSTOM_SUFFIX}`] = own.join(', ');
  } else if (own.length > 0 && chosen.length === 0) {
    content[q.key] = q.multiple ? own : own[0]; // no companion: the words go into the field, the agent reads them
  }
}

/** The `elicitation/create` reply content for the owner's answers. */
export function elicitationContent(form: ElicitedForm, answers: QuestionAnswers): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const q of form.questions) {
    const said = answers[q.key];
    if (said !== undefined) {
      answerOne(form, q, said, content);
    }
  }
  return content;
}
