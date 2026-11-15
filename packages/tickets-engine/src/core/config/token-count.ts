import type { TokenizerView } from '../../contracts/skills';

/**
 * Token counts for the prompt preview and the skills listing (req-143,
 * req-172). No tokenizer ships with Drey: the Claude tokenizer is the
 * provider's (a network count against an API key the subscription workers do
 * not have) and OpenAI-compatible endpoints each bring their own. So a figure
 * is an **estimate** from the characters of the text, with the characters per
 * token of the model's family — never presented as exact (`exact: false`):
 *
 * - **anthropic** (the Claude Code worker, or a model id that names a Claude
 *   model): 3.5 characters per token of ASCII — Claude's tokenizer splits
 *   English prose and Markdown finer than the OpenAI one.
 * - **openai-compatible** (every other worker and model — the local endpoint,
 *   OpenRouter, Kimi, opencode): 4.0 characters per token, the figure the
 *   OpenAI documentation gives for English text.
 *
 * A character outside ASCII (CJK, emoji, an umlaut) counts three quarters of
 * a token on its own: those are the characters a byte-pair vocabulary
 * rarely holds whole. Swapping in an exact count is one class behind the
 * same function (a follow-up row), not a change of any caller.
 */

const ANTHROPIC_CHARS_PER_TOKEN = 3.5;
const OPENAI_CHARS_PER_TOKEN = 4;
const NON_ASCII_TOKENS = 0.75;

const CLAUDE_MODEL = /claude|opus|sonnet|haiku|fable/i;

/** The family a worker (and model, when it names one) counts with. */
export function tokenizerFor(worker: string | null, model: string | null): TokenizerView {
  const anthropic = worker === 'claude-code' || (model !== null && CLAUDE_MODEL.test(model));
  return anthropic
    ? { id: 'claude-estimate', family: 'anthropic', exact: false, model }
    : { id: 'openai-estimate', family: 'openai-compatible', exact: false, model };
}

/** Estimated tokens of a text under a tokenizer; 0 for an empty text, at least 1 otherwise. */
export function estimateTokens(text: string, tokenizer: Pick<TokenizerView, 'family'>): number {
  if (text === '') {
    return 0;
  }
  let ascii = 0;
  let other = 0;
  for (const char of text) {
    if (char.codePointAt(0)! < 128) {
      ascii += 1;
    } else {
      other += 1;
    }
  }
  const perToken = tokenizer.family === 'anthropic' ? ANTHROPIC_CHARS_PER_TOKEN : OPENAI_CHARS_PER_TOKEN;
  return Math.max(1, Math.ceil(ascii / perToken + other * NON_ASCII_TOKENS));
}
