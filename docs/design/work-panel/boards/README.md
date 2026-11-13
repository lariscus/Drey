# The canvas boards — the binding reference for the look

Exported on 2026-11-06 from the owner's design canvas "Drey Tickets — Workflow
redesign" (artifact `a401ec8a-b3e4-459f-b9df-ff8893105b9f`, version
`1793992275-ade0`; the 9c, 9d and 9e boards `DeskFind`, `DeskFindParts`,
`FindDirections`, `FindSimple`, `DeskSourceControl`, `DeskSourceControlParts`,
`DeskOutline`, `DeskOutlineParts` and `canvas.json` from version
`1794096178-a5ad`, 2026-11-08; the Crew-concept boards `DeskModels`, `DeskServiceSettings`,
`ServiceWindow`, `ServiceSessions`, `MCCards`, the revised `DeskBoard` and `Autopilot` and
`canvas.json` from version `1794147040-05e9`, 2026-11-08, accepted by the owner the same
day; measure sheets and handoff in [../crew-concept-boards.md](../crew-concept-boards.md)).
**This folder is what "it looks like the design" means.**

The persona-board boards (`DeskBoardV2`, `DeskBoardV2Phases`, `DeskWorkV2`, `DeskPersonaV2`,
`MPadWorkV2`, `MPhoneWorkV2`, `MPhoneReadyV2`, `MCCardsV2`) and the revised `canvas.json` were
drawn for roadmap row req-264 from [../persona-board-concept.md](../persona-board-concept.md) and its draft
and exported on 2026-11-11 from canvas version `1794411563-4786` (`DeskBoardV2` and `DeskBoardV2Phases` re-exported from
`1794422747-c161`, the same day: the Capacity band merged into the column headers and a toolbar chip); they sit in their own row at the bottom of the
canvas, the boards they revise stay as they were. **Accepted by the owner on 2026-11-11** (milestone 237); the boards they revise remain the record of the built state until rows req-271 and req-273 replace those screens.

The design round of 2026-11-13 (`DeskProjects`, `DeskProjectFilter`, `DeskPersonaV3`, `DeskModelsV3`,
`DeskSkillsLibrary`, the revised `canvas.json`) was drawn from [../project-handling-draft.md](../project-handling-draft.md)
and exported from canvas version `1794584833-df73`; the boards sit in their own row at the bottom of the canvas.
**Accepted by the owner on 2026-11-13** (rows req-282 – req-291). The settings boards carry no scope tabs (owner, 2026-11-13: settings are global). `DeskPersonaV3` (1440×2000), `DeskModelsV3` (1440×1700) and `DeskProjects` (1440×960) are drawn taller than
the window so every block shows; in the app the left column and the settings pane scroll.

The default-layout boards (`DeskViewNotes`, `DeskViewWork`, `DeskViewWorkMC`, `DeskViewCrew`, the revised
`canvas.json`) show what each view opens with — on a first start and after `View → Reset layout` — and were exported from
canvas version `1794596818-9dc4` (titles and `viewsNote` revised in `1794597654-e225`; owner request 2026-11-13, finish
line step 5); they sit in their own row at the bottom of the canvas, with the per-view spec in the sticky `viewsNote`.
**Accepted by the owner on 2026-11-13** (row req-297): for Work he chose `DeskViewWorkMC` (Mission Control open);
`DeskViewWork` (the board alone at full width) was declined and stays only as history.

A session that builds or changes a screen reads the board's HTML for the exact
measures, colours, spacing and strings, opens the PNG to see it, and compares
its own screenshot against the PNG before it reports done (see
[build-plan.md §4](../build-plan.md) for the fidelity rule). Text briefs,
roadmap entries and the concept describe behaviour; **the board decides the
appearance** where they disagree.

Files: one `<Name>.dc.html` per board (plain HTML, inline styles; the
`<x-dc>` / `<helmet>` wrappers are the canvas runtime's), `support.js` — a
small stand-in for that runtime, so the eleven boards that hold a template
(`{{holes}}` from `renderVals()`, `<sc-for>`, `<sc-if>`: DeskClean, DeskFind,
DeskOutline, DeskPersona, DeskPersonaV2, DeskSettings, DeskSourceControl, PadFlow, PadReview,
PadSettings, PadTeam) render outside the canvas (it runs the board's own
embedded sample-data script; the other 38 boards are static and ignore it), one
`<Name>.png` rendered at the board's own size with headless Edge
(`--window-size=<w>,<h> --screenshot`), `canvas.json` (positions, sizes,
titles, order, notes) and `notes.md` (the sticky notes, decisions 1–31 under
`decisions1104`).

`compare.html` is the comparison viewer: open it in a browser, load a board
PNG and the screenshot taken at the board's size, and switch between side by
side, overlay, swipe and a pixel diff; the step-by-step is
[../fidelity-checklist.md](../fidelity-checklist.md).

Re-export when the canvas changes: read the artifact's `project/*.dc.html` and
`project/canvas.json`, copy them here, re-render the PNGs (the script used:
headless Edge over every `boards` entry of `canvas.json`), update the version
above.

## Index

| Board | File | Size | Device |
|---|---|---|---|
| 1 · The flow | `Main` | 1440×820 | reference |
| 5b · Shape: Mission Control shapes with Paul, plan in the middle | `PadShape` | 1194×834 | iPad |
| 5c · Plan to accept: one persona per part | `PadPlan` | 1194×834 | iPad |
| 5d · Crew: personas, what they run, stuck workers, Paul 1:1 | `PadTeam` | 1194×834 | iPad |
| 5f · Settings: theme, text size, and what else you need away from the desk | `PadSettings` | 1194×834 | iPad |
| 5h · Review a file, comment like a pull request | `PadReview` | 1194×834 | iPad |
| 5i · Shape the flow: standard by default, edit by hand or let Paul do it | `PadFlow` | 1194×834 | iPad |
| 7a · Work layout: ticket in the editor, Mission Control in the Assistant | `DeskWork` | 1440×900 | desktop |
| 7a v2 · Tickets panel, persona board: groups Needs you · Running · Prioritized · Inbox · Done, row meta by holder and position (`T-0129 · Ralf · 3/6`), the ticket pane with the chain — **req-264, canvas `1794411563-4786`** | `DeskWorkV2` | 1440×900 | desktop |
| 7b · Shape: the plan is the ticket, Paul works in it through the Assistant | `DeskShape` | 1440×900 | desktop |
| 7c · Plan to accept: the Parts block inside the ticket | `DeskPlan` | 1440×900 | desktop |
| 7d · Review tab: proof, files, line comments like a pull request | `DeskReview` | 1440×900 | desktop |
| 7e · Board tab with the Capacity band in the bottom dock — **revised 2026-11-08**: slots row, tranche and queue row in the band | `DeskBoard` | 1440×900 | desktop |
| 7e v2 · Board, persona columns: Inbox · Prioritized · the team in team order · You · Done, the position in the chain on the card (`Ben · 3 of 6`, the chain as initials), `running` / `waits for a slot` / `waits for Ben` / `merging main`, no persona for position 4, a run's question, Accept / Send back, sent back once and twice, an empty persona folded into `+ 1 persona`, each agent persona's load in its column header (`2/2 · 1 waiting` on Ben, the count emphasized at the cap), the Capacity band replaced by a `4/5 · 1 queued` chip in the toolbar with its popover open (slots per class, tranche, queue, Open in Service window) — **req-264, canvas `1794422747-c161`** | `DeskBoardV2` | 1440×900 | desktop |
| 7e v2 · the same board with the personas named Plan · Build · Review · Test (the phase board as a special case), the load in each column header and the Capacity chip closed — **req-264, canvas `1794422747-c161`** | `DeskBoardV2Phases` | 1440×900 | desktop |
| 7f · Crew tab: personas, stuck worker, setup and cost | `DeskTeam` | 1440×900 | desktop |
| 7g · Settings like VS Code: search, collapsible sections, scope tabs | `DeskSettings` | 1440×900 | desktop |
| 7h · Views: Notes · Work · Crew, Layout menu with save, reset, rename, delete | `DeskViews` | 1440×900 | desktop |
| 7i · Tabs belong to views: hidden elsewhere, added with Show here | `DeskTabs` | 1440×900 | desktop |
| 7j · Ticket ready to try: proof, checks, screenshots, cost table, accept | `DeskReady` | 1440×900 | desktop |
| 7k · Persona setup: profile, picture, work, permissions, prompt blocks — **superseded 2026-11-08 by the R11 mockup [`../crew-internals/persona-page-mockup.html`](../crew-internals/persona-page-mockup.html); built as milestone 231 (req-171), screenshot [`../crew-internals/persona-page-built.png`](../crew-internals/persona-page-built.png), retaken with the real skill routes, the prompt preview and the commit age as milestone 233 (req-237/238/239; [`persona-page-built-preview.png`](../crew-internals/persona-page-built-preview.png) with Preview full prompt open)** | `DeskPersona` | 1440×900 | desktop |
| 7k v2 · Persona setup, Work block of the persona board: model pool, class floor, parallel max and min, leaving actions (`sync-main`), read-only; no steps chips — **req-264, canvas `1794411563-4786`** | `DeskPersonaV2` | 1440×900 | desktop |
| 7k v3 · Persona: a class (super heavy · heavy · standard · light) and an optional pinned model instead of a harness, the picture changed and removed (D-67), Allowed to without vaults, skills from the library with a GitHub source, Instructions in the Markdown editor fill the rest — **2026-11-13, canvas `1794584833-df73`, accepted 2026-11-13** | `DeskPersonaV3` | 1440×2000 | desktop |
| 7l v3 · Settings → Models: harnesses and the models they offer, discovered; four classes (super heavy · heavy · standard · light, Add class), a model moves by drag or its class menu; slots per class; accounts with their cost, added and removed in place; routing folded — **2026-11-13, accepted 2026-11-13** | `DeskModelsV3` | 1440×1700 | desktop |
| 7m · Settings → Projects: name, colour (presets and a free colour picker), purpose in the Markdown editor, repositories, folders, vault access None / Read / Write (no profile: the owner needs no work / private distinction) — **2026-11-13, accepted 2026-11-13** | `DeskProjects` | 1440×960 | desktop |
| 7n · The global project filter in the title bar: Files and the board filtered to Drey, the load in the column headers counts every project — **2026-11-13, accepted 2026-11-13** | `DeskProjectFilter` | 1440×900 | desktop |
| 7o · Settings → Skills library: GitHub sources added in place, shared / GitHub / own skills, who uses them — **2026-11-13, accepted 2026-11-13** | `DeskSkillsLibrary` | 1440×900 | desktop |
| 7p · Notes view as it opens: Calendar and Files open in the left dock (Find, Templates, Open windows, Source control, Tickets as icons), today's daily note, the Assistant on Model in the right dock (Outline, Backlinks as icons), docks 300 / 380, no bottom band — **2026-11-13, canvas `1794596818-9dc4`, accepted 2026-11-13 (req-297)** | `DeskViewNotes` | 1440×900 | desktop |
| 7q · Work view as it opens: the persona Board with Mission Control open in the right dock (380), the Tickets panel in the folded left dock, the board keeps its column width and scrolls sideways, no bottom band — **2026-11-13, the owner's choice, accepted (req-297)** | `DeskViewWorkMC` | 1440×900 | desktop |
| 7q declined · Work view on the Board alone at full width, both side docks folded — **put to the owner 2026-11-13 and declined; history only** | `DeskViewWork` | 1440×900 | desktop |
| 7r · Crew view as it opens: the Crew tab alone at full width, both side docks folded, a card opens the Persona page as a tab, no bottom band — **2026-11-13, accepted (req-297)** | `DeskViewCrew` | 1440×900 | desktop |
| 9a · Drey today, cleaned up — ticket T-0017 in Work, Assistant without the rail | `DeskClean` | 1440×900 | desktop |
| 9b · Drey today — Calendar, Source control, Outline, Search and Tasks redesigned — **not a target design** (owner, 2026-11-06; a sketch, nothing is measured against it) | `DeskPanels` | 1440×900 | desktop |
| 9c · Find: Search and Tasks in one left-dock panel, Search mode (req-161, accepted 2026-11-08) | `DeskFind` | 1440×900 | desktop |
| 9c · Find, the parts at 1:1: Tasks mode, folded, status, field, Replace, tag completion, menus, hits, task rows, due order | `DeskFindParts` | 1480×1160 | desktop |
| 9d · Source control: branch line, commit field, staged / changes / history (req-162, accepted 2026-11-08) | `DeskSourceControl` | 1440×900 | desktop |
| 9d · Source control, the parts at 1:1: merge, amend, busy, hover actions, branch line, menu, empty and read-only | `DeskSourceControlParts` | 1480×1160 | desktop |
| 9e · Outline: the heading tree, every level folds (req-162, accepted 2026-11-08) | `DeskOutline` | 1440×900 | desktop |
| 9e · Outline, the parts at 1:1: three levels, all collapsed, folded, empty | `DeskOutlineParts` | 1120×620 | desktop |
| 9c · Find simplified — the owner's ruling (mode as title, one menu, Replace switch); superseded by `DeskFind`, history only | `FindSimple` | 1120×760 | sketch |
| 9c · req-161 directions: A chosen, B and C rejected — history only | `FindDirections` | 1120×780 | sketch |
| 10a · Mission Control, answer card with big touch targets | `MPhoneChat` | 390×844 | phone |
| 10b · menu: the root screen with Notes, Work, Crew, Settings and chats | `MPhoneMenu` | 390×844 | phone |
| 10c · Work: the desktop ticket list, sized for touch | `MPhoneWork` | 390×844 | phone |
| 10c v2 · Work grouped by holder (Needs you, then Paul, Ben …), meta `id · n/m · word` — **req-264, canvas `1794411563-4786`** | `MPhoneWorkV2` | 390×844 | phone |
| 10d · ticket: same card as the desktop, question inline | `MPhoneTicket` | 390×844 | phone |
| 10e · Work, three panes: tickets, ticket, Mission Control | `MPadWork` | 1194×834 | iPad |
| 10e v2 · Work, three panes, grouped by holder; Accept or Send back to a target in the Mission Control card — **req-264, canvas `1794411563-4786`** | `MPadWorkV2` | 1194×834 | iPad |
| 10f · Mission Control: chats next to the chat | `MPadChat` | 1194×834 | iPad |
| 10g · Settings: search and groups, same rows as the menu | `MPhoneSettings` | 390×844 | phone |
| 10h · Appearance: theme, text size, switches | `MPhoneAppearance` | 390×844 | phone |
| 10i · Crew: personas with picture, stuck worker, setup cards | `MPhoneTeam` | 390×844 | phone |
| 10j · Plan to accept: question card, Parts, Accept | `MPhonePlan` | 390×844 | phone |
| 10k · Notes: search, recent, folders of the vault | `MPhoneNotes` | 390×844 | phone |
| 10l · a note in View mode, pencil icon to edit, linked ticket, ask about it | `MPhoneNote` | 390×844 | phone |
| 10m · Mission Control proposes changes: Confirm or Dismiss each | `MPhoneProposal` | 390×844 | phone |
| 10n · Notes, three panes: files, note in View mode, Assistant | `MPadNotes` | 1194×834 | iPad |
| 10o · Ready to try: checks, cost by phase, one decision card | `MPhoneReady` | 390×844 | phone |
| 10o v2 · Ready to try on the persona board: chain, cost by position, Accept or Send back to a target — **req-264, canvas `1794411563-4786`** | `MPhoneReadyV2` | 390×844 | phone |
| 10p · editing a note: pencil, Live Preview, Cancel and Save as icons | `MPhoneNoteEdit` | 390×844 | phone |
| 10q · Ready to try, three panes: tickets, ticket with cost by phase, Mission Control | `MPadReady` | 1194×834 | iPad |
| 10r · editing a note: files, Markdown editor, Assistant | `MPadNotesEdit` | 1194×834 | iPad |
| 10s · iPad portrait — list and ticket, right sidebar closed | `MPadPortrait` | 834×1194 | iPad |
| 10t · Autopilot switch: on, paused, off — desktop status bar, iPad header, phone app bar  — **revised 2026-11-08**: tranche chips and bar, checkpoint pause, Release next tranche — **built** milestone 221 (req-179) | `Autopilot` | 1440×900 | all |
| 7l · Settings → Models: model table, capacity cap, slots and quota windows, routing, ledgers (concept 2026-11-08, ADR-0095, req-170) — **built** milestone 220; the Routing group **wired** milestone 224 (req-181: the three fields store what they show) | `DeskModels` | 1440×900 | desktop |
| 8a · Drey Service window: components, slots, governor, log; the tray menu (req-165) — **built, milestone 222** (`apps/service-window`, tray in `electron/service-window`); the Governor block's live values with req-180, milestone 223 | `ServiceWindow` | 1100×720 | desktop |
| 8b · Drey Service window, Sessions: every harness session raw — stream, instruction, tool calls, process (req-166) — **built, milestone 222** | `ServiceSessions` | 1100×720 | desktop |
| 8c · Settings → Background service: status, start with Windows, keep running, components, load, logs (req-165) — **built, milestone 216** | `DeskServiceSettings` | 1440×900 | desktop |
| 10u · Mission Control cards of the Lead: checkpoint report, merge conflict, budget and quota stop, queued, early stop — desktop and phone — parts 1, 6 and 7 **built** milestone 221 (req-179); the burn-rate card (no part of its own: part 4's layout, desktop and phone) milestone 224 (req-181); 2–5, 8, 9 open | `MCCards` | 1480×1160 | parts |
| 10u v2 · Mission Control cards of the persona board: no persona for a position, sent back twice, a run's question, merge conflict at Ben — desktop and phone — **req-264, canvas `1794411563-4786`** | `MCCardsV2` | 1640×1040 | parts |

The older boards one folder up (`Home`, `Ticket`, `Workers`, `Ready`,
`Shaping`, `Orchestrator`, `Phone*` of 2026-10-31) are superseded by the
rows above and stay only as history.
