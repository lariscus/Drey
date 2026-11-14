/**
 * The Drey ticket keys that ride in a dricket `x-` extension field, in header
 * order (ADR-0090) — one list for the read (`store-board`) and the write
 * (`legacy-bridge`). req-170 added the pool's `class`, `model`, `size` and
 * `allowance`, req-178 its `needs`, req-266 the chain's cursor `at` and its `sent-back`, req-78 the red-gate loop's `return-to` and `red-backs`
 * (the chain itself rides as `x-chain`, its entries joined by `;`), req-282 the
 * ticket's `project`.
 */
export const EXTENSION_KEYS = ['worker', 'persona', 'track', 'form', 'proof', 'awaiting', 'class', 'model', 'size', 'allowance', 'needs', 'at', 'sent-back', 'return-to', 'red-backs', 'project'] as const;
