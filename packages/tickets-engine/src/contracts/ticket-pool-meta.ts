/**
 * The ticket keys the capacity pool reads (req-170, specs/ticket-schema.md;
 * dricket: `x-class`, `x-model`, `x-size`, `x-allowance`). All optional —
 * the reader sets a field only when the file names a valid value.
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
}
