# Architecture and design decisions — the detail

The binding detail behind the invariants in `CLAUDE.md` § "Architecture & Design Decisions": one bullet per decision, with its current behaviour and its ADR. Read the bullet of the area you are about to change. Moved out of `CLAUDE.md` unchanged (2026-11-15) so it is read when an area is touched, not in every session.

- Electron main/renderer split. No Node integration in the renderer — all
  filesystem and LLM access goes through a `contextBridge` IPC boundary.
  The main window is **sandboxed** and its page runs under a
  **Content-Security-Policy** (`electron/content-security-policy.ts`,
  ADR-0001 later change): no inline script, no `eval`, no network
  `fetch` from the renderer, frames only from `plugin:` / `drey-asset:`.
  A feature that needs more widens the policy explicitly; the e2e
  fixture fails a test on any violation.
- No server/backend process. A vault is just a folder on disk (can live on
  OneDrive); the app reads/writes files directly, no client-server split.
- Editor: CodeMirror 6 in the renderer, extended via Compartments. Plugins
  compose editor extensions from the **host's** CM module instances
  (`api.editor.cm`), never their own runtime copy (ADR-0044 rule 1).
- Storage format: plain Markdown + YAML frontmatter. No proprietary format,
  no database as source of truth (see `specs/frontmatter-schema.md`).
- Folder structure is the user's own — the app imposes only `templates/`,
  `daily/` (the daily-notes root is configurable, `daily.dir`, default
  `daily/`), `chats/` (assistant conversation notes, ADR-0048, indexed
  like `daily/`), and the hidden `.drafts/` (bug-5's exit-time auto-saves of
  untitled tabs, Notepad++-style; invisible to the file tree and indexes,
  see `specs/frontmatter-schema.md`). Topics are free inline `#tag` labels, never directories
  ([ADR-0017](../09_architecture_decisions/0017-tags-as-labels-and-section-index.md)).
- Tags are free inline `#tag`s in the note body — no frontmatter `tags[]`.
  The **tags plugin** (`plugins/tags/`) is the tag **data owner**: a
  per-vault index of *every* heading-delimited section (tagged or not —
  milestone 33, so text search reaches untagged notes), kept fresh through
  the save/vault hook registries, plus the tag **prefix colors** and the
  **tag rename/merge** (Settings → Tags; longest `/`-namespace prefix
  wins, deterministic auto palette otherwise; the rename is a
  grammar-faithful token rewrite over the M33 replace discipline,
  descendants included by default, milestone 53). The tag **chrome is base**: editor pills +
  `#tag` completion (`src/app/editor/tags/`, fed by the base
  `TagVocabularyService` over `search:vocabulary` + `search:changed`) and
  a shared tag chip field (`TagField`, also handed to plugins as
  `api.ui.createTagField`; its free-text mode lifts typed `#tag` words
  into chips, ADR-0057). It hosts the **Find** panel (milestone 210,
  req-161, board 9c): **one** panel for Search and Tasks — the tags plugin
  draws the frame, the shared field (tag chips AND free text) and the
  Search mode; the tasks plugin offers its Tasks mode through the base
  find-mode registry (`api.ui.registerFindMode`, SDK 1.54). The Search
  mode keeps scope (This note | This vault | All vaults), case/whole-word/
  regex and replace (buffer patch in file scope; one bundled confirmation
  vault-wide) in its `⋯` menu, plus Export and the LLM **Summarize**
  digest (milestone 37, editable `builtin:search-summary` prompt).
  The MCP server reads the index through the registered
  `SectionSearchProvider` (which also serves vocabulary + prefix styles)
  and degrades with a clear error when the tags plugin is disabled.
  `#task` is reserved; the LLM only _suggests_ tags (Autotag — re-homed in
  milestone 45 as the editor `⋯` menu's "Suggest tags" row: it sends the
  caret's heading section (`shared/note-sections.ts`) and applies the
  suggested tags to it directly). See `specs/classifier-spec.md`.
- LLM transport behind a provider abstraction
  ([ADR-0047](../09_architecture_decisions/0047-llm-provider-abstraction.md)):
  base-owned `LlmClient` interface + a per-call `LlmRouter` over
  `electron/llm/providers/`. The default is the **local OpenAI-compatible
  endpoint** (LM Studio default; Unsloth Desktop, llama.cpp, vLLM, Ollama
  all work) with an optional `Authorization: Bearer` API key. Hosted
  presets (OpenRouter, Anthropic API, Z.ai GLM) and CLI providers
  (Claude Code headless, GitHub Copilot CLI) are **opt-in, off by
  default** — a documented exception to the old "no cloud calls" rule,
  same as the removable `copilot-web` scraper (ADR-0040). The startup
  **update check** against GitHub Releases (ADR-0074) is the one
  automatic network call: on by default as a bounded exception — it
  sends no user content, and download, install and restart always ask.
  The skills library's GitHub sources (req-289, ADR-0074 later change) are
  asked only on the owner's action — Fetch, Update, opening the page — with
  no token, from Drey Service. No hardcoded
  model id — never assume a specific model is loaded, and never assume
  `/v1/models` is reachable (the model id must stay hand-enterable;
  CLI/web providers advertise no model listing at all). API keys (and
  the env / header values of external MCP servers) are encrypted in
  `app-config.json` with the OS user's key — `electron/config-secrets.ts`,
  ADR-0010 later change; plain in memory and over IPC. **No timeout on
  generation** — a local model may think for minutes; the user cancels
  instead ([ADR-0014](../09_architecture_decisions/0014-no-chat-timeout-cancellable-tasks.md)).
- **Vault context by text search** (milestone 80,
  [ADR-0072](../09_architecture_decisions/0072-vault-context-by-text-search.md)):
  with the assistant's **Vault chip** on, a plain ask carries the note
  sections that contain words of the question — the words searched in
  the tags plugin's section index through the SDK's section-search seam,
  ranked in `plugins/assistant/shared/vault-context.ts` (a rare word
  weighs more, a word in the heading more still), the best four in the
  system prompt. **There is no embedding model and no vector index**:
  the retrieval of ADR-0055 (transformers.js, ONNX, the Search panel's
  Semantic toggle, `vault_retrieve`, the SDK's semantic seam) was
  removed and is not to be re-proposed (`specs/decisions.md`). **Chat
  notes are excluded** (`chats/` contains the literal question text of
  past conversations). The block is a first selection
  ([ADR-0069](../09_architecture_decisions/0069-agentic-vault-exploration.md)):
  the vault tools let tool-capable models look further (see "One vault
  toolset" below).
- **Manual refresh, plus an opt-in watcher.** By default there is no file
  watcher ([ADR-0018](../09_architecture_decisions/0018-manual-refresh-no-file-watcher.md)):
  a manual refresh runs one full round in main (index rebuild + a
  `vault:changed` renderer push), and the app refreshes after its own
  writes (save, first daily-draft save, create/delete). The purely
  additive watcher ADR-0018 left open now exists as an **opt-in**
  (`vault.watch`, Settings → Vault, off by default —
  [ADR-0045](../09_architecture_decisions/0045-optional-vault-file-watcher.md)):
  chokidar + an own-write ledger (mtime matching, so the app's own saves
  never echo) feed the same external-change round; clean open tabs
  auto-reload from disk; a dirty tab is marked "Changed on disk".
- **Save conflicts are asked, overwrites leave a version** (milestone 60,
  [ADR-0060](../09_architecture_decisions/0060-save-conflicts-and-local-note-history.md)):
  `note:save` carries the mtime the tab last saw; when the file changed
  since, main writes nothing and the renderer opens a merge view (on disk
  | result | mine, per-block checkboxes, editable result) — watcher on or
  off. `VaultManager.writeFile` records the
  text every write replaces in a local history under
  `<userData>/history/` (never in the vault; the user's own saves
  throttled, chats and `.drafts/` excluded).
- **Assistant tool groups + MCP client** (milestone 63,
  [ADR-0063](../09_architecture_decisions/0063-mcp-client-and-assistant-tool-groups.md)):
  what the assistant may call is the `tools` config slice (Settings →
  Assistant tools) — one switch per group (vault, tasks, templates, web
  search, web fetch, each external MCP server), `write: confirm | auto`
  on the writing groups, `approval: ask | allow` on everything that
  leaves the machine. `web_search` (milestone 79) asks the provider the
  user picked — DuckDuckGo without a key, Brave, Tavily or a SearXNG
  instance, one file each in `electron/mcp-client/search-providers/`.
  **The composer's Web chip is the per-question switch** for everything
  that leaves the machine: off = no external tool rides the call. External servers connect in main over the official MCP SDK
  (stdio / Streamable HTTP, tools only) and reach the model as
  `mcp__<id>__<tool>`. `mcp.enabled` / `mcp.yolo` only govern the
  server Drey offers to other programs. Opt-in, off by default — a
  further exception to "no cloud calls".
- **One tool loop, one system prompt builder** (milestone 76,
  [ADR-0071](../09_architecture_decisions/0071-unified-vault-toolset-and-agent-loop.md)):
  both HTTP providers run `electron/llm/tool-loop.ts` — only a tool that
  was offered runs, arguments are checked against the tool's parameters,
  a failure goes back to the model as `Error: …` (the one convention for
  a failed call; a tool never fails the ask), one round budget
  (`tools.maxRounds`) with a closing round that asks for the answer. The
  assistant's system prompt is built by
  `plugins/assistant/main/system-prompt.ts` and **names a tool only when
  it is attached to that call**; what a tool does belongs in its
  description, not in the prompt. Every prompt text and loop message is
  in `specs/classifier-spec.md`.
- **One vault toolset** (milestone 77, ADR-0071): `vault_list`,
  `vault_search`, `vault_read`, `vault_edit`,
  `vault_write`, `vault_move`, `vault_delete` in `shared/vault-tools/`
  (moved there by milestone 227, ADR-0071 later change) — one
  implementation over the `ToolVault` port for programs on Drey's MCP
  server and for the assistant (built in main over `VaultManager`), and
  for the Crew's workers through **Drey Service's vault MCP** (built over
  the registered vaults on disk, ADR-0094: a token per worker carrying
  its project — it reads the project's vaults and plain folders, writes
  where the project says Write and the persona has `allowed:
  write-notes`, a 1:1 reads every project read-only (req-283);
  no `vault_delete`, every call audited on the run's stream). Every call carries what it may do (`VaultCallOptions`):
  **the Vault chip is the scope of reading and writing**, enforced where
  the tool runs (chip off = no vault tools); `tools.vault.write`
  (`off | confirm | auto`) is the permission to change notes; a deletion
  is always asked. `vault_search` reads the note files themselves (no
  index of its own); an edit is an exact text replacement that must
  match once (`shared/text-edit.ts`). **A file that is open in the
  editor is read and changed through its tab** (milestone 78): main asks
  the renderer (`OpenDocsBridge`), never keeps buffers of its own. The
  note attached to an assistant question rides the call as a file of
  its own — in scope with the chip off, changed with `vault_edit`; live
  edit (ADR-0049) is that file marked `live`. The `document` fence is
  only the fallback for a call without tools. A new vault capability for
  the model goes into this set, not into a plugin-owned twin.
- **draw.io diagrams** (milestone 64,
  [ADR-0064](../09_architecture_decisions/0064-drawio-diagrams.md)): the `drawio` plugin opens `.drawio.svg` /
  `.drawio.png` / `.drawio` files in a tab holding draw.io's own web
  app — bundled, offline, in an iframe over `plugin://drawio/webapp/`
  (fetched by `npm run fetch:drawio` from a pinned, checksummed release;
  not in git). The two picture formats are ordinary images that carry
  the diagram, so a note embeds them with the existing image embed and
  the PDF export needs nothing; which one a new diagram gets is
  Settings → Diagrams (SVG by default). A diagram is inserted from the
  formatting strip's Insert menu or `/diagram`; until
  first drawn it is a placeholder picture. Diagram tabs **save
  automatically**. SDK 1.16 added what it needed: file openers by name
  suffix (`FileOpenerRegistry`, asked first in `EditorService.openFile`),
  binary read / write, `announce` on vault writes, and plugin buttons in
  the formatting bar (`ToolbarContributionsService`); a changed picture
  now reloads in open notes (`refreshChangedAssets`).
- **Office documents open in their own program** (milestone 66,
  [ADR-0066](../09_architecture_decisions/0066-office-documents-open-in-their-own-program.md)):
  Drey renders no Word / Excel / PowerPoint. A vault file whose
  extension is on the document allowlist (`shared/external-document.ts`)
  never opens as a tab — `EditorService.openFile` hands it to the OS
  (`shell.openPath`, allowlist re-checked in main). A note link may also
  be a local `file:` URL to a document outside the vault; nothing else
  reaches `file:`, and never a network share. Dropping an Office file
  copies it into `attachments/` and links it; **Alt-drop** links the
  original instead.
- **Git vaults** (milestone 65,
  [ADR-0065](../09_architecture_decisions/0065-git-vaults-source-control-plugin.md)):
  a vault can be a Git repository (its root or a folder inside it). The
  `git` plugin runs the **installed git** (`execFile`, no shell, one
  queue per repository, no timeout but cancellable) — never a JS or
  native reimplementation. File status reaches the Files panel through
  a base-owned decoration seam (`api.ui.setFileDecorations` →
  `FileDecorationService`; the base knows no Git); a plugin that
  rewrote the working tree calls `ctx.vault.announceChanges`. A save
  sets `updated:` only where the note already has it and **never adds
  frontmatter** (`touchUpdated`), in every vault. Milestone 67 (ADR-0065
  later change) adds merge with a conflict surface (keep mine / keep
  theirs / mark resolved, abort), stash, amend (never of a pushed
  commit — Drey does not force-push), commit and push, the "not pushed"
  history marker and a per-file *Git history* dialog; rebase, clone and
  hunk staging stay out.
- **Runtime plugin system**
  ([ADR-0044](../09_architecture_decisions/0044-runtime-plugin-system.md)):
  a **base application** (shell, editor + panes, vault/note IO, session
  restore, keybindings, spellcheck, MCP server, LLM *transport*, and the
  two plugin hosts) plus **runtime-loadable, in-process, trusted plugins**
  under `plugins/<id>/` — templates, meeting, tags, tasks, assistant
  (Assistant + Actions), browser, `ocr` (vision-LLM OCR, ADR-0050),
  `outline` (the open note's heading tree, renderer-only), `backlinks`
  (the "what links here" panel, milestone 54), `drawio` (the diagram
  editor tab, milestone 64), `git` (Git vaults, milestone 65), plus
  `sample` — dev/test-only since milestone 70 (built under
  `DREY_BUILD_SAMPLE_PLUGINS=1`; the authoring reference for
  `plugins/TUTORIAL.md`). Each is `plugin.json` +
  `main/` (CommonJS, Node) + `renderer/` (browser-context ESM + CSS over
  `plugin://`, **plain DOM**) + `shared/` types, built by
  `scripts/build-plugins.mjs` into `dist-electron/plugins/<id>/`. The
  renderer is **bundled** into one file (esbuild; ADR-0044 later change):
  it may import its own folder and the repo's `shared/` at runtime —
  never a package, `src/` or `electron/`; the build fails on those. Use
  the `shared/` function, do not copy it into the plugin.
  Discovery: built-in root + `<userData>/plugins/<id>/` +
  `DREY_EXTRA_PLUGIN_DIR` (dev). Every extension point is a base-owned
  registry — dock panels, doc kinds, Settings pages, menu rows, commands,
  editor extensions, drop decoders, context-menu items, composer slot,
  save hooks, vault hooks, section search — and the SDK in
  `shared/plugin-api/` is the versioned contract (major `apiVersion`
  gate). IPC is two fixed channels (`plugin:invoke` / `plugin:event`);
  enabling/disabling is `plugins.disabled` in app-config (Settings →
  Panels & plugins) and applies on restart. Base modules keep the
  ADR-0016 barrel convention (`eslint.config.mjs` deep-import ban);
  `shared/ipc-api.ts` stays the base cross-layer contract. Current
  structure: [docs/05 §5.0](../05_building_block_view.md).
