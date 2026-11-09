import type { ModelNeeds } from '../contracts/ticket-pool-meta';

/**
 * The `needs:` grammar (req-178, specs/ticket-schema.md): a list of tokens,
 * as a YAML list or one comma-separated line — `image`, `tools`,
 * `context-<n>` and `output-<n>` with `<n>` in tokens, `k` thousands or `m`
 * millions (`context-200k`, `output-32k`, `context-1m`). A ticket, a plan
 * part and a pipeline phase use the same grammar; a token outside it is
 * reported and left out, never guessed.
 */
export interface NeedsParse {
  readonly needs: ModelNeeds | null;
  readonly unknown: readonly string[];
}

const SIZE = /^(context|output)-(\d+(?:\.\d+)?)([km]?)$/;

function tokensOf(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => tokensOf(item));
  }
  if (typeof raw !== 'string') {
    return [];
  }
  return raw
    .split(/[,;]/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== '');
}

function tokenCount(amount: string, unit: string): number {
  const scale = unit === 'k' ? 1_000 : unit === 'm' ? 1_000_000 : 1;
  return Math.round(Number(amount) * scale);
}

/** Reads a `needs:` value; null needs when nothing valid was named. */
export function parseNeeds(raw: unknown): NeedsParse {
  const needs: { -readonly [K in keyof ModelNeeds]: ModelNeeds[K] } = {};
  const unknown: string[] = [];
  for (const token of tokensOf(raw)) {
    const size = SIZE.exec(token);
    if (token === 'image' || token === 'tools') {
      needs[token] = true;
    } else if (size !== null) {
      needs[size[1] === 'context' ? 'contextTokens' : 'outputTokens'] = tokenCount(size[2]!, size[3]!);
    } else {
      unknown.push(token);
    }
  }
  return { needs: Object.keys(needs).length === 0 ? null : needs, unknown };
}

function sizeText(tokens: number): string {
  if (tokens % 1_000_000 === 0) {
    return `${tokens / 1_000_000}m`;
  }
  return tokens % 1_000 === 0 ? `${tokens / 1_000}k` : String(tokens);
}

/** The canonical one-line form (`image, tools, context-200k, output-32k`); empty for no needs. */
export function needsText(needs: ModelNeeds | null | undefined): string {
  if (needs === null || needs === undefined) {
    return '';
  }
  return [
    needs.image === true ? 'image' : null,
    needs.tools === true ? 'tools' : null,
    needs.contextTokens !== undefined ? `context-${sizeText(needs.contextTokens)}` : null,
    needs.outputTokens !== undefined ? `output-${sizeText(needs.outputTokens)}` : null,
  ]
    .filter((token): token is string => token !== null)
    .join(', ');
}

const larger = (a: number | undefined, b: number | undefined): number | undefined => (a === undefined ? b : b === undefined ? a : Math.max(a, b));

/** Both sets at once (a phase's and a ticket's): every capability either names, the larger size. */
export function mergeNeeds(a: ModelNeeds | null | undefined, b: ModelNeeds | null | undefined): ModelNeeds | null {
  if (a === null || a === undefined) {
    return b ?? null;
  }
  if (b === null || b === undefined) {
    return a;
  }
  const contextTokens = larger(a.contextTokens, b.contextTokens);
  const outputTokens = larger(a.outputTokens, b.outputTokens);
  return {
    ...(a.image === true || b.image === true ? { image: true } : {}),
    ...(a.tools === true || b.tools === true ? { tools: true } : {}),
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}
