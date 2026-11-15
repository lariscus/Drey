# Drey on dricket only — what goes, what stays (req-307 + E14-9b)

Owner, 2026-11-14/15: "ignore backward compatibility, I will set up everything manually again … I never released it";
"entferne das alte backend". This supersedes the inventory of part (a)
([decommission.md](decommission.md)): its classes B and C all go now, together with the phase board that
the persona board ([ADR-0098](../../09_architecture_decisions/0098-the-persona-board.md)) replaced.

## The rule

There is **one backend** (a dricket store on the lifecycle stages `inbox · prioritized · active · running · done`,
`claim = ["running"]`) and **one board** (the persona board). Whatever reads, writes, migrates or tolerates another
shape goes. A store that is not on the lifecycle stages is not offered a migration: the board says what is wrong and
the owner creates a new one.

## Goes

| Area | Removed |
|---|---|
| **Legacy phone remote** | `plugins/tickets/remote/` (3 400 lines), `server/fallback-client.ts`, `server/client-dir.ts`, the gateway's fallback files, the two `tickets-remote*` e2e specs and their desk fixture, the build step and tsconfig entries |
| **Migration tool** | `packages/tickets-engine/src/migrate/` (legacy reader, converter, apply, reverse converter, shadow diff, report, cli), `scripts/migrate-tickets.mjs` |
| **Shadow** | `store/store-shadow.ts`, `store/board-diff.ts`, the `shadow` value of `tickets.backend` and the report folder |
| **Files backend** | `store/file-ticket-store.ts`, the `files` value of `TicketBackend` and the `tickets.backend` key itself, every `dricket === null` fork of `BoardService` (card files, git commits of cards, folder moves, run stamps, the `.status.log` line), `core/phase-dirs.ts`, `core/normalize.ts` (drift), the file IO half of `core/transition.ts`, `core/status-log.ts`, the files-only ledger writers, `files-guard` (engine, plugin shared, renderer), `FolderStatus` and the `folders` route, "Number folders", `reorderPhases` / `editPhase` / `renumber` / `setColumnConfig` |
| **Phase board** | the phase-board branch of `snapshot()` (`personaBoardOf` is unconditional), the column dispatch of the runner (`ticket-dispatch` working a column, `nextPhaseIdOf`, `moveTargetOf`, `parkFor`, `isAutoPhase`), the column keys of `pipeline.md` (`wip`, `claim`, `handover`, `worker`, `model`, `prompt`, `interactive`, `persona`, `ci`, `semantic`, `min-class`, `needs`, `max-turns`, `max-work`, `max-red`, `audit`) and their readers, the column breaker (the breaker is per persona), `PHASE_PIN_KEY` / `x-phase`, `x-legacy-phase`, `LEGACY_PHASE_STATES`, the stage mapping of `pipeline-states.ts` |
| **Migrations** | the stage migration (Migrate, M239/M254: `store-stage-migration*`, `stage-migration-*`, contracts, `migrateStoreStages`, the Tickets panel's bar) and the board migration (steps 3–5, req-268: `core/board-migration.ts`, `contracts/board-migration.ts`, `migrateBoard`, its bar), their e2e specs |
| **Pipeline in Settings → Tickets** | `settings-columns.ts` (columns with numbers, Checkpoint, Worker, Model, "New column"), `settings-order.ts`, "Phase folders are not numbered" |
| **Step prompts** | `plugins/tickets` Settings → Prompts page (`settings-prompts.ts`), the prompt IPC (`prompts`, `promptSave`, `promptRestore`), `_meta/prompts/` seeding, `loadShippedPrompts`, and the five files `packages/tickets-engine/prompts/{build,plan,qa,review,scout}-default.md` plus `scripts/render-composed-prompts.ts`. Kept, because they serve the crew and discipline texts: `core/prompt-file.ts` (the fragment expander) and `core/prompt-edits.ts` (persona prompt proposals) |
| **Default personas** | `build-default`, `commit-default` (seed, `LEGACY_DEFAULT_PERSONAS`, assignment ring entries, fixtures, composed-prompt render script) |
| **Specs of all of the above** | unit specs beside the removed files; e2e: `tickets-store-files`, `tickets-stage-migration`, `board-migration`, the phase-board cases of the rest |

## Stays

- **The persona board**, its lifecycle stages, the standard flow (M275/M280), the chain, the cursor, holders, hold,
  send-back, red gate, the per-persona pool and breaker.
- **`BoardColumn` / `PipelinePhase`** as the *shape of a column the board draws* (Inbox, Prioritized, Done and the lane
  columns), with the working-column keys cut. `pipeline.md` keeps `phases:` (the lifecycle edges), `flow:` and
  `token-budget:`.
- **The dricket stack**: `DricketTicketStore`, `DricketFileStore`, `FileStoreReader`, `store-board(-source)`,
  `store-change-feed`, `dk-process`, `legacy-bridge` (it *is* the write path: the "legacy shape" is the card the board
  works on), `core/ticket-files.ts`, `ticket-board.ts`, the pure patchers of `transition.ts`, `status-comment.ts`,
  the ledger in the meta vault.
- **Everything not tied to the phase board**: persona v3 / model / prose migrators, project and skill migrators, the
  crew config migrator — they migrate persona, project and skill data, not the phase board. Left in place and named in the
  changelog as the next sweep, if the owner wants it.
- **The interview-first dialog protocol** (`plan-interactive-default`) is the one essential text of the step prompts: it
  moves to the persona path as the shipped crew prompt `prompts/crew/dialog.md`, read from the package like
  `crew/shape.md` (no vault copy, no version drift).

## Created

- **A fresh install runs on dricket (E14-9b item 6, done):** with no store configured, the first start creates one beside the
  meta vault (`dk init` on the lifecycle stages, `claim = ["running"]`) with the persona board's `pipeline.md`, and seeds
  the default crew; the bundled `dk` (M240) is used. "Initialize board" does the same for a fresh vault
  (`store/fresh-store.ts`; the store is `<vault>-tickets-store` beside it, `dk.store` is written to the config).
- **"Initialize board"** writes the persona board's pipeline (Inbox · Prioritized · Done + `flow:`), never the phase pipeline.

## Order of removal

1. Legacy remote (done) · 2. migration tool (done) · 3. shadow + files backend + `tickets.backend` (done) ·
4. phase board: runner dispatch, pipeline column keys, `BoardService` forks (done) · 5. stage and board migration (done) ·
6. Settings pipeline + step prompts + prompt IPC (done) · 7. default personas (done) · 8. fresh-install store (done —
`store/fresh-store.ts`, `<vault>-tickets-store`, `dk init` + the `[stages]` swap in one commit, `dk.store` written) ·
9. specs, docs, ADR (this change).
Each step ends with a green typecheck and its own commit.
