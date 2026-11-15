# Drey — your private note vault that runs your work — Project Context for Claude Code

## Overview

Local, topic-based note-taking app (Electron + Angular). Full concept,
data schema, and classifier design live in `specs/`:

- `specs/roadmap.md` — overall concept, open work in priority order, open risks
- `specs/decisions.md` — ideas excluded or decided against (do not re-propose)
- `specs/frontmatter-schema.md` — file/frontmatter format
- `specs/ticket-schema.md` — the tickets repository format (ADR-0075/0076)
- `specs/classifier-spec.md` — LLM prompts for task/note detection and tag suggestions
- `specs/digest.md` — **generated** (`node scripts/gen-spec-digest.mjs`, never
  edited by hand): principles, finish line, section and decision index; the
  first thing to read
- `specs/changelog.md` — what has shipped, newest first (the record; read on demand)

Read `specs/digest.md` before making a first proposal — the generated entry
point into the binding specification: the fixed principles, the finish line,
and an index of every roadmap section and every excluded idea. It replaces
reading `roadmap.md`, `decisions.md`, `frontmatter-schema.md` and
`ticket-schema.md` whole: for what you are about to touch, open the section
the digest names (`grep -n`, then the lines around the hit). The four files
stay the binding specification, not just background reading.

`AGENTS.md` is the tool-neutral entry point for coding agents; it points
here, and everything in this file binds every agent regardless of tool.
An unattended **fleet worker** on a ticket starts from
`docs/agents/fleet-worker.md` instead (toolchain, where things live, which
interactive rules below do not apply to it) and opens this file by section.

### Read on demand — not loaded with this file

This file holds the rules that apply to every change. The detail of an
area lives in `docs/agents/` and is read **before the first change in that
area**, not at the start of a session:

| Before you touch | Read |
|---|---|
| `electron/`, `shared/`, a plugin's `main/`, anything about LLM, tools, vault IO, plugins | `docs/agents/architecture.md` — the bullet of that area |
| anything a user sees: `src/app/`, a plugin's `renderer/`, `apps/`, `libs/mission-ui/`, `src/styles.css` | `docs/agents/ui.md` |
| `packages/tickets-engine/`, `plugins/tickets/`, the Crew runner, Drey Service | `docs/agents/tickets.md` |
| a file whose owner the map below does not settle | `docs/agents/ownership-map.md`, then `docs/05` §5.0 |
| a raw `tsc` / `ng` / `vitest` / `eslint` call instead of an `npm run` script | `docs/agents/toolchain.md` |

Claude Code shows the matching pointer by itself when a file of that area
is opened (`.claude/rules/`, path-scoped); every other tool follows this
table.

## Language Convention

- Code, comments, identifiers, file/folder names, commit messages: **English**.
- **Everything the UI displays is English.** Every string a user can read on
  screen: labels, buttons, placeholders, headings, settings category names,
  hints, empty states, error and status messages, `title`/`aria-label`
  attributes, native Electron dialog titles and text, and the _names_ of
  built-in Action templates. No exceptions, including for features whose
  content is German — a German mockup or a German feature request is a
  description of the layout and behaviour, **not** an instruction to write
  German labels. Translate them.
- **New surfaces read their strings from the catalog.** English stays the
  first and only shipped locale, but every user-visible string of the
  surfaces decided on 2026-11-06 (and of every area migrated since) is a
  key in `shared/i18n/catalog/en.json`, read through the runtime's
  binding (`i18n.t` in main, `I18nService` / the `t` pipe in the renderer,
  `api.i18n` / `ctx.i18n` in a plugin, `McI18n` in Mission Control):
  no literal UI strings, no sentences assembled from parts, ICU plurals,
  `Intl` for numbers, dates and currency, layouts that tolerate labels
  40 percent longer. The guard spec `shared/i18n/literal-guard.spec.ts`
  fails on a literal under the guarded paths —
  [ADR-0091](docs/09_architecture_decisions/0091-i18n-catalog-for-the-new-surfaces.md)
  has the rule, the key scheme and the paths. The older UI migrates area
  by area (roadmap req-106), not in one sweep.
- **No unnecessary UI text.** Every visible string must earn its place:
  no subtitles, taglines, hint lines or explanatory prose a screen doesn't
  need to be understood (owner ruling 2026-11-03 — e.g. the chat header
  carries the title only, no „anlegen · steuern · berichten ·
  konfigurieren" sub). When a German request describes text, translate it
  AND cut it if it is decoration.
- **Screenshots are English throughout.** Menus and pickers list names
  that come from vault files or the config — prompt titles and
  descriptions (`templates/prompts/`), template and snippet names, Action
  names — and panels show file names, tags and note text. In anything
  that is shown to the owner or shipped (the manual's screenshots,
  screenshots taken to demonstrate a feature, and the fixtures they are
  made from), the seeded vault is **English**: notes, file and folder
  names, tags, templates, prompts, the mocked model's answers. The
  manual's demo vault lives in `e2e/manual-screenshots.spec.ts`.
- Content the user actually writes into vault files at runtime (notes,
  tags, entry text) stays **German** — that's user data, not a code
  artifact, and is out of scope for this convention.
- LLM prompt templates (system prompts sent to the local model) are
  **English too**, like all other code — `specs/classifier-spec.md` and
  `shared/app-config.ts`. The model is only ever asked for a structured
  JSON verdict, so matching the German note content buys nothing; the
  earlier "keep prompts German" exception was dropped in milestone 12.1.

## Toolchain — no global Node

There is **no global `node`/`npm` on PATH** (neither in PowerShell nor in a
Bash shell). A portable Node lives at `.tools/node/` (gitignored, so the
toolchain is removable by deleting `.tools/`). Never assume a bare `node`,
`npm`, `npx`, `ng`, `tsc` or `vitest` command works.

- PowerShell, per session, from the repo root: `. .\env.ps1`
- Bash: `export PATH="$PWD/.tools/node:$PATH"`, then invoke tools **by
  script path**, not by bin-shim name (`node node_modules/typescript/bin/tsc`,
  `node node_modules/@angular/cli/bin/ng.js`, `node node_modules/vitest/vitest.mjs`,
  `node node_modules/eslint/bin/eslint.js`).
- Any checkout or worktree, one command: `.\dev.ps1` — bootstraps `.tools/`
  and `node_modules/` when missing, then runs `npm run dev`; `-Built` runs
  the production build from `dist/` instead, `-Multi` opts out of the
  single-instance lock.
- The scripts (`npm run …`):
  - `test:plugin -- <id>` — one plugin's specs, the daily loop (`--watch`,
    `-t "name"`; a path fragment such as `shared` or `electron/ipc` scopes
    outside `plugins/`)
  - `test:plugins` — the whole out-of-Angular suite (`electron/`, `shared/`,
    `plugins/`, `packages/`)
  - `test:app` — the four Angular suites (drey, `mission-control`,
    `mission-ui`, `markdown-surface`); scope with
    `-- --include "src/.../x.spec.ts"`
  - `typecheck` — all tsconfigs; `build` — renderer, electron, plugins,
    mission-control
  - `test:all` — lint, typechecks, import cycles, all suites: the **release
    gate** (`prepack` runs it before `npm run pack`; `pack:dir` runs no gate)
- **A spec sits beside the file it tests** — `src/app/` holds only specs of
  renderer code. A spec that needs a DOM opens with
  `// @vitest-environment jsdom`.
- **Test hygiene** ([docs/testing-flakes.md](docs/testing-flakes.md)): a
  component that starts background work exposes how to wait for it
  (`idle()` / `ready`), and a spec awaits that before it removes a temp dir
  — no retry loop around `rm`, no clock polling where an event exists.
  Specs that spawn real git/dk/node processes belong to the `processes`
  vitest project (`PROCESS_SPECS` in `vitest.plugins.config.mts`).
- **Lint carries architecture rules**: module barrels, the dependency rules
  between `shared/`, `src/`, `electron/`, `plugins/`, `apps/`, `libs/` and
  `packages/` (a type-only import counts), `no-floating-promises` (a promise
  meant to run on its own is marked `void`); `node scripts/check-cycles.mjs`
  fails on a runtime import cycle.
- **Only `npm run dev` rebuilds and restarts Electron by itself.** Every
  other way of running the app builds once: after touching `shared/`,
  `electron/` or `plugins/**`, a stale main process disagrees with the
  renderer about the IPC contract _at runtime_ even though `tsc` is clean
  (unknown fields are silently stripped from IPC payloads). Rebuild and
  restart; verify with `grep <new-symbol> dist-electron/plugins/<id> -r`.

The raw command per tsconfig, suite and build, the preload bundling step
and the VS Code notes: `docs/agents/toolchain.md`.

## Architecture & Design Decisions

The invariants, one line each. What each one means in detail, how it
behaves today and where its code sits: `docs/agents/architecture.md` —
read the matching bullet before changing that area. A changed rule is
changed there, and here when it is one of these lines. None of them is
broken without an ADR.

- **Process split.** Electron main/renderer; no Node integration in the
  renderer — all filesystem and LLM access crosses the `contextBridge` IPC.
  The main window is sandboxed under a Content-Security-Policy
  (`electron/content-security-policy.ts`): no inline script, no `eval`, no
  network `fetch` from the renderer; a feature that needs more widens the
  policy explicitly (ADR-0001).
- **No server, no database.** A vault is a folder on disk; plain Markdown +
  optional YAML frontmatter is the source of truth.
- **The folder structure is the user's.** The app imposes only
  `templates/`, the daily root, `chats/` and the hidden `.drafts/`. Topics
  are free inline `#tag`s, never directories, never frontmatter `tags[]`
  (ADR-0017); `#task` is reserved; the tags plugin owns the section index,
  the tag chrome is base; the LLM only suggests tags.
- **One CodeMirror surface.** `src/app/editor/` over
  `libs/markdown-surface/`; plugins compose editor extensions from the
  host's CM instances (`api.editor.cm`), never their own copy (ADR-0044).
- **LLM transport behind a provider abstraction** (ADR-0047): the local
  OpenAI-compatible endpoint is the default; hosted and CLI providers are
  opt-in and off by default. No hardcoded model id, never assume
  `/v1/models` is reachable. **No timeout on generation** — the user
  cancels (ADR-0014). API keys are encrypted in `app-config.json`.
- **Nothing leaves the machine unasked.** The one automatic network call is
  the startup update check (ADR-0074); web search, web fetch and external
  MCP servers are opt-in and ride a call only with the composer's Web chip
  on (ADR-0063).
- **No embedding model and no vector index** — removed, not to be
  re-proposed. The assistant's vault context is text search over the
  section index, chat notes excluded (ADR-0072).
- **No file watcher by default** (ADR-0018); the opt-in watcher is additive
  (ADR-0045). The app refreshes after its own writes.
- **Saves are guarded.** `note:save` carries the mtime the tab saw; a
  conflict is asked, never overwritten, and every overwrite leaves a local
  version outside the vault (ADR-0060). A save never adds frontmatter.
- **One tool loop, one system prompt builder, one vault toolset**
  (ADR-0071): a prompt names a tool only when it is attached to that call;
  a failed tool call goes back to the model as `Error: …`; a new vault
  capability for the model goes into `shared/vault-tools/`, never into a
  plugin-owned twin. The Vault chip is the scope of reading and writing; a
  deletion is always asked; a file open in the editor is read and changed
  through its tab.
- **Runtime plugins** (ADR-0044): a base application plus in-process,
  trusted plugins under `plugins/<id>/`. A plugin extends the app only
  through base-owned registries and the versioned SDK in
  `shared/plugin-api/`; its renderer is plain DOM, bundled, and imports
  only its own folder and `shared/`; IPC is two fixed channels. Base
  modules keep the barrel convention (ADR-0016); `shared/ipc-api.ts` is the
  base cross-layer contract.
- **Other programs stay other programs.** Office documents open in their
  own program (ADR-0066); Git vaults run the installed git, never a
  reimplementation, never a force-push (ADR-0065); draw.io is its bundled
  web app in a plugin tab (ADR-0064).

## Ownership Map — who owns what

One line per building block — the answer to "where does a change go"
before any file is opened. What each block does, its contracts and the ADR
behind it: `docs/agents/ownership-map.md`; the per-component reference and
the **Feature → files** index: [docs/05 §5.0](docs/05_building_block_view.md).
Keep all three in step when a boundary changes.

Main process (`electron/`):

- `main.ts` over `app-services.ts`, `main-window.ts`, `app-protocols.ts`,
  `startup-reports.ts`, `app-paths.ts`, `capture-hotkey.ts` — composition
  root, the sandboxed window, app lifecycle
- `vault-manager.ts` — the multi-vault registry and **all** vault/note file
  IO (atomic, over `safe-file.ts`)
- `note-manager.ts` — the `note:save` pipeline; `daily-note.ts` — daily
  notes; `session/` — session restore and buffer backups; `history/` —
  local note versions
- `vault-watcher.ts`, `own-write-ledger.ts`, `vault-change-announcer.ts` —
  the external-change round
- `link-rewriter.ts` — link rewrites on rename/move; `external-open.ts` —
  files the OS hands to Drey
- `llm/` — the LLM transport: router, `providers/`, the tool loop, the task
  registry
- `mcp/` — the vault MCP server for other programs and the plugin-tool
  registry; `mcp-client/` — external MCP servers, `web_search`, `web_fetch`
- `plugin-host/` — discovery, activation, the per-plugin context, hooks,
  the `.zip` installer
- `spellcheck.ts`, `pdf-export.ts`, `updater/`, `config-secrets.ts`,
  `content-security-policy.ts`, `safe-file.ts`
- `ipc/` — thin, feature-free base channel handlers
- `boot.ts` + `service-window/` — Drey Service's tray and window process

Renderer (`src/app/`):

- `services/` — `EditorService` (the multi-document facade) over
  `OpenDocsStore`, `DocOpenService`, `DocSaveService`,
  `DocDiskSyncService`; `DocHistoryService`; the settings / theme /
  spellcheck / update singletons
- `panes/` — the split tree, tab drag and drop
- `editor/` — the only CodeMirror surface: Live Preview, modes, wikilinks,
  tag pills (`editor/tags/`), toolbar, slash commands, the Markdown dialect
- `dock/` — the three docks, the icon strips, the panel registry;
  `views/` — saved layouts
- `vault/` — the Files panel and `VaultService`; `calendar/`, `windows/`
- `keybindings/`, `palette/` — commands, chords, the quick switcher
- `settings/` — the settings tab and its one stylesheet; `help/` — the
  manual and the shortcuts page
- `conflict/`, `history/` over `diff-view/`; `confirmation-dialog/`;
  `tool-approval/`; `link-update/`
- `plugin-host/` — the renderer plugin host and the DOM mount hosts
- `titlebar/`, `status-bar/`, `image-viewer/`, `pdf-viewer/`,
  `external-open/`, `emoji-picker/`

Cross-layer, apps and libs:

- `shared/plugin-api/` — the frozen, versioned plugin SDK
- `shared/ipc-api.ts` — the base IPC contract, a barrel over `shared/ipc/`
  (a new channel is a file there)
- `shared/vault-tools/` — the one vault toolset; `shared/i18n/` — the
  string catalog; `shared/markdown/` — the dialect's pure halves; the rest
  of `shared/` — pure logic both sides share
- `libs/markdown-surface/` — the framework-free CodeMirror core;
  `libs/mission-ui/` — the `@mission-ui` components
- `apps/mission-control/` — the served Mission Control app;
  `apps/service-window/` — the service window's page

Plugins (`plugins/<id>/` — `plugin.json`, `main/`, `renderer/`, `shared/`):

- `tags/` — the section index, tag colors, rename/merge, the Find panel
- `tasks/` — the task index and the Find panel's Tasks mode
- `templates/` — the Templates panel, slash-menu templates, snippets
- `assistant/` — the Assistant panel, chat notes, Actions, live edit, the
  system prompt, the Vault chip's context
- `tickets/` — the Work panel, the remote gateway and phone client, Drey
  Service's client
- `git/` — Git vaults and the Source control panel
- `meeting/`, `browser/`, `ocr/`, `outline/`, `backlinks/`, `drawio/` — one
  feature each, as named
- `sample/` — the authoring reference, dev/test-only;
  `plugins/TUTORIAL.md` and `plugins/AUTHORING.md` are the guides

Packages (`packages/tickets-engine/`, no Drey/Electron/plugin imports):

- `src/core` - the tickets domain in domain folders (req-300): `ticket/`,
  `pipeline/`, `plan/`, `chapters/`, `review/`, `persona/`, `chat/`,
  `skills/`, `projects/`, `git/`, `config/`
- `src/fleet` - the Crew runner (req-300): `chain/` (the daemon),
  `runner/` (run machinery, pure run core, composition seams with
  `runner.ts` the composition root), `lease/` (claims), `harness/`
  (Claude Code and ACP adapters), `routing/`, `session/`, `api/`,
  `ports/`, `governor/`, `worktrees/`, `telemetry/`; the wire contract
  `protocol*.ts` at the root
- `src/contracts` — cross-layer types; `src/services` — the host-agnostic
  board service; `src/service` — **Drey Service**, the one background
  process

This map is a starting point, not a fixed contract — but any deviation
should be called out explicitly (see Working Style below), not
introduced silently.

## UI / UX Design

The layout, every panel, the editing model and the themes are specified in
`docs/agents/ui.md` — **read it before any change a user can see**. What
holds everywhere:

- Minimal and unobtrusive: flat surfaces, no heavy borders or shadows,
  generous whitespace (ADR-0057).
- Chrome labels are sentence-case **sans**; mono only for code, the
  meta-bar path and line numbers.
- Panel controls are **icon-only** with a `title` + `aria-label`, drawn
  with the global `.icon-btn` / `.seg` classes (plugins: `api.ui.icon`);
  panel fields carry no placeholder text.
- Design tokens live centrally in `src/styles.css`; three themes ship
  (Drey, Anthrazit — the default, Cyberpunk).
- Every panel header and every Settings page is built the same way (the
  frame rule of ADR-0019; `src/app/settings/settings-ui.css`).
- The design boards in `docs/design/` are the reference for a screen that
  has one; where a board and ADR-0057 disagree, ADR-0057 wins.
- The text rules — English, from the catalog, nothing decorative — are in
  "Language Convention" above.

## Coding & Style Conventions

- TypeScript strict mode everywhere, no implicit `any`.
- Angular: standalone components, Angular style guide naming (kebab-case
  filenames, PascalCase class names).
- Prefer typed interfaces for every data shape crossing the IPC boundary
  (`Note`, `Task`, `TagEntry`, `VaultConfig`, `ClassifierResult`, ...) —
  define once in a shared types module, used by both main and renderer.
- ESLint + Prettier, default configs unless a concrete conflict comes up.
- **Backend OOP rule** (owner, 2026-11-08;
  [ADR-0096](docs/09_architecture_decisions/0096-crew-runner-refactor-state-machine-ports-and-file-size-rule.md)).
  `packages/` (the tickets engine and the Crew runner) is built
  object-oriented as far as TypeScript carries it: one class per file, one
  responsibility per class; interfaces small and defined at the consumer;
  dependencies by constructor, wired only in the composition root (no DI
  container, no service locator); composition over inheritance (an abstract
  class only as a pure template); states and events as discriminated
  unions; `readonly` by default; no static mutable state; the core imports
  ports, never `node:fs`, `child_process` or `http` (adapters do). No god
  objects: the class that supervises processes does not also write tickets.
  **File sizes:** target 200 lines, hard limit 300 (specs 400); a function
  at most 60 lines; at most 4 parameters (else an options object);
  cyclomatic complexity at most 12. Enforced by ESLint on `packages/**`
  with a baseline of today's offenders in `eslint.size-baseline.mjs` that
  may only shrink (a touched file leaves the list or is split), and by the
  import boundaries between the runner's sub-packages (ADR-0096). The rest
  of the repo adopts the limits for new files.
- No business logic inside components — components call services, services
  hold the logic.
- Background: strong C++/C# experience — prefer explicit typing and clear
  ownership boundaries over overly dynamic/implicit TypeScript patterns,
  even where the language would allow a shortcut.

## Documentation Requirements

Maintain arc42-compatible architecture documentation directly under `docs/`
(no extra `arc42/` subfolder — `docs/` already means this), one file per
arc42 section (numbered `01_introduction_and_goals.md` through
`12_glossary.md`). Create the full skeleton (even brief placeholder
sections) as part of milestone 1, then fill sections in incrementally as
the relevant work happens — don't write it all up front, and don't defer
it to the end either.

Two sections matter most and should stay current, not just get created
once:

- **Building Block View** (`docs/05_building_block_view.md`, static
  structure): main/renderer split, services, components — update whenever
  a component boundary from the Ownership Map above (its detail: docs/05
  §5.0, "Component reference") changes or gets refined.
- **Runtime View** (`docs/06_runtime_view.md`, dynamic behavior): sequence
  diagrams for the key flows (quick-capture → daily note, save → re-index,
  tag search → hits → open-at-line / Export, Autotag, chat/RAG scope
  resolution) — add one as each flow gets implemented, not all up front.

Use Mermaid diagrams embedded directly in the Markdown files for both views
(renders in VS Code preview and GitHub, no extra tooling needed), unless a
specific diagram genuinely doesn't fit Mermaid's syntax.

Architecture Decision Records are part of arc42 section 9
("Architecture Decisions") per the arc42 template itself — not a separate
top-level folder. Store them under `docs/09_architecture_decisions/`, one
file per decision (`0001-short-title.md`, sequential numbering, MADR-style:
Title, Status, Context, Decision, Consequences). Write an ADR for
structural/lasting decisions with real trade-offs (e.g. the Electron
process split, tags as free labels + a section index (ADR-0017), the
storage format, the feature-module convention) — not for routine
implementation choices (a specific npm package, a minor naming convention). When in doubt
whether something warrants an ADR, ask rather than skip or over-produce.
`docs/09_architecture_decisions.md` itself stays a short index linking to
each ADR file — arc42's own guidance is to keep this central section short
and push details into the per-decision documents.

## Current State & Next Steps

The roadmap's Phase 1 (MVP) is complete, and the codebase has since been
restructured into a **base application with runtime plugins** (milestone
21, [ADR-0044](docs/09_architecture_decisions/0044-runtime-plugin-system.md);
packaging verified — see `docs/07_deployment_view.md`).

**Milestones 1–58 are complete and owner-verified** (verification round
closed 2026-10-10). This file does not restate them — the per-milestone
record is:

- [specs/changelog.md](specs/changelog.md) — milestones 22 onward, newest
  first, plus requirements and fixes
- [docs/milestones-done.md](docs/milestones-done.md) — the archived
  build log, milestones 1–27
- the ADRs and `docs/05` / `docs/06` for the lasting structure

(Milestone 44, the Task Center's `#task/id:` addressing, was reverted
before release — ADR-0033 "considered and rejected"; the surviving piece
is the ambiguity skip in `resolveTaskLine`.)

## Milestones and spec upkeep

Open work and its order live in [specs/roadmap.md](specs/roadmap.md):
"Known defects", then "Now", "Next", "Later" — worked **top to bottom**.
This file deliberately does **not** track milestone status (it drifted
once): the latest shipped milestone is the top entry of
[specs/changelog.md](specs/changelog.md), the next one is the first open
item of the roadmap. While the roadmap still marks its order as a
proposal awaiting the owner's confirmation, the owner picks.

### The spec files and who they belong to

| File | Holds | Update when |
|---|---|---|
| `specs/roadmap.md` | open work only, in order; principles; open risks | an item is started, re-scoped, re-ordered, added or finished |
| `specs/changelog.md` | what shipped, newest first | every milestone, requirement or fix |
| `specs/decisions.md` | ideas excluded or decided against, with date and reason | the owner decides against something, or a built alternative is dropped |
| `specs/classifier-spec.md` | every LLM prompt, builder and parser | a prompt, its parser, its placeholders or the provider call around it changes |
| `specs/frontmatter-schema.md` | file formats, frontmatter, tag/task grammar, structural folders, file types in a vault | any of those change |

The roadmap never keeps shipped items and the changelog never keeps open
ones: an item leaves the roadmap exactly when it enters the changelog or
`decisions.md`. Specs are written in English like all other documentation.

### Working the roadmap

1. Take the first open item in order. Skip or reorder only on the
   owner's word, and then change the roadmap in the same step so it
   always states the real order.
2. **Work outside the order** (an owner request, a bug found on the way):
   do it, but first add it to the roadmap with the next free id (check the
   changelog for the highest milestone and req id) and the note "owner
   request, outside the list" — it then ships and moves to the changelog
   like any other item. Nothing is built that was never on the roadmap.
3. If the work turns out different from its roadmap entry (scope, approach,
   split into parts): say so, update the entry first, and for real
   alternatives wait for confirmation (Working Style).
4. Parts you deliberately leave out become new roadmap items (backlog or
   "Follow-ups of shipped milestones"); alternatives that were rejected go
   to `decisions.md`. **While the roadmap states a "Finish line"** (owner,
   2026-11-12), only its items are worked, every other row is frozen, and
   a new row is added only when something is broken or blocks a
   finish-line item — anything else left out is one sentence in the
   changelog entry.

### Definition of done — in the same change as the code

- `specs/changelog.md`: new entry at the top of "Recent milestones" with
  the milestone number, the behaviour and the specs/tests added. Mark it
  "**Not yet manually verified by the owner**" until the owner has
  verified; the owner's verification only removes that marker.
- `specs/roadmap.md`: the item is deleted (and its follow-ups added);
  the "Status" line is current.
- `specs/decisions.md`, `specs/classifier-spec.md`,
  `specs/frontmatter-schema.md`: updated per the table above — if the
  change touches none of them, nothing to do, but check each.
- `docs/05` / `docs/06` / an ADR as the Documentation Requirements say; the
  user manual (`docs/manual/manual.md`, shipped in-app) when behaviour the
  user sees changed.
- This file only when a *rule* or an architecture statement changed — never
  for status.
- Last check: the roadmap lists nothing that shipped, the changelog's top
  entry is the newest, ids are unique, links between the specs resolve —
  `node .claude/skills/drey-milestone-done/check-specs.mjs` checks these,
  fails when `specs/digest.md` is stale (regenerate it with
  `node scripts/gen-spec-digest.mjs`) and prints the next free ids
  (Claude Code: the `drey-milestone-done` skill walks the whole list).

A milestone that is code-complete but not yet verified by the owner is
marked "**Not yet manually verified by the owner**" in its changelog
entry — not here.

Pause after each milestone, show what works, don't push through several
milestones in one uninterrupted stretch. (Milestones 10, 11, 15 and 19
were explicit exceptions.)

## Worktrees

Milestone work happens in a git worktree branched off `main` (`git worktree
add -b <branch> <path> main`, or the agent's worktree tool), so parallel
sessions never conflict; the session's working directory moves there.
Everything — code, specs, docs — lands on the worktree's branch; nothing
touches `main` directly. When the owner declares the work **signed off**,
the branch is merged back into `main` (ordinary merge, no force-push) and
the worktree is removed.

## Working Style — important

This is meant to feel like pair programming, not a silent code generator:

- For every meaningful decision, briefly explain WHY this library/pattern/
  approach was chosen — especially where real trade-offs exist (which
  CodeMirror extension, how IPC messages are structured, why one package
  over another).
- Don't comment or explain every line of code — explanation belongs in the
  conversation, not in code comments.
- If something deviates from the `specs/` documents: say so explicitly and
  justify it, don't silently implement it differently. If it is implemented differently please update specs file appropriately
  (see "Milestones and spec upkeep" for which file and when)
- For genuine alternatives with different trade-offs: state the options and
  a recommendation, then wait for confirmation — don't just pick the most
  likely option and run with it unasked.
- **Ask for rights instead of working around their absence.** When a tool
  restriction slows the work down — Plan mode's read-only sandbox refusing
  a scratch file or a plan-directory write, a blocked command, anything
  where the contorted workaround costs more than the ask — stop and say
  what is blocked and what access would make it one step (e.g. "let me
  write a temp analysis script" or "this needs edit rights"). Efficiency
  beats silently coping; plan sessions here are usually supervised, so
  prompting the owner is cheap.
