/**
 * The Drey ticket keys that ride in a dricket `x-` extension field, in header
 * order (ADR-0090) — one list for the read (`store-board`) and the write
 * (`legacy-bridge`). req-170 added the pool's `class`, `model`, `size` and
 * `allowance`, req-178 its `needs`.
 */
export const EXTENSION_KEYS = ['worker', 'persona', 'track', 'form', 'proof', 'awaiting', 'class', 'model', 'size', 'allowance', 'needs'] as const;
