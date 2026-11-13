/**
 * The live board migration's steps 3–5 (req-268, the persona board concept
 * §12) as the board offers them, one at a time and each only on the owner's
 * confirmation: once the store runs on the lifecycle stages (steps 1–2, the
 * Migrate of milestone 239), the meta vault still describes the phase board.
 *
 * - step 3 `pipeline` — `pipeline.md` keeps only the lifecycle columns
 *   (Inbox, Prioritized, Done) and gains the standard `flow:`; what the working
 *   columns carried for their runs (`min-class`, `needs`, `max-turns`,
 *   `max-work`) moves onto the builder's `persona.md`, `token-budget` stays a
 *   board key; one commit. This unpins `build-default`.
 * - step 4 `crew` — `crew.md`'s `order:` (Mission Control first, You last) and
 *   the leaving actions (the builder's `sync-main`, You's `commit`); one commit.
 * - step 5 `defaults` — `build-default` and `commit-default` are deleted, one
 *   commit each, by req-261's route (`personaRemove`, confirmed by the title).
 *
 * The board never runs a step on its own; `migrateBoard` runs steps 3 and 4,
 * step 5 is the renderer's `personaRemove` per persona.
 */
export type BoardMigrationStep = 'pipeline' | 'crew' | 'defaults';

/** Step 3: what `pipeline.md` loses and gains. */
export interface PipelineMigrationPlan {
  readonly step: 'pipeline';
  /** The columns that go (their titles). */
  readonly removed: readonly string[];
  /** The standard flow written as `flow:`; null = the file has one already. */
  readonly flow: string | null;
  /** The run keys that move onto a persona record; null = none to move (or no builder to take them). */
  readonly moved: { readonly persona: string; readonly keys: readonly string[] } | null;
  /** The token budget that stays as a top-level `token-budget:`; null = none. */
  readonly tokenBudget: number | null;
  /** Keys of the removed columns no ruling gives a home (`ci`, `audit`, `semantic`) — gone with the column. */
  readonly dropped: readonly string[];
}

/** Step 4: the crew's order and the leaving actions. */
export interface CrewMigrationPlan {
  readonly step: 'crew';
  /** The order written as `order:`; null = the file has one. */
  readonly order: readonly string[] | null;
  /** Leaving actions added to persona records. */
  readonly leaving: readonly { readonly persona: string; readonly action: 'sync-main' | 'commit' }[];
}

/** Step 5: the personas the legacy-key migration created, and whether a prompt differs from the builder's own. */
export interface DefaultsMigrationPlan {
  readonly step: 'defaults';
  readonly personas: readonly { readonly id: string; readonly title: string; readonly promptDiffers: boolean }[];
  /** The persona the prompts were compared with (the builder); null = none. */
  readonly comparedWith: string | null;
}

export type BoardMigrationOffer = PipelineMigrationPlan | CrewMigrationPlan | DefaultsMigrationPlan;

/** The personas step 5 deletes. */
export const LEGACY_DEFAULT_PERSONAS: readonly string[] = ['build-default', 'commit-default'];

/** What `migrateBoard` answers. */
export type BoardMigrationResult = { readonly ok: true; readonly warning?: string } | { readonly ok: false; readonly error: string };
