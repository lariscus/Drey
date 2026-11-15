# ADR-0100: Drey on dricket only

- Status: Accepted — built (req-307, E14-9b part b; owner 2026-11-11/15)
- Deciders: the owner
- Supersedes the "keep both backends until the verification round" reading of
  [ADR-0090](0090-tickets-on-dricket.md) and the phase-board file layout of
  [ADR-0076](0076-ticket-repository-format-and-coordination.md)

## Context

The cut-over of 2026-11-06 moved the owner's board onto dricket, but the
code kept both paths: the files backend (ticket files in numbered phase
folders), the phase board it served, the step prompts its columns named,
the default personas `build-default` / `commit-default`, the migration
tool, the shadow diff and every compatibility reader. The owner's
ruling, 2026-11-11/15: "sicherstellen, dass diese Version nur noch auf
dricket läuft"; "ignore backward compatibility, I will set up everything
manually again … I never released it"; "entferne das alte backend";
"bitte entferne rückstandsfrei — keine Kommentare zum Entfernen im Code
hinterlassen".

## Decision

**One backend, one board, no migration.**

1. **One backend** — a dricket store on the lifecycle stages
   (`inbox prioritized active running done`, `claim = ["running"]`,
   req-265). The `tickets.backend` key, the files backend, the shadow
   diff and the migration tool are removed. A store on other stages is
   not migrated: the board comes up empty with the error
   (`NOT_LIFECYCLE_STORE`) and Drey creates a fresh store — nothing was
   ever released, so nothing carries over (the stage and board
   migrations of milestones 239–262 are removed with it).
2. **One board** — the persona board (ADR-0098). The phase board's
   runner dispatch, its pipeline column keys (a phase entry is
   `{ id, title, color }`), its column breaker, its Work-panel branches
   and its Settings pages go. `pipeline.md` holds the lifecycle edges,
   the standard `flow:` and the crew keys; the store's `[stages]` hold
   the life.
3. **The persona is the prompt.** The step prompts
   (`{build,plan,qa,review,scout}-default.md`), their Settings page,
   their IPC and the `_meta/prompts/` seeding are removed; a persona's
   `prompt.md` — the shipped "who it is" part — is the run's only
   instruction base. The interview-first dialog protocol stays as the
   package's marker-free `prompts/crew/dialog.md`. The default personas
   `build-default` / `commit-default` are gone.
4. **A fresh install runs on dricket.** With no store configured, the
   engine's start — and "Initialize board" for a fresh vault — creates
   one beside the meta vault: `<vault>-tickets-store`, via the bundled
   `dk` (M240, resolved `dk.path`, req-277). The creation is
   `dk init <dir> t` plus one commit on `main` that swaps dk's built-in
   `[transitions.agent]` for the `[stages]` table (R-27's `--stages`
   stays dricket's Nice), then the working copy back on `tickets`;
   `dk.store` is written to the config, so the next start adopts it.

The meta vault keeps its `_meta` tree (pipeline, repos, projects, crew,
personas, skills, chat, ledger) and the reserved folders
(attachments, videos); the fleet's worktrees, the checkout reads, the
chain's in-claim writes and the ledger are unchanged.

## Consequences

- The tickets schema spec describes the store world
  (`specs/ticket-schema.md`); the decommission inventory of part (a)
  (`docs/design/dricket/decommission.md`) is superseded by
  [`dricket-only.md`](../design/dricket/dricket-only.md).
- No rollback: a pre-cut-over files vault cannot be read by this build.
- The persona v2→v3, model, prose, project and skill migrators stay —
  they migrate crew data, not the phase board; a later sweep may remove
  them if the owner wants.
- No tombstone comments: the code carries no reference to what went
  (owner's ruling), the record of what went lives in this ADR and the
  changelog.
