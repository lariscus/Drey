# Spec digest — read this instead of the four spec files

> **Generated** by `node scripts/gen-spec-digest.mjs` from `specs/roadmap.md`,
> `decisions.md`, `frontmatter-schema.md` and `ticket-schema.md`. Never edit by hand;
> `--check` (and `check-specs.mjs`) fail when it is stale. It carries **no line numbers
> and no status**, so it changes only when a principle, the finish line, a heading or a
> decision entry changes.

**What binds you.** The four files stay the binding specification. This digest is
what you read **first**: the fixed principles, the finish line that decides what may be
worked, and an index of every section and every excluded idea. Before you propose,
change or build something it touches, open the named section of the named file
(`grep -n "<heading or lead>" specs/<file>`; read the lines around the hit) — never the
whole file. Before you propose an idea, scan **Excluded ideas** below: anything listed
there is not to be re-proposed without the owner's new justification.

Open work and its order, the current status line and the next free ids are **not**
here: `grep -n "^\*\*Status" specs/roadmap.md`, then the section you need.

## Fixed principles (roadmap)

- Everything stays plain Markdown with optional YAML frontmatter — no
  proprietary format.
- No server — Electron app, direct file access to any folder (including
  OneDrive).
- Folder structure is **the user's own**. The app imposes only
  `templates/`, the daily-notes root (`daily.dir`, default `daily/`),
  `chats/` (assistant conversations) and the hidden `.drafts/` (exit-time
  auto-saves); topics are free inline `#tag` labels, never directories,
  and the app never creates or moves folders on a tag's behalf. Nested
  tags (`#project/frontend`) are a label hierarchy — a naming convention,
  still not folders (ADR-0017).
- Classification/synthesis via a **local** OpenAI-compatible API, no
  fixed model (LM Studio default; Unsloth Desktop/llama.cpp/vLLM/Ollama
  also work). Cloud calls are **documented, opt-in exceptions, each off
  by default** (ADR-0047, ADR-0063): the hosted presets (`openrouter`,
  `anthropic`, `zai-glm`), the Claude Code CLI provider, and the
  assistant's `web_fetch` / external MCP servers. The one exception is
  the startup **update check** (ADR-0074) — on by default, because it
  sends no user content and everything after it asks. A `copilot-web`
  provider was prototyped but never merged (see `decisions.md`).
- Interactive requests (capture, chat) always take priority over
  background jobs.

## Tech stack (roadmap)

Electron + Angular/TypeScript, CodeMirror 6 (editor), OpenAI-API-compatible
backend (LLM backend), Electron Builder (packaging). No embedding model
and no vector index — the assistant's vault context is text search
(ADR-0072).
No file watcher by default — vault is re-read on demand; opt-in chokidar
watcher for external changes (ADR-0045).

---

## Finish line (roadmap) — what may be worked now

The owner fixed the end of the current stretch ("ich habe das gefühl mit jedem Lauf entferne ich mich weiter statt näher an das Ende zu kommen" — "Ja, so"). **Only these items count**, in this order:

1. **req-257**, the runner on persona chains — milestone 247 (cursor, holder dispatch, You and notify entries, per-persona pool and breaker) and milestone 248 (send-back, questions, `### Chain`, Pia's entry).
2. **The seven known defects** below — D-53, D-54, D-64, D-65 (milestone 249) and D-55, D-57 (milestone 250) run beside req-257; D-56 closed without a fix on 2026-11-15 (`decisions.md`).
3. **An interim verification round** by the owner after milestone 248, so the unverified pile stops growing.
4. **req-270, req-271, req-273, req-274 (milestone 256), req-281 (milestone 261, with req-293 – req-296)**, then **req-268** (the live board migration, together with req-270/271), then **req-275** (ADR and specs, milestone 262). _req-270, req-271 and req-268's code side are built (milestone 254), req-273 as milestone 260; the owner runs the migration on his board himself (the Tickets panel's line, one confirmation per step)._
5. **req-282 – req-291**, projects, Persona v3 and Models v3 (owner 2026-11-13: *"die brauche ich alle vor dem merge nach main … aktuell ist das nicht nutzbar"*), in the order of their section below — and **every correction the owner names before the merge**, each added as a row of that section.
6. **The owner's verification round** of everything since milestone 213, then the merge of `desktop-integration` into `main` on his word.

**Everything else on this page is frozen** — the rest of "Now", the rest of "Tickets on dricket", "Later", the cleanup, the backlog and the 148 follow-up rows. Frozen rows stay where they are, are not worked and do not count; after the merge into `main` the owner picks what comes next.

**No new rows while the finish line stands.** A session adds a roadmap row only when something is broken, blocks an item above, or is a correction the owner names for step 5. Anything else it leaves out is one sentence in its changelog entry, not a row.

## Roadmap sections

- Vision
- Core Architectural Principles (fixed, apply to every phase)
- Tech Stack
- Roadmap
  - Finish line (owner, 2026-11-12)
  - Known defects
  - Now (small, daily value)
  - Tickets on dricket (owner request 2026-11-04; built, the board on the store since 2026-11-06)
  - Finish line, step 5 — projects, Persona v3, Models v3 (designed 2026-11-13)
  - Next
  - Later
  - Architectural cleanup (from the 2026-10-13 review)
  - Backlog (unordered, uncommitted)
  - Follow-ups of shipped milestones (none committed)
- Open Risks / Undecided Details

## Open risks (roadmap, first line each)

- Stale view with the watcher off: external file changes go unnoticed until manual refresh. Opt-in watcher (req-14, ADR-0045) covers it when…
- Model contention: assistant usage vs. parallel benchmarking runs — needs an availability check before every call.
- Tag sprawl: no near-duplicate detection. Autotagging biases toward existing vocabulary; the rename/merge tool (milestone 53) allows consoli…
- Very large vocabularies: the Autotag and lossless-template prompts embed the full tag list — fine to low hundreds, needs a pre-filter beyon…
- Documentation drift: `CLAUDE.md`'s milestone summary and the manual's version footer were found behind the code on 2026-10-12. Keep them in…

## Excluded ideas and won't-dos (decisions)

One line per entry: its lead and the first date it names. Detail is one grep away.

### Excluded ideas

- Drey Service started unconditionally, for a fallback vault (2026-11-15)
- Tranches and checkpoint reports dropped (2026-11-15)
- D-56 closed without a fix (2026-11-15)
- A migration for a store that is not on the lifecycle stages, and a default store inside t… (2026-11-11)
- Shape as a held harness session (2026-11-14)
- A red gate's return derived from the Log, the positions between walked again, the persona… (2026-11-14)
- Start on the card without asking, or asking per the assistant's write policy (2026-11-14)
- A machine-wide worktree root and a new default outside the tickets repository (2026-11-14)
- Roadmap rows superseded by the persona board, projects, Persona v3 and Models v3 (2026-11-13)
- Pia through a harness, a provider of her own, and the Crew tab's detail pane kept (2026-11-13)
- The Work view on the Board alone at full width (2026-11-13)
- Projects, Persona v3 and Models v3: a tickets repository per project, projects as the Fil…
- A chain run's verdicts and Pia's turn: a status-comment verb for the send-back, the gate…
- The runner on persona chains: holder columns in the snapshot now, Pia's entry ended only… (2026-11-12)
- Enter sends on the soft keyboard: the row's literal "Enter sends" for the phone, and a ke… (2026-11-12)
- Pia's persona: an ordinary agent with a fixed id, her prompt read once at start, a `crew.… (2026-11-12)
- The leaving actions: the commit merged by the engine itself, a `sync-main` conflict parke… (2026-11-12)
- A technical read-only lock for a persona, Alt+Left/Right to reorder the crew, and a setti… (2026-11-12)
- An interim bridge for the persona chain, and the delta kept beside it (2026-11-12)
- The stage migration: run unasked at engine start, Q-05 kept without exception, `dk commit… (2026-11-11)
- The files backend as a rollback (2026-11-11)
- The Capacity band beside the persona board (2026-11-11)
- The persona board's rejected shapes (2026-11-11)
- A role fallback in the persona ladder (2026-11-11)
- Deleting a persona: a `⋯` menu in the page's head, Drey's confirmation dialog or a native…
- The Persona page over the skill routes: skill switches held in the draft until Save, a ro…
- The 1:1's vault tools and the worker's announced writes: a cut in the tool list only, a s…
- The Persona page v2: a button for the Markdown, the editor bundled into the plugin, a sec… (2026-11-09)
- The closing round: a fresh request when the session is gone, no bound, a round on every r… (2026-11-09)
- Sessions and the configuration layers: a second store for the session records, `shape` as…
- The workers' vault MCP: a service-side copy of the tools, the token on the command line o… (2026-11-09)
- The 1:1: routed through the ticket starter, a thread file of its own, a blocking send, a… (2026-11-09)
- Claude Code over the ACP bridge (2026-11-09)
- Keeping the opencode HTTP/SSE adapter beside ACP (2026-11-09)
- The ACP adapter: a worker class per harness, Copilot's read-only by unverified flags, the… (2026-11-09)
- The review checkout: the gate inside the read-only checkout, a copy of the tree instead o… (2026-11-09)
- The resource governor: a native helper, the idle priority class, a load refusal without e… (2026-11-09)
- The checkpoint card as a ticket's status comment; a release endpoint of its own; a writte… (2026-11-09)
- Drey Service as a headless Electron app that opens its own window (2026-11-09)
- The service window as a window or tab of Drey itself (2026-11-09)
- A plain-DOM page for the service window (2026-11-09)
- A new Crew runner in Go as a separate product (2026-11-08)
- Integrating an off-the-shelf agent orchestrator (2026-11-08)
- A model step down when a slot's quota runs low ("bei q unter 0,7 eine Stufe tiefer") (2026-11-08)
- The Lead as a fourth entity beside Pia, Paul and the crew (2026-11-08)
- The coaching thread riding the run brief unreviewed (2026-11-08)
- Search and Tasks as two bands of one panel, or tasks as a saved search (2026-11-07)
- Find with always-visible segments, filter chips and inline toggles (2026-11-08)
- The attach button in the phone's chat composer (2026-11-07)
- Decision cards inside the phone's Work list (2026-11-07)
- The boards' "D" tile as the app's logo (2026-11-07)
- A new icon for every glyph a board draws (2026-11-07)
- Chasing the boards' text rendering (2026-11-07)
- Board 9a's 4 px offset between the dock strips and the tab bar (2026-11-07)
- 2026-11-07: req-96's 'the chat is never the centre on the iPad' gets one exception, the T…
- The Autopilot board's radii 12 and 6 in the build (2026-11-07)
- Board 9b "Drey today — Calendar, Source control, Outline, Search and Tasks redesigned" as… (2026-11-06)
- An agent moving a ticket into Done on a store, and a pipeline key for Accept's run (2026-11-06)
- Renaming stored identifiers to "Crew" / "Accept" (2026-11-06)
- Autopilot states map onto the ADR-0077 master (owner, 2026-11-06)
- Open-before-implementation answers (owner, 2026-11-06)
- Build-plan decisions (owner and technical calls, 2026-11-06, afternoon; `docs/design/work…
- `claim` stays `["building"]` (2026-11-06)
- State-name decisions (owner, 2026-11-06, evening)
- UI text is English by convention — widened to a catalog (owner, 2026-11-06)
- The pipeline's last column is not named "Sign Off" any more (owner, 2026-11-06, canvas de…
- Waiting for, or building, `dk import` / `dk add --id` (dricket R-10 / R-28) for the ticke… (2026-11-05)
- A TypeScript re-implementation of dricket's writes, claims and transitions (2026-11-05)
- "Refine with agent" and the `refine-interactive-default` prompt (2026-11-04)
- req-74 alternatives — app-internal toast chrome; OS-scheduled reminders while Drey is clo… (2026-10-31)
- Req-3/req-15 — `copilot-web` provider (Playwright + system Edge driving M365 Copilot's we… (2026-10-17)
- Req-17 — Jira integration: inline live ticket status, create tickets from the editor
- req-64 alternative — an MCP `ask_owner` tool for fleet workers (2026-10-20)
- req-9 — OCR remainder (iPad): on-device handwriting recognition. Desktop half shipped (`o…
- req-21 — dataview.js support
- req-10 — iPad/iPhone access via Tailscale: Drey itself running on the device (the editor,… (2026-10-30)
- req-11 — audio recording in interview mode (local Whisper; Win+H as likely first step). O… (2026-10-31)
- The kanban board as the tickets UI (2026-10-31)
- Job Queue (generic, multi-consumer)
- Embedding retrieval ("semantic search") (2026-10-14)
- Dedicated keyword search / FTS index
- Daily tasks day view
- Daily wrap-up
- Interview mode
- Colouring the file name by save state (2026-10-12)
- Bookmark management and sync (2026-10-30)
- Routing to to-dos (2026-10-30)
- Mission Control on the desktop (2026-11-04)
- Walkthrough video retention (2026-11-04)

### Won't do (decided against, kept for the record)

- Auto-pairing the ticket file and its thread across panes (2026-11-01)
- The kanban board as the tickets UI (2026-10-31)
- Daily template follows `templates.dir` (2026-10-30)
- Per-column worker slots (2026-10-30)
- One composer switch per external source (2026-10-13)
- Web search only through an MCP server the user adds (2026-10-13)
- Pause / resume of large semantic rebuilds on interactive use
- Task Center / stable task ids
- req-24 — Editor: image lines should show only the image, no text. → Dropped (2026-09-12):…
- req-25 — Remove "unsaved"/"saved" status; always persist changes. → Decided against (2026… (2026-09-12)
- req-26 — Frontmatter must update on save. → Dropped (2026-09-12): already implemented — `…
- req-41 alternatives — two other homes for the formatting commands. → Decided against (202… (2026-10-13)
- Assistant tool rework — alternatives (2026-10-13)
- Mission Control redesign, concept v2 (2026-11-03)
- Convergence audit (2026-11-04)
- Notes API, req-100 (2026-11-06)
- The Capacity band leaves the Crew tab (2026-11-07, wave 4.2)
- Fidelity review, wave 4.7 (2026-11-07)
- Crew internals design session (2026-11-07/08, `docs/design/work-panel/crew-internals-conc…
- The persona router policies are dropped (req-170, milestone 217, 2026-11-09)
- The burn rate, req-181 (milestone 224, 2026-11-09)
- Skills as Agent Skills, req-172 (milestone 232, 2026-11-09)
- The default crew, req-256 (milestone 235, 2026-11-10)
- Persona v3, req-288 (milestone 268, 2026-11-14)
- Ask Paul and the Flow chat, req-306 (milestone 280, 2026-11-14)

## Ticket schema (ticket-schema) — the top-level rules, verbatim

# Ticket Schema — the tickets repository format

The complete, machine-facing specification of Drey's ticket handling
(ADR-0076; the fleet that works it is ADR-0075). Written so that a
human, a Drey component, or an agent CLI can operate the format from
this file alone. Ticket files are **not** vault notes — only the YAML
conventions shared with [`frontmatter-schema.md`](frontmatter-schema.md)
apply (quoted dates, plain text).

> **req-307, E14-9b (Drey on dricket only):** the TICKETS live in a
> dricket store — one `dk` store on the lifecycle stages
> (`inbox prioritized active running done`, `claim = ["running"]`),
> created by Drey itself on the first start when none is configured
> (`store/fresh-store.ts`). Their records (`dk show`, the header keys,
> the body sections below) follow dricket's own format
> (`docs/design/dricket/`); the section "Reading tickets from a dricket
> store" at the end says how the board folds them. What remains in the
> **meta vault** is the board's configuration and the crew: the
> `_meta` tree below — pipeline, repos, projects, crew, personas,
> skills, chat, ledger. The old files backend (ticket files in numbered
> phase folders, `handover:` keys, `_meta/prompts/`) is gone.

Top-level rules, once, up front:

- **One ticket per store record. The stage is the record's `stage:`;
  the store's id is the identity.** A move is one `dk put` with the new
  stage — never a file move, never a commit in the meta vault.
- **The board's columns are the lifecycle edges** (`_meta/pipeline.md`:
  inbox · prioritized · done, below) plus the working area: every
  ticket a chain holds stands in the **active** stage column, its lane
  naming the holder (req-257, the persona board, ADR-0098).
- **A move in the meta vault is one git commit** — the crew's writes
  (personas, repos, projects, crew.md, the ledger), never a ticket
  move. On the store, every change is one `dk put` (dricket's own
  protocol, R-xx of `docs/design/dricket/dricket-requirements.md`).
- **A refine from the remote is one record write** (req-66): the header
  keys (`title`, `priority`, `repo`) and section names (`description`,
  `plan`, `acceptance criteria`) are replaced through one `dk put`, with one Log line
  `- '<UTC>' owner@<device> — refined (<what changed>)`. It replaces a
  section's body up to the next heading of any level (so `## Plan`
  keeps its `### Acceptance criteria`), and adds a missing section
  before `## Log` (Acceptance criteria at the end of Plan).
- **Machine writers write strictly** (the exact shapes below);
  **humans edit freely** (a hand edit of a record reaches Drey through
  the store's git); **readers normalize visibly** — anything a reader
  cannot parse unambiguously is reported as an issue on the board,
  never guessed. Tolerate noise, never ambiguity.
- All timestamps are **UTC, seconds precision, quoted**:
  `'2026-10-17T14:32:00Z'`.
- Line endings LF. Encoding UTF-8.

### Ticket-schema sections

- Layout
  - Attachments (req-66 R8)
  - Videos (E11, concept v2 §5.3)
  - Id minting
  - The branch rule
- The record — a store ticket's shape
  - Proof mode (E11)
  - Parts (E10, concept v2 §5.9)
  - Frontmatter fields
  - Dependencies (`blocked-by`)
  - Priorities (`priorities:` in pipeline.md)
  - The project's store (`store:` in pipeline.md, req-315)
  - Body sections
  - The scout form (E8, concept §5.6)
  - The chain (req-266; was the chain delta of E9)
  - The persona board (req-270, req-271; concept rows 9 and 10)
  - The persona board as a whole (ADR-0098)
  - The fleet ledger (E7)
  - The ticket status log (E7)
- `_meta/pipeline.md` — the board's columns (the persona board)
- `_meta/personas/` — the agent personas (E3)
- `_meta/skills/` — skills as Agent Skills (req-172, R8)
  - GitHub sources — `_meta/skill-sources.md` (req-289, R8)
  - The routes
- `_meta/repos.md` — work repositories
- `_meta/projects/` — projects (req-282)
- `_meta/crew.md` — the crew's defaults and limits (the vault layer, req-173)
- The session record (req-173, R12)
- `_meta/chat/` — the Mission Control sessions
  - Worker follow-ups (req-299, owner 2026-11-14)
- Validation (where it runs, what it checks)
- Reading tickets from a dricket store

## Frontmatter schema (frontmatter-schema)

# File & Frontmatter Schema

Frontmatter is **optional** and app-managed; a note is just Markdown, and the
tag system reads the body. The app-understood fields are `title`, `created`,
`updated` — plus `kind: chat` as the one document-class marker.

- Frontmatter (optional)
- Body
- Daily notes — `<dir>/<year>/<month>/YYYY-MM-DD.md`
- Chat notes — `chats/<year>/<month>/<date>-<slug>.md`
