/**
 * The stage migration a store waits for (req-265, concept §12 steps 1–2): `local` — Drey can do it
 * on the owner's click (two config commits on the store's `main`, the moves through `dk put`);
 * `manual` — the store's config is not Drey's to write (a remote store): the owner pastes
 * {@link toml} into `dricket.toml`, and the moves follow on the next Migrate.
 */
export interface StoreStageMigrationOffer {
  readonly mode: 'local' | 'manual';
  /** The old stages that go. */
  readonly legacy: readonly string[];
  /** Tickets that move to `active` (their column kept as the pin). */
  readonly moves: number;
  /** Config commits still to make (0 – 2). */
  readonly configCommits: number;
  /** The next `[stages]` table (step 1's while it is still to make, else step 2's): what `manual` pastes. */
  readonly toml: string;
  /** Why the config is the owner's to edit (`manual`); null for `local`. */
  readonly reason: string | null;
  /** A ticket someone holds a claim on: Migrate waits until it is free. */
  readonly waitFor: string | null;
}

/** What the Migrate action did. */
export type StoreStageMigrationResult =
  | { readonly ok: true; readonly configCommits: number; readonly moved: readonly string[] }
  | { readonly ok: false; readonly error: string; readonly moved?: readonly string[] };
