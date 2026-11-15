# 0103 — The store belongs to the project

## Status

Accepted — built (req-315, milestone 286; owner correction before the merge into `main`, 2026-11-15)

## Context

Since E14-9b ([ADR-0100](0100-drey-on-dricket-only.md)) the ticket records
live in a dricket store, and a fresh project gets its own beside the
repository — but the **reference** to it stayed a machine-wide setting:
`dk.store` in the tickets plugin's settings, mirrored into the engine's
service-home config. With a second project the store stopped following:
milestone 285's fresh-install setup adopted the active project's store for
a brand-new vault (the owner saw another project's tickets on a fresh
board), and switching projects (req-72) never switched the store. The
machine-wide key was the last global piece of a project-scoped world.

## Decision

1. The store is a property of the project: named in its
   `tickets/_meta/pipeline.md` frontmatter (`store:` — a local folder or a
   remote `remote#branch`).
2. The resolution order is the project's `store:`, else the machine-wide
   `dk.store` override, else the default beside the repository
   (`<vault>-tickets-store`).
3. The first board read of a project that names no store but has an
   override moves the override into that project's pipeline (one commit;
   the req-173 migration pattern). The override stays in the settings for
   the projects that name none and is never deleted automatically.
4. A fresh initialize anchors its own beside-store and never adopts a
   foreign one; a missing local store is created at the anchored path (a
   half first start heals); a remote reference is adopted from the start.
5. Switching projects (req-72) switches the store with them — nothing
   else to configure. `dk.path` stays machine-wide (the binary);
   `dk.checkout` / `dk.dataDir` / `dk.syncSeconds` stay settings.

## Consequences

- A fresh project cannot leak another project's tickets (milestone 285's
  owner report: a fresh board showed the active project's tickets).
- The settings field reads as the override it is ("for projects that name
  none"); the pipeline is the visible, hand-editable home of the store.
- Old boards migrate on their first read after the update; until then they
  keep working through the override.
- The E14-5b / E14-7a remote-store scenarios name their store in the
  pipeline now; the settings override remains for setups that must not
  hand-edit the pipeline.
