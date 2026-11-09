# req-171 — hand-over (milestone 231, branch `claude/req-171-persona-page-bb2479`)

Untracked note. The branch is cut from `desktop-integration` e54f9e2a; nothing merged, pushed or touched on `main` / `desktop-integration`.

## Shared files touched (additive, minimal — the req-172 sibling edits several of them too)

Engine / contracts
- `packages/tickets-engine/src/core/persona.ts` — `Persona.summary`, `PersonaAllowed.runCommands` / `network`, `PERSONA_RUN_COMMANDS`, `personaFileText` writes frontmatter only (no prose), `summary:` line; `splitPoolEntry` moved to `core/pool-entry.ts` and re-exported. **The sibling touches this file too** — expect a merge in the `allowed` and `Persona` blocks.
- `packages/tickets-engine/src/services/board-service.ts` — `personaPatch` takes `summary`, `budget`, `allowed` (3 small additions + one import).
- `packages/tickets-engine/src/services/persona-patch.ts`, `server/persona-patch-body.ts` (now parses by key), `server/drey-port.ts` (`personaPatch` signature, `PersonaView` carries `summary` / `allowed`), `server/engine.ts` (one line: runs `PersonaProseMigrator` at start).
- `packages/tickets-engine/src/contracts/remote-protocol.ts` — `PersonaView.summary` / `allowed`, `personaPatch` gets `summary`, `budget`, `allowed`. **The sibling touches this file too.**
- New: `contracts/persona-allowed.ts`, `core/persona-prose.ts`, `core/pool-entry.ts`, `services/persona-prose-migrator.ts`.
- Specs: `core/persona.spec.ts`, `services/board-service.spec.ts` (one added test), `server/drey-port.spec.ts`, `server/router.spec.ts` (one key swapped: `budget` is writable now), `fleet/one-on-one-request.spec.ts` (`summary: ''` in a fixture), new `persona-prose*.spec.ts`, `persona-patch-body.spec.ts`.

SDK / host
- `shared/plugin-api/plugin-api.ts`, `renderer.ts`, `versions.ts` — SDK **1.57**: `MarkdownFormatAction`, `MarkdownViewHandle.setMode` / `format`. If the sibling also bumps the minor, take the higher and keep both notes.
- `src/app/plugin-host/markdown-view.ts` (+ spec).
- `shared/i18n/catalog/en.json` — the retired `persona.page.*` keys removed (13), ~65 keys added after `persona.page.words` (`persona.head/role/allowed/format/mode/skills/proposals/links.*`). **The sibling adds keys too** (probably `skills.*`): a plain text merge, different regions.

Clients
- `plugins/tickets/renderer/index.ts` (two lines: `openCrew` host callback, import), `team/team-view.ts` / `team-model.ts` (card line 3, Crew focus), `libs/mission-ui/src/api/dto.ts`, `team/team.ts`, `team/team.html` (card line).

Docs
- `specs/roadmap.md` (req-171, req-153, req-144 removed; req-142, req-143, req-137, E13-19, req-184 reworded; req-235..239 added; Status 171–231; order sentence), `specs/changelog.md` (top entry), `specs/decisions.md` (one bullet at the top), `specs/ticket-schema.md` (`summary`, `allowed` keys, the prose migration), `docs/05_building_block_view.md` (the persona-page row), `docs/06_runtime_view.md` (6.115), ADR-0044 (later change), `plugins/AUTHORING.md`, `plugins/tickets/FLEET.md`, `docs/manual/manual.md` + `public/manual/manual.md`, `docs/design/work-panel/boards/README.md`, `docs/design/work-panel/crew-internals/persona-page-built.png`.

e2e: `persona-page.spec.ts`, `persona-page-store.spec.ts`, `fidelity-desk-persona.spec.ts` follow the new page.

## Seams that wait for req-172 (all in `plugins/tickets/renderer/team/persona-seams.ts`)
- `PersonaSkillsSeam.list(personaId, names)` — today the D-46 vault reading. Replace with the sibling's `personaSkills` (`contracts/skills.ts` on its branch): off rows, row menu, `Add skill…` (`skillUpload`), exact counts → req-237.
- `PromptPreviewSeam` — `noPromptPreview` today. Wire `personaPromptPreview` → the head's `≈ N tokens at start` + the `Preview full prompt` button (the block already draws it when `available`) → req-238.

## Follow-up ids used: req-235 portrait, req-236 Tell me when, req-237 skills wiring, req-238 prompt preview wiring, req-239 commit age + per-model busy count.

## Not yours / not done
- Enforcement of `allowed: run-commands` and `network` (req-142 reworded).
- `persona-page-built.png` was produced by `DREY_FIDELITY_SHOTS=1 node node_modules/@playwright/test/cli.js test e2e/fidelity-desk-persona.spec.ts` (needs a fresh `npm run build` first).
