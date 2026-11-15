# Ownership map — the detail per building block

What each block of `CLAUDE.md` § "Ownership Map" does, its contracts and its ADR. The tickets plugin, the tickets engine and Drey Service: [tickets.md](tickets.md). Moved out of `CLAUDE.md` unchanged (2026-11-15) so it is read when an area is touched, not in every session.

One line per building block — the deterministic answer to "where does a
change go". The per-component detail (current behaviour, contracts,
gotchas) and the **Feature → files** index live in
[docs/05 §5.0](../05_building_block_view.md) ("Component reference
(current)"); keep that section in step when a boundary changes.

Main process (`electron/`):

- `main.ts` — composition root: the order of startup, single-instance
  lock, app lifecycle; over `app-services.ts`
  (`buildAppServices`: every long-lived object, one typed `AppServices`),
  `main-window.ts` (`MainWindowHost`: the sandboxed window + the
  save-before-exit prompt), `app-protocols.ts` (privileged schemes),
  `startup-reports.ts`, `app-paths.ts`, `capture-hotkey.ts` (the
  quick-capture hotkey, its chord from config — ADR-0073)
- `vault-manager.ts` — `VaultManager`: the multi-vault registry
  (ADR-0051) + all vault/note file IO over `safe-file.ts` atomic writes;
  mutations record in the own-write ledger
- `note-manager.ts` — the `note:save` pipeline: mtime conflict guard +
  frontmatter bump (ADR-0060); feature work rides the save/vault hook
  registries
- `daily-note.ts` — daily-note creation + template substitution; its
  writes go through `VaultManager`
- `session/` — session snapshot/restore + unsaved-buffer backups (ADR-0043)
- `history/` — `NoteHistoryStore`: per-write local note versions, the
  "File history…" backend (ADR-0060)
- `vault-watcher.ts` + `own-write-ledger.ts` + `vault-change-announcer.ts` —
  the opt-in watcher and the one shared external-change round (ADR-0045)
- `external-open.ts` + `ipc/external-handlers.ts` — files the OS hands to
  Drey (ADR-0054)
- `link-rewriter.ts` — link-integrity rewrites on rename/move (ADR-0059)
  over the pure `shared/link-rewrite.ts`
- `llm/` — the LLM transport: `LlmClient` + per-call `LlmRouter`,
  `providers/` (ADR-0047), the task registry, `tag-suggest.ts`
- `mcp/` — the vault MCP server for other programs (ADR-0021), building
  the shared vault tools (`shared/vault-tools/`, ADR-0071) over
  `VaultManager` for it and the assistant, plus the plugin-tool
  registry (`plugin-tools.ts`, SDK 1.29: `ctx.mcp.registerTools` lists
  a plugin's tools beside the vault tools); `mcp-client/` — external MCP
  servers, `web_search`, `web_fetch`, the assistant toolbox (ADR-0063)
- `plugin-host/` — discovery, activation/quarantine, the per-plugin
  context (`plugin-context.ts`: `ctx.vault`, `ctx.llm`), per-plugin config,
  save/vault hooks, the section-search provider slot, the `.zip`
  installer (ADR-0044/0068)
- `spellcheck.ts` — nspell + Hunspell dictionaries; `pdf-export.ts` — the
  "Export as PDF…" flow; `updater/` — the GitHub-Releases update flow
  (ADR-0074): ask-first check/download/install over electron-updater,
  native dialogs, quit through the exit prompt
- `safe-file.ts` — atomic writes + guarded config reads (data safety);
  `config-secrets.ts` — API keys encrypted in `app-config.json`
  (ADR-0010 later change); `content-security-policy.ts` — the
  renderer CSP (ADR-0001 later change)
- `ipc/` — thin, feature-free base channel handlers
- `boot.ts` + `service-window/` — the entry branches on
  `--drey-service-window` into Drey Service's **tray and window process**
  (req-165/166, ADR-0092 later change): started and ended by the service,
  a client of its HTTP API only, its page `apps/service-window/`

Renderer (`src/app/`):

- `services/EditorService` — multi-document state as a facade over the
  focused pane (ADR-0003/0037), over `OpenDocsStore` (the registry),
  `DocOpenService`, `DocSaveService` and `DocDiskSyncService`; `services/DocHistoryService` — the
  back/forward history (M55)
- `panes/` — `PaneService` split tree + dock regions (ADR-0037/0038),
  `TabDragService` + `dnd/` (ADR-0039), `PaneDropService`
- `editor/` — the only CodeMirror surface: `MarkdownSurface`, Live
  Preview (ADR-0009), modes (ADR-0008/0036), wikilinks (ADR-0046), tag
  pills/completion (`editor/tags/`), spellcheck (ADR-0013/0056),
  toolbar + slash commands (M42/M46), the extended Markdown dialect —
  highlight/math(KaTeX)/callouts/footnotes/emoji/linkify, one dialect
  across Lezer, markdown-it and the PDF, plus its insert affordances:
  the same reducer behind the formatting strip (docked in the meta
  bar while pinned, head of the editor context menu -- req-41) and
  `/`, the
  `:emoji:` picker (`src/app/emoji-picker/`), `:`-completion and the
  formatting eraser (`erase-formatting.ts`, `Mod+\` — peels the
  outermost inline wrap at the caret)
  (M72, ADR-0070, shared pure halves in `shared/markdown/`)
- `dock/` — `DockService` + `DockStrip` (icon strips, M69) +
  `WidgetRegistryService`: the three docks, every panel, each dock's
  editor band (ADR-0019/0034/0038)
- `views/` — `ViewService`: saved layouts (ADR-0089, M123); docks and
  pane trees per view (`DockService` / `PaneService` slots), tabs belong
  to views, one document registry; the title-bar `ViewSwitcher` sits in
  `titlebar/`
- `vault/` — `FilesPanel` + `VaultService` (trees, vault management;
  the panel handles input only, over `FilesTreeState` and
  `FileOperationsService` in `dock/panels/`);
  `calendar/`, `windows/`
- `keybindings/` — `KeybindingService`: commands + chords, through the
  user's overrides (Settings → Keyboard shortcuts, ADR-0073; the chord
  grammar is `shared/keybindings.ts`); `palette/` —
  the quick switcher / command palette (M59)
- `link-update/` — the rename/move link-integrity dialog (ADR-0059)
- `conflict/` + `history/` — save-conflict merge + file-history UIs
  (ADR-0060), both over `diff-view/` (the shared `DiffView`)
- `confirmation-dialog/` — the one ADR-0011 dialog; `tool-approval/` —
  external-tool asks (ADR-0063)
- `settings/` — the settings framework + core categories (ADR-0010)
- `help/` — the Help menu: bundled manual (`docs/manual/` →
  `public/manual/` via `scripts/sync-manual.mjs`) + the live-generated
  shortcuts page (ADR-0067)
- `plugin-host/` — the renderer plugin host: `DreyPluginApi` impl,
  registries, the three DOM mount hosts
- `titlebar/` (menu bar, window controls), `status-bar/`,
  `image-viewer/` (ADR-0026), `pdf-viewer/` (ADR-0052),
  `external-open/`, `services/` (settings/appearance/theme/spellcheck
  singletons, `DailyNoteService`, `PluginCatalogService` — the plugin
  list Settings shows, `update.service.ts` — the update status mirror +
  triggers, ADR-0074)

Cross-layer:

- `libs/markdown-surface/` — the framework-free CodeMirror core both clients
  share (E12-6): the extended dialect, Live Preview / View / Source
  (`engine.ts`), theme, link and formatting actions, `createMarkdownView`.
  The desktop `MarkdownSurface` and Mission Control's `mc-markdown`
  (`libs/mission-ui/src/markdown/`) are its two wrappers; specs run with
  `ng test markdown-surface`
- `shared/plugin-api/` — the frozen, versioned plugin SDK (manifest,
  `DreyPluginApi`, `MainPluginContext`, `PLUGIN_API_VERSION`)
- `shared/ipc-api.ts` — the base IPC contract: a barrel over
  `shared/ipc/` (one file per topic — a new channel goes there, importers
  keep using `shared/ipc-api`); `shared/updates.ts` — the update
  system's pure halves (version compare, the releases URL); the rest of
  `shared/` is
  pure, testable logic both sides share (frontmatter, tags, tasks,
  wikilinks, link-rewrite, app-config, …)

Plugins (`plugins/<id>/`, ADR-0044 — each `plugin.json` + `main/` +
`renderer/` (esbuild-bundled) + `shared/`, built into
`dist-electron/plugins/<id>/`):

- `tags/` — tag data owner: section index, prefix colors, rename/merge,
  the Find panel (ADR-0017, M33/37/53, M210)
- `tasks/` — the Tasks mode of the Find panel + per-vault task index, inline metadata
  (ADR-0033)
- `templates/` — Templates panel, slash-menu template entries, snippets
  (M46)
- `assistant/` — Assistant panel: chat notes (ADR-0048), Actions, live
  edit (ADR-0049), the system prompt (ADR-0071), the Vault chip's
  context block from text search (ADR-0072)
- `meeting/` — `.ics`/`.msg` meeting-section import (ADR-0041)
- `browser/` — the in-editor browser tab (ADR-0042)
- `ocr/` — vision-LLM OCR on images (ADR-0050)
- `outline/` — heading tree of the open note; `backlinks/` — the
  "what links here" panel (M54)
- `drawio/` — the diagram editor tab (ADR-0064)
- `git/` — Git vaults + Source control panel incl. merge, stash, amend,
  file history (ADR-0065 + M67)
- `tickets/` — the Work panel over a dedicated tickets repository: see
  [tickets.md](tickets.md)
- `sample/` — the authoring reference, dev/test-only (ADR-0068);
  `plugins/TUTORIAL.md` + `plugins/AUTHORING.md` are the guides
