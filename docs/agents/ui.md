# UI / UX design — layout, panels, editing model

The binding UI specification behind `CLAUDE.md` § "UI / UX Design". Read it before any change a user can see. The text rules (English, the catalog, no decorative text) are in `CLAUDE.md` § "Language Convention". Moved out of `CLAUDE.md` unchanged (2026-11-15) so it is read when an area is touched, not in every session.

- Visual style: minimal and unobtrusive — flat surfaces, no heavy borders
  or shadows, generous whitespace, no visual clutter. Since milestone 43
  ([ADR-0057](../09_architecture_decisions/0057-ui-refinement-icon-chrome-anthrazit-and-slash-capture.md)):
  chrome labels are sentence-case **sans** (mono only for code, the
  meta-bar path and line numbers); panel controls are **icon-only** with a
  `title` + `aria-label`, drawn with the global `.icon-btn` / `.seg`
  classes (plugins get glyphs via `api.ui.icon`); panel fields carry no
  placeholder text. Three bespoke themes ship — **Drey** (terracotta),
  **Anthrazit** (neutral charcoal gray, blue accent, AA contrast — ADR-0057 later change; the fresh-install default)
  and **Cyberpunk** (violet-black, neon pink and violet).
- Overall layout ([ADR-0019](../09_architecture_decisions/0019-movable-dock-panels-and-layout-state.md)):
  a frameless window with a **custom titlebar** (accent square, the two
  dock toggles, the HTML File/Edit/Selection/View menu bar, back/forward
  arrows, window controls; each toggle folds its whole side dock away,
  `Ctrl+B` / `Ctrl+Alt+B`), then a row of **[left dock | centre column |
  right dock]** — the centre column being the editor area above a
  **bottom dock** band — then a 29px **status bar** (word/char count ·
  context hint · Settings entry).
  - **Docks**: three (`left`, `right`, `bottom`), each an ordered list of
    the nine panels — **Calendar, Files, Templates, Find, Open
    windows, Outline, Backlinks, Source control, Assistant** (the core
    ones registered by the base; Templates/Find/Assistant/
    Outline/Backlinks/Source control are provided by plugins, ADR-0044;
    Find replaced the Search and Tasks panels in milestone 210). A
    panel is dragged between docks by its header, resized against its
    neighbour by a splitter, and **opened or closed from the dock's icon
    strip** — a 37px row at the top of each dock with one icon toggle
    per panel living there (milestone 69, ADR-0019 later change). A
    closed panel shows only as its icon (no header row; status value in
    the tooltip); the icon is draggable like the header. Closing a side
    dock's last open panel folds the dock. Every panel header is built
    the same way (board 9a, 28px: fold chevron + sentence-case title +
    status value right after it + the panel's icon controls, on hover or
    focus only). The chevron folds a panel to its header, its strip icon
    stays on; a click on a header does nothing, a drag moves, a
    right-click offers Move to left / right / bottom dock and Close. What
    a panel inherits and may draw: the frame rule in ADR-0019. Default
    (Notes, board 7p, req-297): left dock 300 with Calendar and Files
    open and Find, Templates, Open windows, Source control, Tickets as
    icons; right dock 380 with the Assistant open and Outline, Backlinks
    as icons; nothing in the bottom band — the strip order is each
    panel's `order` (SDK 1.60). Work and Crew open with their own
    preset layouts (boards 7q, 7r), and `View → Reset layout` returns
    the active view to its own default (ADR-0089 later change). Calendar takes its content height, not a
    flex share; its title is the **month/year dropdown**
    itself (no "Calendar" title) with **Today** (opens today's daily
    note) and the month arrows on hover.
    Each dock can additionally host one **editor band** above its panels
    (milestone 20, ADR-0038): a docked editor pane, its 28px header
    carrying the active tab's name, movable by header drag or the tab
    context menu, resizable by its own splitter; docked editors persist
    with the session.
    `View → Reset layout` restores it (and undocks the editor bands).
    Layout state persists (`localStorage['drey.dock']`).
  - **Files panel**: one section per registered vault — a vault header
    row (name, fold chevron, path + active-vault tooltip) above the
    tree; in-place create/rename/delete in the tree; the vault row's
    context menu (Set active / Rename / Add vault / Open in File
    Explorer / Refresh / Remove); drag & drop of files/folders within and across
    vaults (req-23).
  - **Centre column**: a 37px tab bar for open documents (`--tab-bar-h`,
    the dock icon strips' height, so their bottom borders form one line under
    the titlebar; full-height tabs, the X on the active one and on hover), a
    37px meta bar
    (path · the formatting strip while pinned · Save while dirty · `</>` · `⋯`),
    the editor (Live Preview ⇄ source via the `⋯` menu — no toggle
    buttons; ADR-0008/0009), then the bottom dock band. Capture is the
    `/` menu's **Entry** block.
  - **Settings**: an **editor tab** (board 7g, milestone 197, ADR-0010
    later change): a core doc kind `settings` (`SettingsTabService`),
    one instance under `settings://`, opened from the status-bar entry,
    File → Settings, `Mod+,` and Help → About; it closes like any tab
    (its X, Escape while focus is inside it). Inside: a full-width
    search field (the one field that carries a placeholder, "Search
    settings" — the board's), then master-detail (category list left with
    collapsible sub-groups, detail pane right), core categories in
    alphabetical order, plugin-contributed categories (sorted by label)
    before "About" via `PluginSettingsHost`. Every page — core or
    plugin — has the same header (title + description) and is built
    from one stylesheet, `src/app/settings/settings-ui.css` (sans
    throughout, mono only for code; SDK 1.20 added the plugin page
    `description`). **Every change applies as it is made** — no Save,
    no Discard, no footer (ADR-0010 later change): the draft saves
    itself, a typed value when its field is left or on Enter. The
    confirmation dialog (Actions / Ask edits / MCP
    writes) is a centred modal: inline line diff for localized changes,
    an aligned split diff for whole-document rewrites (ADR-0011).
- Editing model: true in-place Live Preview (Obsidian-style, ADR-0009) —
  the cursor sits in the rendered document, syntax markers reveal only
  around the selection, tables/images render as widgets that show their
  raw Markdown while the selection is inside them; ArrowDown at the last
  row of a document-ending table (ArrowUp at one starting line 1) opens
  the missing line and steps out, so a table-only note stays editable.
  Source mode stays in the `⋯` menu as the escape hatch, not a separate
  "edit mode".
- Revealed embed source is always visibly contained: whenever an embed's
  Markdown source is shown (via the corner **`</>` View source** button or
  by moving the caret in), its raw lines sit inside a rounded, bordered
  container so the active-line highlight reads as in-scope. For an **image**
  the raw `![alt](path)` line is shown *together with* — above — the
  still-rendered picture, never replacing it. (`</>` = view source
  everywhere; the magnifier-with-`+` = zoom. Req-1.)
- No visual mockup file exists for the current layout — this section plus
  docs/05 §5.0 are the source of truth for layout intent, not an assumed
  saved mockup.
- The **v3 visual system** (milestone 14) has a real handoff:
  `handoff/DESIGN.md` (high-fidelity tokens, the four core principles, the
  dock-system spec) + `handoff/Drey App v3.dc.html` (interactive
  prototype, reference only) + `handoff/screenshots/`. Design tokens live
  centrally in `src/styles.css`. Deviations from the prototype are
  recorded in [ADR-0019](../09_architecture_decisions/0019-movable-dock-panels-and-layout-state.md)
  and `specs/`. The milestone-43 refinement
  ([ADR-0057](../09_architecture_decisions/0057-ui-refinement-icon-chrome-anthrazit-and-slash-capture.md))
  supersedes the handoff's mono-uppercase chrome and text buttons; where
  the two disagree, ADR-0057 and this section win.
