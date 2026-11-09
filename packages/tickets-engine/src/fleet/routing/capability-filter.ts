import type { ModelCapabilities, ModelNeeds } from '../protocol';

/** `200000` → `200k`, `1000000` → `1m`. */
export function tokensText(tokens: number): string {
  if (tokens >= 1_000_000 && tokens % 100_000 === 0) {
    return `${tokens / 1_000_000}m`;
  }
  return tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : String(tokens);
}

/**
 * The capability half of the routing's filter (req-178): a step's `needs:`
 * against a model row's declared columns. A capability the step needs must
 * be declared — "not declared" is a refusal of its own, so the owner sees
 * which column to fill in. Every agent session makes tool calls: a row
 * that declares `tools: false` never runs one, whatever the step names.
 */
export class CapabilityFilter {
  /** Why the model cannot serve the step (`no image input`, `context 128k < 200k`); null when it can. */
  refusal(row: ModelCapabilities | null, needs: ModelNeeds | null, contextTokens: number | null): string | null {
    if (row !== null && row.tools === false) {
      return 'no tool calls';
    }
    const context = Math.max(needs?.contextTokens ?? 0, contextTokens ?? 0);
    if (needs === null && context === 0) {
      return null;
    }
    return row === null ? 'not in the model table, its capabilities are unknown' : this.declared(row, needs, context);
  }

  private declared(row: ModelCapabilities, needs: ModelNeeds | null, context: number): string | null {
    return this.image(row, needs) ?? this.tools(row, needs) ?? this.size(row.context, context, 'context') ?? this.size(row.output, needs?.outputTokens ?? 0, 'output');
  }

  private image(row: ModelCapabilities, needs: ModelNeeds | null): string | null {
    if (needs?.image !== true) {
      return null;
    }
    if (row.input === undefined) {
      return 'image input not declared';
    }
    return row.input.includes('image') ? null : 'no image input';
  }

  private tools(row: ModelCapabilities, needs: ModelNeeds | null): string | null {
    return needs?.tools === true && row.tools !== true ? 'tool calls not declared' : null;
  }

  private size(declared: number | undefined, needed: number, what: 'context' | 'output'): string | null {
    if (needed <= 0) {
      return null;
    }
    if (declared === undefined) {
      return `${what} size not declared`;
    }
    return declared < needed ? `${what} ${tokensText(declared)} < ${tokensText(needed)}` : null;
  }
}
