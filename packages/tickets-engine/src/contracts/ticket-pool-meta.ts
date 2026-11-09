/**
 * The ticket keys the capacity pool reads (req-170, specs/ticket-schema.md;
 * dricket: `x-class`, `x-model`, `x-size`, `x-allowance`, `x-needs`). All
 * optional — the reader sets a field only when the file names a valid value.
 */
export interface TicketPoolMeta {
  /** The class pin (`class: A`): the run asks the pool for exactly this class. */
  readonly class?: 'A' | 'B' | 'C' | null;
  /** The model pin (`model: claude-opus-4-1`): the run asks for this model of the table; it beats every class rule. */
  readonly model?: string | null;
  /** The plan part's size (`size: S|M|L`): it asks for class C, B or A. */
  readonly size?: 'S' | 'M' | 'L' | null;
  /** The ticket's allowance in USD (`allowance: 2.50`); absent = the default of Settings → Models. */
  readonly allowance?: number | null;
  /** What the run's model must be able to do (`needs: image, context-200k`, req-178); absent = nothing beyond the class. */
  readonly needs?: ModelNeeds | null;
}

/** A pipeline phase's pool keys (pipeline.md). */
export interface PhasePoolMeta {
  /** The phase's class floor (`min-class:`, req-170): no run of it asks the pool for a lighter class; absent = none. */
  readonly minClass?: 'A' | 'B' | 'C' | null;
  /** What every run of the phase needs of its model (`needs: image`, req-178); merged with the ticket's; absent = nothing. */
  readonly needs?: ModelNeeds | null;
}

/**
 * A step's required model capabilities (`needs:` on a ticket, a plan part or
 * a pipeline phase — req-178, specs/ticket-schema.md): image input, tool
 * calls, a context and an output size. The routing's filter takes only a
 * model whose row declares them; an absent field asks for nothing.
 */
export interface ModelNeeds {
  /** Image input (`image`) — a step that reads screenshots. */
  readonly image?: boolean;
  /** Tool calls declared (`tools`); every agent session uses them, so only an explicit need asks for the declaration. */
  readonly tools?: boolean;
  /** The context window it needs, in tokens (`context-200k`). */
  readonly contextTokens?: number;
  /** The output it needs per answer, in tokens (`output-32k`). */
  readonly outputTokens?: number;
}
