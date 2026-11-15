# Drey — Concept & Roadmap

## Vision

An AI-powered knowledge hub for note-taking and task automation.

## Core Architectural Principles (fixed, apply to every phase)

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

## Tech Stack

Electron + Angular/TypeScript, CodeMirror 6 (editor), OpenAI-API-compatible
backend (LLM backend), Electron Builder (packaging). No embedding model
and no vector index — the assistant's vault context is text search
(ADR-0072).
No file watcher by default — vault is re-read on demand; opt-in chokidar
watcher for external changes (ADR-0045).

---

## Roadmap

Open work only. Everything implemented lives in
[`changelog.md`](changelog.md); everything decided against or excluded
lives in [`decisions.md`](decisions.md). When an item ships, move it to the
changelog and delete it here — no shipped history on this page.

**Status (2026-11-16):** version 0.8.1, milestones 1-286 built (1-21 in `docs/milestones-done.md`; 109-111 recorded by the convergence audit backfill), plus the requirements the changelog records without a milestone number (req-95a, req-95b, req-96, req-97, req-98, req-99a, req-99b, req-101, req-102, req-104, req-110, req-126 among them). Milestones 1–83 are
owner-verified (the round for 1–81 closed 2026-10-17; 82, the auto-update, and 83, the tickets foundation, on real use). From milestone 84 on, the changelog marks each entry that still awaits the owner's round — nearly all of them; that round is finish line step 6 below. Milestone and requirement ids are assigned when work starts; the next free ones follow from the top of `changelog.md`. Of the architectural cleanup, A1–A6 and A10–A12 shipped; A7–A9 remain.

### Finish line (owner, 2026-11-12)

The owner fixed the end of the current stretch ("ich habe das gefühl mit jedem Lauf entferne ich mich weiter statt näher an das Ende zu kommen" — "Ja, so"). **Only these items count**, in this order:

1. **req-257**, the runner on persona chains — milestone 247 (cursor, holder dispatch, You and notify entries, per-persona pool and breaker) and milestone 248 (send-back, questions, `### Chain`, Pia's entry).
2. **The seven known defects** below — D-53, D-54, D-64, D-65 (milestone 249) and D-55, D-57 (milestone 250) run beside req-257; D-56 closed without a fix on 2026-11-15 (`decisions.md`).
3. **An interim verification round** by the owner after milestone 248, so the unverified pile stops growing.
4. **req-270, req-271, req-273, req-274 (milestone 256), req-281 (milestone 261, with req-293 – req-296)**, then **req-268** (the live board migration, together with req-270/271), then **req-275** (ADR and specs, milestone 262). _req-270, req-271 and req-268's code side are built (milestone 254), req-273 as milestone 260; the owner runs the migration on his board himself (the Tickets panel's line, one confirmation per step)._
5. **req-282 – req-291**, projects, Persona v3 and Models v3 (owner 2026-11-13: *"die brauche ich alle vor dem merge nach main … aktuell ist das nicht nutzbar"*), in the order of their section below — and **every correction the owner names before the merge**, each added as a row of that section.
6. **The owner's verification round** of everything since milestone 213, then the merge of `desktop-integration` into `main` on his word.

**Everything else on this page is frozen** — the rest of "Now", the rest of "Tickets on dricket", "Later", the cleanup, the backlog and the 148 follow-up rows. Frozen rows stay where they are, are not worked and do not count; after the merge into `main` the owner picks what comes next.

**No new rows while the finish line stands.** A session adds a roadmap row only when something is broken, blocks an item above, or is a correction the owner names for step 5. Anything else it leaves out is one sentence in its changelog entry, not a row.

### Known defects

- **D-75 — The tickets plugin's renderer settings paths are directories in the repo, not files** (found 2026-11-16, on the `desktop-integration` base: `git ls-tree HEAD plugins/tickets/renderer/settings/`). Milestone 284's move recorded double paths — `settings.css/settings.css`, `dom.ts/settings-dom.ts`, `crew.ts/…`, `desk.css/…`, `models.css/…`, `page.ts/settings-page.ts`, `remote.spec.ts/…`, `remote.ts/…`, `repos.ts/…`, `sections.spec.ts/…`, `sections.ts/…`, `skills.css/…`, `workers.spec.ts/…`, `workers.ts/…` — so on a case-insensitive checkout these are folders where files belong. `shared/settings-width.spec.ts` fails on it (EISDIR, `plugins/tickets/renderer/settings/settings.css`), and `plugin.json`'s css list names the folders (`renderer/settings/settings.css`, `…/desk.css`, `…/models.css`, `…/skills.css`), so the pages' styles do not load. The in-flight req-314 branch (milestone 285) commits inside the nested paths (`page.ts/settings-page.ts`) — repair by one rename commit after that branch lands, or coordinated with its session; a repair must re-check `plugin.json`'s css list and the specs that read the files.




### Now (small, daily value)


_The Crew internals, designed 2026-11-07/08 — build in this order:_

- **req-184 — The persona's sub-agent policy** (follow-up of req-171). The concept's one row: a persona's sub-agent policy `off | read-only`. The Persona page board this row also named (7k v2) is superseded by board 7k v3 (milestone 268).

_req-184 when the owner picks it (req-185 shipped as milestone 273); board 10u's remaining cards (budget stop, quota stop, queued) come with the rows that raise them. The owner's "Stufe 0" (two weeks of concept statements with ids, by hand) is his own process beside this and gates nothing here._


**Mission Control redesign — concept v2 (E10, E11, E12)** (owner request,
outside the list, 2026-11-03; owner decisions D5–D12 closed; the design
canvas "Drey Tickets — Workflow redesign" is binding for the UI;
[ADR-0088](../docs/09_architecture_decisions/0088-tickets-engine-package-cut.md)
"Later changes" records the decisions). One milestone at a time, a pause after each. Nothing here creates tickets — the owner builds without the tickets system.

- **E12-3b — Settings pages still missing.** Chat (the model rows and
  "Test connection" shipped with D-1 / milestone 131; still missing: thinking
  trace, new chat, attachments), Repositories (launch command for verify, default
  branch) and "Away and alerts" — each needs a desk setting behind it
  first; away posture itself is out of scope.
- **E11-1b — Proof video follow-ups.** The 60-second cap is not
  enforced (the walk is short; Playwright cannot trim), the phone client
  fetches the whole video through the bearer header instead of
  streaming (a `<video>` tag cannot send it; the route itself answers
  Range), and the Drey-hosted Work panel shows no player.
- **E11-2c — Viewed marks on the desk, not per device** (split out of E11-2b by wave 4.6, Q7, 2026-11-07). E11-2b's look ships with the iPad fidelity row (board 5h: file tiles over one diff); what stays is the data half: a file's "viewed" mark lives on the desk (engine route + ticket review record) so every device shows the same marks, instead of today's per-device memory. Needs the engine route, the record in the review report, the clients reading it.
- **E10-4b — Plan to accept follow-ups.** The desktop widget shipped as milestone 196;
  here: the parent ticket leaves "needs shaping" once its parts are
  released (today it stays in its phase with one Log line), a per-gate
  estimate for the whole flow (the card estimates the build gate), the
  estimate reading "not yet" until the desk's answer arrives (it cannot
  tell "asked, no basis" from "not asked yet"). Adding or renaming a part
  from the card stays out on purpose (owner, 2026-11-04: board 7c's "Add
  part" button was removed again): the cut changes in the plan or by asking
  Mission Control.
- **E10-3b — Shape mode follow-ups.** Tinted line marks inside the
  rendered plan and a line-level "tap a line to edit" on the phone sheet
  (both want the Markdown surface, built in E12-6 — the surface is there,
  these two are still to wire in); the iPad board's formatting
  strip over the plan.

Decided against and not on the list: an overlap guard, touches or file
routing between parallel tickets (D5 — req-75 W7 and W8 dropped; their
tickets closed); a separate design persona (dropped, it was only an
example). The default crew is Paul (plans), Ben (builds), Ralf
(reviews), Tessa (tests); **Pia is the name of Mission Control itself**.
The product name "Drey Crew" needs a name check before any rollout, with
"Kobel" as the fallback (the code is not renamed). Out of scope: away posture / return briefing,
report intent, photo markup.

**Mission Control on the desktop, inside Drey (E13)** (owner request,
outside the list, 2026-11-04; design:
[`docs/design/work-panel/desktop-integration.md`](../docs/design/work-panel/desktop-integration.md),
boards 7a–7j of the design canvas; views:
[ADR-0089](../docs/09_architecture_decisions/0089-views-saved-layouts-with-their-own-tabs.md),
accepted, built as milestones 123 and 127). The desktop is not the iPad layout on a big screen: the ticket is
its Markdown file in the editor, Shape is that file plus Paul through the
Assistant, review and board are editor tabs, and the owner switches between
**Notes** and **Work** views. **Saved layouts (views) are mandatory, not a
second stage** (owner, 2026-11-04): without them the two kinds of work fight
over the same docks and tabs, so they come first. The desktop shows at least
what the mobile client shows (the cost above all). Base and SDK changes are
allowed, but the SDK stays content-agnostic: no function that only the
tickets plugin could use. Work happens in `src/app/` (docks, panes, session,
status bar, wikilinks), `shared/plugin-api/` and `plugins/tickets/renderer/`;
the E10–E12 line works in `apps/mission-control`, `libs/mission-ui` and
`packages/tickets-engine` and has not touched those (checked 2026-11-04), so
both lines can run side by side. Milestone numbers are taken when an item
ships.


Persona names follow D7 (Pia = Mission Control, Paul plans).

**Follow-ups of E13-11 / E13-12 (milestones 145–146):**

- **E13-12b — Budget pause and runners dialog.** "Pause when the budget is
  spent" (running work finishes first) and a runners dialog behind *Manage*
  (board 7g) need a desk setting first (E12-3b); today *Daily budget* only
  adds up the personas' budgets and *Manage* scrolls to the Workers section.
  (The default flow for new plans shipped as E10-5b, milestone 275.)
- **E13-11b — Flow tab, what is left.** The tab opens from the ticket
  strip and Settings; the plan block's "Change flow ›" link arrives with the
  Parts block (milestone 196, the tab can open `flow://<id>/<part>` already). The word
  helpers (`changesLabelOf`, `marksOf`, `moveRoomOf`) exist
  twice, in `libs/mission-ui` and in the plugin; one pure module in the
  engine package that both import would remove the copy.

**Follow-ups of E13-5 (milestone 138):**

- **E13-5b — Assistant targets, what is left.** Streaming of Mission
  Control's words into the thread (the engine already streams `chat` events
  on its `/api/events` channel; the plugin's `EngineClient.onEvent` drops
  them, so a turn shows "Working …" until it is whole); the step cards are
  req-139; the Claude Code CLI provider as the *Model* target with its tools
  switched off (`claude -p --tools ""` — the empty argument through
  `shell: true` on Windows is not verified); dictation reaching a speech
  service inside Electron (the Web Speech API needs a network service the
  packaged app may not reach — only seen as "button shown", not as words
  heard). The 1:1 answers since milestone 228; the Work and Crew views open
  on Mission Control since milestone 270 (req-297).

**Follow-ups of E13-9 (milestone 144):**

- **E13-9b — Shape in Drey, what is left.** The open tab follows the ticket
  when "Keep as one" moves its file (today the tab keeps the old path until
  reopened); Paul's edit as one Ctrl+Z step (needs the engine to return the
  plan instead of writing it, or the plugin to push the reloaded text as a
  buffer transaction); tinted lines for the marks inside the plan (E10-3b) and
  the line-level edit sheet.

**Proposed by the convergence audit (2026-11-04, milestone 134)** — evidence
and severity per item in
[`convergence-gaps.md`](../docs/design/work-panel/convergence-gaps.md); the
owner confirms scope and order before any of it starts:

- **E13-17 — Board filter and cost toggle.** "Filter: all personas" and
  "Cost by persona" on the Board tab (board 7e v2; not built in milestone
  254) (G-15).
- **E13-19 — Crew tab completion.** New persona from a template, the Runs
  after / This week / Typical run fields, the per-persona slot share (needs
  an engine count) (G-14); Notify is req-236, the picture from Mission Control and by drop req-235.
  Remove from crew shipped as the persona delete (milestone 236), the 1:1
  with milestones 228 and 261. The steps stay read-only chips of the flows
  (R11; the flow editor owns the toggles, `specs/decisions.md`).
- **E12-19 — Assistant labels, review layout, settings leftovers** (proposed by
  the E12-10 audit; S). (The Assistant's top row and its way of input stay as the owner adjusted them on 2026-11-05 — `docs/design/work-panel/assistant-owner-layout-2026-11-05.png`: icon-only target switch, composer with its field text, mic, send, icon row and model name; audit row M-01 is withdrawn. Only how the chat itself looks may follow the design.) `Pause when the budget is spent` (needs
  E12-3b's setting first); the Default flow row without the ticket dropdown;
  the Settings list no longer clips `Panels & plugins`; the disabled `Split`
  button says why; flow wording `Move earlier / Add a gate after this one /
  Remove this gate` [M-01, R-01, R-02, K-01, K-02, E-03, J-01].
- **E12-20 — Audit fixtures** (proposed by the E12-10 audit; S). The boards
  are exported to `docs/design/work-panel/boards/`; still to add are the
  fixtures the audit could not seed: an MC ticket with a waiting question,
  one with proof and a diff, an MC plan to accept, an MC shape session, the
  Views menu, a dricket-store Work panel — then run the audit's remaining
  rows [Z-02, A-08, B-02, R-04, F-02]. Docs and e2e fixtures only.

- **X-1 — Documentation and code hygiene.** The schema's noise promise
  versus the parser (G-20), delete `plugins/tickets/main/engine-host.ts` and
  reword the engine's package description (G-21), German code comments (G-22),
  undocumented commit subjects (G-33), the unaudited legacy parts of docs/05
  and docs/06 (G-34), a stray `apps/mission-control/node_modules` (G-35).


**Fleet stability, what is left** (owner request, outside the list,
2026-10-31; parts 1, 1b, 2, 4 and the rest of 1c/2b/4b shipped as
milestones 92–96; M3, the column as a `phase:` field, went with the files
backend — `decisions.md`, 2026-11-11). The runner writing the handover
section from the worker's answer (today the worker edits the ticket file,
the runner commits it); a runner-side check that the plan's acceptance
commands can pass (the plan prompt asks the worker to; a generic check
cannot tell a command for a file the build still creates from a broken
one); **the fork base of a fresh ticket branch** (req-93 follow-up):
`baseRef` is the repos.md `branch:` as a *local* ref of the owner's
checkout, which can lag the remote the commit step pushes to (T-0062
forked 8 commits behind) — fork from the freshest ref instead (fetch
before `worktree add -b`, never touching the owner's checkout); "Hand to
Claude Code" on a worker card (no defined meaning yet).

**req-75 W9 — Audit runs (own decision before it starts)** (owner request,
outside the list, 2026-10-31; [ADR-0087](../docs/09_architecture_decisions/0087-work-panel-replaces-the-kanban-board.md);
the rest of req-75 shipped — W1–W5 and their additions, W6 carried by
E10-2 – E10-4 — or was dropped, W7 and W8 in `decisions.md`). Read-only
architecture and security reviews (incl. a check against pinned OWASP
cheat sheets) that write a report into the work repo's `docs/` with
stable finding ids and propose tickets into Ideas. STRIDE and TARA are
separate items (req-76, req-77).

**Takeover follow-ups.** The Claude Code interrupt (stream-json
`control_request`) is not yet verified against the installed CLI. A run
has ceilings (`max-turns` and `max-work` since milestone 96, the board's
`token-budget`), but nothing stops a worker that reads without writing.
The cost of a flat plan is req-287's account cost.

**req-66 R7 — Web Push (optional, its own decision)** (ADR-0086). Push
notifications to the phone need HTTPS and Apple's push service, a further
cloud exception. The rest of req-66 shipped (R1–R6, R8, R9); the legacy
phone remote it built is gone (the decommission), so a push would reach
Mission Control.

### Tickets on dricket (owner request 2026-11-04; built, the board on the store since 2026-11-06)

**Built through E14-8 and the cut-over (E14-7 steps 1-8, 2026-11-06): the owner's board runs on the store `E:\projects\drey-board`, `drey-tickets` is the meta vault. The decommission (E14-9b) is built — Drey on dricket only, req-307's changelog entry. Open below: the follow-ups; the owner's round on the store (the cut-over's step 9) is part of finish line step 6. Nothing here reorders the lists above or below.**
The owner decided to move Drey's whole ticket handling, the fleet included,
onto **dricket** (`dk`, calls `dk ... --json`; no TypeScript
re-implementation). Analysis and plan: `docs/design/dricket/`
([fit analysis](../docs/design/dricket/fit-analysis.md),
[engine impact](../docs/design/dricket/engine-impact.md),
[migration plan](../docs/design/dricket/migration-plan.md),
[requirements on dricket](../docs/design/dricket/dricket-requirements.md));
decision draft
[ADR-0090](../docs/09_architecture_decisions/0090-tickets-on-dricket.md)
(status: proposed). Gaps in dricket are **requirements for dricket** (R-01 ..
R-21 in the requirements file), not Drey workarounds. Owner decisions
OD-1 .. OD-9 are open (migration plan §10). Each item is shippable on its own
behind `tickets.backend` (`files` stays the default until E14-7); the real-run
checks use a scratch store and a second instance, never `drey-tickets`.

- **E14-0 — dricket releases (owner's dricket repo, not Drey).** v0.6 read
  contract (full `ls`/`show` JSON, comments list, capabilities), v0.7 write
  contract (extension fields, `put`, configurable stages, `move`), v0.8 (import,
  change feed, stage log, Windows CI, dependency semantics). Gate for E14-4;
  not for E14-1..3, E14-5.
- **E14-2 follow-ups** (the shadow run against the migrated store is done, see the
  changelog's "Shadow run" fix): the 500-ticket benchmark no longer waits for dk
  R-05 — reads moved to the file reader (E14-4, milestone 154) — and the comparison
  of both read paths runs first there; ticket documents under `dricket` come with
  E14-4c. Findings of the shadow run, settled for the cut-over by E14-7a: **done and
  archived tickets** migrate (O-3, `--include-archive`), and with them **T-0017's
  `blocked-by T-0049`** stays a real link; the **allow list** is written fresh from the
  frozen vault (E14-7, step 2). Still true: **dk under a deep path**
  (the repo's scratchpad, > ~200 chars) fails with "Filename too long" /
  "clean local private worktree" — keep stores and `--data` short on Windows (dricket
  requirement candidate: report it to dk).
- **E14-4c follow-ups** (the editor save hook, the read-only guard, ticket
  documents from the checkout and the Settings fields shipped as milestone
  156; the managed checkout vault and the ref check as 161; a store
  document's header, strip and Shape target as 184–185). Open: `saveAsset`
  into the checkout's `tickets/` tree is not guarded.
- **E14-5c — What E14-5b left** (milestone 160 shipped the chain on a store, `chainRefusal` lifted,
  `## Verlauf` inside the claim, R-31 as a write-back, needs-input release + re-claim, leftover claims).
  The worker's own ticket chapters on a store shipped with milestone 204 (D-30). Open: (2) a **"release leftover claims" button** in Drey / Mission Control (the runner route
  `POST /claims/release-leftovers`, `FleetPort.releaseLeftoverClaims` and the plugin invoke
  `chainReleaseLeftovers` exist; the chain also runs it once per store before its first dispatch);
  (3) a **re-claim after a wait** lands in dk's first claim stage - unchecked for a ticket that waited in
  a later claim stage (`commit`), and with commit trailers on the claim is kept through a wait instead (the epoch
  the trailers carry must stand); (4) the chain on a **remote store**: the runner does not `dk sync` (the
  engine's change feed does); (5) a real run with a real worker on a second instance - only the scratch-store
  checks of milestone 160 were made; (6) dricket **R-31** stays a "nice" (one commit instead of two for a
  same-stage release), not requested.
- **E14-6 follow-ups** (comments, status verbs and the ledger shipped as milestone
  159; the answer control as milestone 260's persona cards). Open: (1) an **answer
  reaches the next run only through the thread**: the answer is a `resolved: <key>`
  comment, but nothing yet hands it to the persona's next instruction (a run that
  waits for the owner releases and re-claims on the answer, milestone 160, Q-03);
  (2) the story builder ("How it got here") reads the Log only, so a send-back shows
  from the short Log line, never from the comment; (3) the ledger file sits in the
  meta vault's working tree and rides that repository's next commit
  (`tickets/_meta/ledger.jsonl`, uncommitted by Drey, as before); a meta vault that
  is also the store's checkout would make dk flag it `unexpected-path` — keep them
  two folders; (4) the real check on a second instance (answer from the phone, a
  send-back from the owner) — only the engine services ran, on a scratch store.
  The comment composer is its own follow-up row.


### Finish line, step 5 — projects, Persona v3, Models v3 (designed 2026-11-13)

_Owner request 2026-11-13, outside the list: the design round after his verification of milestones 242–251 — the draft, his answers and the boards 7k v3, 7l v3, 7m, 7n and 7o, accepted the same day ([the concept](../docs/design/work-panel/project-handling-draft.md), [boards](../docs/design/work-panel/boards/README.md)). **Part of the finish line** (step 5, owner 2026-11-13: needed before the merge into `main`), in this order; the corrections the owner names before the merge are added here as rows. Quotas, the capacity pool, the slots and the routing stay cross-project._

No open row of the 2026-11-13 round: every one shipped (milestones 263–271, the last req-298 on 2026-11-14).

_Added by the owner on 2026-11-15 (the start of the Crew in a concept note, owner correction before the merge into `main`; [the concept](../docs/design/work-panel/concept-apply-draft.md), boards 7s – 7x accepted the same day). In this order, before req-300:_

- **req-310 — Live edit hears the owner's edits** (concept §4, boards 7s, 7t). Per chat session and note the Assistant keeps a shadow copy (the note at the end of the model's last turn); only when the owner sends his next message does the change shadow → buffer go along, as a diff with the section names — an edit never starts a turn (owner, 2026-11-15); until then a removable composer chip *n edits of yours go along* counts it, and on send a card *You edited the note* lands in the chat note. The model's own changes are never mirrored back; ADR-0049's lock stays. Assistant plugin, catalog keys, manual.
- **req-311 — Concept notes: the applied snapshot, the section delta, Apply** (concept §2, boards 7s, 7u). The applied version of a concept note is a snapshot in `_meta/concepts/<slug>/applied.md`; the delta is the note against it per section (heading): changed, new, removed. The Outline shows each section's state; the note's meta bar reads *Last applied … · n sections changed* with **Apply**, which opens the diff per section and *Decompose*.
- **req-312 — Decompose the delta into stages** (concept §1.4, §3, §5, board 7v). Apply (the button, or the tickets plugin's MCP tool `crew_apply_concept { path }`, asked like every write) creates one parent ticket per apply round in the note's project (`concept:`, `concept-rev:`); the Shape persona cuts only the delta into stages, each part naming the sections it `covers`; the existing Plan to accept shows them. A stage's brief gets `## Concept`: its sections' diff inline, the whole note by path through the vault MCP, every section with its state, and the rule that a mismatch is a question, never a silent fix.
- **req-313 — Stages: applied on accept, drop the rest** (concept §1.5, §1.6, boards 7w, 7x). A section enters the snapshot when its stage reaches Done (accepted at You), never on release; `dropRemaining` (a `PlanPartsEdit`) cancels every released stage that has not started; the parent closes when each stage is done or dropped (E10-4b's *parent leaves needs shaping* folds in); the Outline shows *building* and *at you*.


_Rebuilt from the cloud session of 2026-11-14 (owner: "Ja, so") - its four commits sat on the milestone-209 base and were recorded with `merge -s ours`; their content is rebuilt on the current tree (req-300 shipped as milestone 284):_

_Added by the owner on 2026-11-14 (crew management and the flow, before the merge into `main`):_


### Next

8. **Code signing.** The installer is unsigned — Windows SmartScreen
   warns on the first run of every fresh exe, updates included
   (`docs/11`). **Owner decision 2026-10-17: deferred** — the update
   channel ships unsigned (integrity is the SHA512 in `latest.yml`,
   ADR-0074); revisit when distribution justifies the cost. Options
   evaluated:
   - **Azure Trusted Signing** (~$10/month) — key in Microsoft's HSM,
     CI-native (electron-builder `azureSignOptions`, GitHub Action). Open
     question: identity validation for individuals in Germany.
   - **Certum Open Source Code Signing** (OV, ~€25–50/yr) — for
     individual OSS developers; SimplySign cloud token, CI signing
     fiddly.
   - **SignPath Foundation** (free for OSS) — Drey qualifies on paper;
     an approval process, signing rides their service.
   - **EV certificate** (~€300–700/yr) — the only instant SmartScreen
     reputation, but needs a registered business and a USB token that
     fights GitHub-hosted runners.

   ⚠️ When it happens: once an installed build is signed,
   electron-updater pins the publisher identity — future updates must
   keep it, and a later certificate migration needs a deliberate
   manual-download hop. Cut the first signed release knowingly.
9. **Tags at scale.** The Autotag prompt embeds the whole vocabulary
    (fine to low hundreds) and there is no near-duplicate detection
    (`sailing` vs. `boat`). Add a pre-filter and a duplicate finder
    on top of the rename/merge tool (milestone 53) before the vocabulary
    grows — since milestone 73 the lossless template feeds it into a
    second prompt.

### Later

- **req-109 — Measure what a run uses, against a directly started session (owner request 2026-11-06, outside the list).** The
  smoke's figures looked high: 203k tokens in (192k cached) over 18 calls to create and commit one file; T-0091, two runs, 3.3M in
  (about 3.1M cached) without a commit of its own, the second run starting its reading over. Measure the consumption of a fleet run and of
  the same task in a session started directly with the same model: calls, fresh and cached input, output, cost. Then decide from the
  numbers what to cut. The runner shows `cost=0` for these runs, so the cost has to come from the provider.

- **req-108 — Choose the run in a ticket's Thread (owner request 2026-11-06, outside the list).** After a second run on
  a ticket the Thread shows only that one, so the first run cannot be reached (cut-over smoke: the owner lost the way to the run).
  The Thread needs a session picker. Sequence, the owner's ruling: **designed with Claude Design first, signed off by the owner, and
  integrated only as part of the run's redesign**, not on its own before it.

- **Text completion (autocomplete).** ⚠️ Latency with a local model is the
  open question — run a spike (time to first suggestion on the target
  model) before any design. Today only `#tag` and `:emoji:` completion exist.
- **Web clipper.** Save the in-editor browser tab's page as a Markdown note.
- **Tasks inside the document.** First define what the Find panel's Tasks
  mode (milestone 210; filters, due dates, priorities, completion dates — ADR-0033) and the
  assistant's task block cannot do. If the answer is a live query block
  in a note, it borders the excluded dataview.js.

### Architectural cleanup (from the 2026-10-13 review)

Behaviour-neutral work on the structure, found in the architecture review
of 2026-10-13 — evidence and reasoning per item in
[`docs/11`](../docs/11_risks_and_technical_debt.md) ("Architecture review
2026-10-13", same numbering). Not ordered against the feature lists above:
the owner picks when one is taken. Within the section the order is by
value for effort. A1–A5 are done (see `changelog.md`), the follow-ups
A10–A12 shipped on 2026-10-17, and A6 on 2026-10-18; the ids of the
rest are kept so they still match `docs/11`.

- **A7 — One generic service registry between plugins.** Three provider
  slots (section search, task query; a third, semantic search, went
  with milestone 80) were each added to
  the base by hand, and the host names the assistant
  (`assistantToolbox`, `tagSuggester`, `origin: 'assistant'`). Before a
  fourth provider: a typed `provide` / `get` registry in the SDK.
  ⚠️ Needs an ADR; a real alternative, not a refactoring.
- **A8 — Large modules, when next touched.** `markdown-surface.ts`,
  `vault-manager.ts` (vault registry apart from file operations; delete
  the sidecar plumbing), `dock.service.ts` and the assistant's
  `renderer/state.ts`. No milestone of its own.
- **A9 — Make `docs/05` and `docs/06` readable.** Move the
  milestone-by-milestone record (§5.1–§5.40) into an archive file and
  group the 57 runtime flows by topic. Changes section numbers that
  `CLAUDE.md` and the ADRs link to — ⚠️ owner decision.


### Backlog (unordered, uncommitted)

- **Req-27** — review internal prompts (partial: ask protocol reworked in
  milestone 31, ADR-0053).
- **req-76 — STRIDE threat analysis from docs and code** (owner
  request, 2026-10-31; not planned for implementation yet — to be
  detailed first). A read-only run that derives a STRIDE pass (spoofing,
  tampering, repudiation, information disclosure, denial of service,
  elevation of privilege) per trust boundary from the architecture docs
  and the code (IPC boundary, CSP, MCP server and client, remote
  gateway, fleet runner) and proposes tickets for findings. Open:
  scope per run, report location and format, how findings are kept
  stable across runs, relation to W9 of req-75.
- **req-77 — TARA per ISO/SAE 21434 from docs and code** (owner
  request, 2026-10-31; not planned for implementation yet — to be
  detailed first). Threat analysis and risk assessment: assets, damage
  scenarios, threat scenarios, attack paths, attack feasibility, risk
  value, treatment. ⚠️ A model is good at assets and attack paths but
  unreliable at feasibility and impact ratings — those stay drafts
  until the owner confirms them; tickets only after confirmation.
  Open: which parts of 21434 clause 15 apply to a desktop app,
  feasibility method (attack potential vs. attack vector), report
  format, relation to req-76.
- **Req-29 remainder** — `copilot-cli` (GitHub Copilot CLI, `-p`) not on
  main; id unrouted in `electron/llm/providers/presets.ts`.
- **Req-22 remainder** — context-menu "add meeting log" + per-day
  appointment picker; needs a live calendar source.
- **Shared note parse for the per-vault indexes** — tags, tasks and
  backlinks each scan every `.md` on their own;
  only worth it once a large vault makes refresh slow.
- **Editor as a full dock panel** — the note editor living *among* a
  dock's panels (sortable like Files/Tasks), not only as an editor band
  above them (M20, ADR-0038); when nothing is open and a file gets
  opened, the default home stays the centre column. Owner idea
  (2026-10-17, "füge es nur als todo hinzu"), parked uncommitted — a
  core change to the dock/pane system that would need an ADR of its
  own.

### Follow-ups of shipped milestones (none committed)

- **req-301 — Worker isolation: the environment allowlist and a container backend** (from the cloud session of 2026-11-14, its "req-177"; follow-up of milestone 273, req-185). Every worker still inherits the runner's environment (only `npm_*`, `INIT_CWD`, `ELECTRON_RUN_AS_NODE` scrubbed). In order: a per-adapter `envAllow` plus a common required list as an opt-in mode until a probe run per provider proves it; `bypass` only with a sandbox backend; an opt-in Docker backend wrapping the worker spawn (the worktree and its `.git` common dir mounted, `--cap-drop ALL`, no-new-privileges, pid and memory limits, an egress allowlist). Open: the `.git` pointer into the main repo, `link:` folders, Windows and WSL, the provider logins.
- **req-302 — Follow-up proposals: reach and notice** (from the cloud session of 2026-11-14, its "req-178"; follow-up of req-299). The proposal cards sit in a Mission Control session with no Needs-you card or phone notice; scout and interactive runs are not told the `FOLLOWUPS:` rule (milestone 276 told every other dispatched run); a proposal cannot name `blocked-by:` between two proposals.
- **req-278 — The stage migration line beyond the Tickets panel (follow-up of milestone 239, req-265).** The snapshot carries `storeMigration` to every client, but only the desktop Tickets panel draws it (with **Migrate** / **Copy stages**); the desktop Board tab, Mission Control's desk and the phone show nothing, and Mission Control has no route to start it. It is a one-time step on the owner's desktop, so this waits until a board draws it; until then the Tickets panel is the one door. *(id provisional.)*

- **req-277a — dk: a Settings field, a way to update the bundled one, other platforms (follow-up of milestone 240, req-277).** The path rule is `dk.path` in the tickets plugin's `config.json` (no UI, like `dk.store`); a Settings → Tickets field would show which `dk` is in use (bundled or configured) and its version, which the board issue only reports when something is wrong. The bundle is the pinned release and changes with Drey's own releases; an in-app dk update (or a newer `dk` on PATH winning) is not built. `fetch:dk` and the extra resource are Windows-only, like the installer; a macOS or Linux build (`docs/design/macos-port.md`) needs its own archive and checksum in `scripts/dk-version.json`. The board issues are literal English strings in the engine (the engine package has no i18n binding): move them to the catalog when the engine gets one (req-106).
- **req-187 — The MCP row's client count (follow-up of milestone 222, req-165).** Board 8a reads `127.0.0.1:4319 · 3 clients (2 runs, Claude Desktop)`; Drey's MCP endpoint is stateless Streamable HTTP in the Drey process and keeps no notion of a client, so the service window draws `served by Drey`. Count clients (by `initialize` client info, recent requests) once req-212 moves Drey's server into the service (milestone 227 served the workers there: its row counts their live tokens), and put the count on the `mcp` record. *(id provisional — the integrator confirms it.)*
- **req-188 — Keep the harness's raw output (follow-up of milestone 222, req-166).** The Sessions tab's *Raw JSON* shows the normalized `stream.jsonl` lines; the board means the harness's own JSON. The runner would write each adapter's raw lines beside the stream (`raw.jsonl`, capped) and serve them as `GET /raw/<run>`. *(id provisional.)*
- **req-189 — A held run's release time (follow-up of milestone 222, req-166).** Board 8b's `held · releases in 11 min`: a held run (the takeover, a 1:1 dialog) has no release timer today; with ADR-0093's keep-warm span the record gets `releasesAt` and the session row and the runner row's `1:1 with Ben idle 4 min` read it. *(id provisional.)*
- **req-190 — Harness version and permission mode on the run (follow-up of milestone 222, req-166).** The fact grid's `claude-code 2.1 · sonnet · permission auto`: the run record carries neither the CLI's version (each adapter can read it at spawn) nor the permission mode the request had; add both to `RunInfo` and the window shows them. *(id provisional.)*
- **req-191 — *Open in Drey* at the ticket (follow-up of milestone 222, req-166).** The Sessions tab's *Open in Drey* (and *Open Drey*) brings Drey to the front; opening it at the run's ticket needs a way to hand Drey a target (an argument its single-instance hand-over reads, or a `drey://ticket/<id>` scheme). *(id provisional.)*
- **req-192 — The uninstaller ends a running Drey Service (follow-up of milestone 222, req-165).** `build/installer.nsh` removes the `DreyService` `Run` value; a service (and its tray process) still running from the old install keeps the files busy. The NSIS hook should ask the service to leave (`service-main.js --stop`) before it removes the files. *(id provisional.)*
- **req-193 — Heavy seats for what a worker starts itself (follow-up of milestone 223, req-180).** The governor seats the gate's commands, the ci checks and dev servers it sees listening on a leased port; a worker's own `npm test`, build, dev server or browser inside its harness session runs unseated — bounded only by the parallelism variables in the worker's environment. A small runner route (`POST /governor/seat {runId, task}` → a lease, released by the call's end or the run's) plus a shell helper the worker's instructions name (`drey-seat <task> -- <command>`) would let a worker take a heavy seat; browsers (Playwright, the proof screenshots) are the first caller. *(id provisional — the integrator confirms it.)*
- **req-194 — CPU rate cap and I/O priority for heavy processes (follow-up of milestone 223, req-180).** `os.setPriority` lowers the priority class (below normal) and `nice`; it does not cap CPU or lower I/O priority. A Windows Job Object (`JOBOBJECT_CPU_RATE_CONTROL_INFORMATION`, background I/O) needs a native helper behind the `ProcessPriority` port (ADR-0096 keeps that door open); worth it only if the owner still feels heavy tasks with the class lowered. *(id provisional.)*
- **req-195 — Dev servers off Windows; the dev-port range on Settings (follow-up of milestone 223, req-180).** The process table's listener probe answers on Windows only, so on Linux and macOS a dev server on a leased port holds no seat and the Governor block reads `none`; `lsof -iTCP:<port> -sTCP:LISTEN` / `ss -ltnp` would do it. The range (`service.json` `governor.devPorts`, default 4300–4399) has no field on Settings → Background service (board 8c draws none). *(id provisional.)*
- **req-196 — The pool popover's upgrade mark reads the engine's routing (follow-up of milestone 224, req-181).** The Models page reads `routing.upgradeAboveQ` from `GET /models` since milestone 224, but the slot chips in the board's pool chip popover (the Capacity band's, moved there with req-271, milestone 254) still mark `q` above the renderer's fixed `UPGRADE_Q` (1.3, `team/capacity-model.ts`) — the chain status carries no routing. Put `routing` (or the mark itself) on the chain status's `slots` and let `slotChipsOf` read it. *(id provisional — the integrator confirms it.)*
- **req-197 — One local day for the ledgers and the burn rate (follow-up of milestone 224, req-181).** Both count the UTC date, so the owner's day turns at 01:00 (02:00 in summer) in Berlin and the burn-rate card says `resumes 01:00`. A day boundary in the machine's zone, behind one injected day port, for every "today" of the service at once. Owner's call. *(id provisional.)*
- **req-198 — The burn rate of a slot without a weekly window (follow-up of milestone 224, req-181).** Kimi reads a 5 h and a monthly window, so the meter counts its runs at `RunShareTracker`'s weekly share — which has no `7d` samples there and stays the 5 % default per run. Scale the monthly window's drop since the day began to a week (× 30 / 7) instead, as a measured figure. *(id provisional.)*
- **req-199 — The reviewer's verdict into the ticket under a read-only session (follow-up of milestone 225, req-183).** A review's harness session runs read-only (Claude Code `plan`, opencode's `plan` agent, Kimi's `plan` mode), so it cannot edit the ticket's working copy in `_workcopy/` either: the verdict is its final message (`BLOCKED:` sends the step back), and what a reviewer used to write into `## Handover` — the confirmation or correction of the builder's `proof: ui|tests` declaration — is no longer written. Options: the runner writes the reviewer's final message (or a fenced block of it) into `## Handover` / a `### Review` block at the settle; or a write permission scoped to the copy (Claude Code `--allowedTools Edit(<copy>)` under `dontAsk`, opencode's agent permission per path). Also check live whether Kimi's `plan` ("no tool execution") still lets the reviewer read files, and whether opencode's `plan` agent's shell asks should be allowed for read-only git commands. *(id provisional.)*
- **req-200 — Drop the `_worktrees/<id>.ticket.md` read (follow-up of milestone 225, req-183).** For one release `WorkcopyFiles` reads the working copy at its old place and moves it into `_workcopy/`. One release after 0.8.x ships, remove `legacyTicketCopyPathFor` and the fallback (and its specs). *(id provisional.)*
- **req-201 — A review checkout for a ticket's further repos (follow-up of milestone 225, req-183; req-72).** Only the primary repo gets `<id>-review`; a multi-repo ticket's reviewer still reads the further repos' worktrees, which are writable. One detached, read-only checkout per further repo (`extraRepos[].reviewCheckout`), checked at the gate like the primary's. *(id provisional.)*
- **req-202 — The sampling auditor in a review checkout (follow-up of milestone 225, req-183; M85's quality rungs).** The second opinion (`secondOpinion`, flagged off) takes over the run on a green gate and reviews in the builder's worktree. Give its fresh worker the same read-only checkout and head check. *(id provisional.)*
- **req-203 — A builder's uncommitted changes at review (follow-up of milestone 225, req-183).** The review's gate runs the acceptance commands in the ticket's worktree at the reviewed commit, but that worktree may hold uncommitted changes the reviewer never saw (the checkout shows only the commit). Refuse the review start — or fail its gate — on a dirty worktree (`git status --porcelain`), or run the gate in a writable checkout at the commit. Owner's call: a builder's left-over scratch file would then stop the review. *(id provisional.)*
- **req-204 — Live text deltas over ACP (follow-up of milestone 226, req-182).** The removed `opencode serve` adapter streamed a reply while it was written (`text-delta` events, throttled to 500 ms, sealed by `detail: 'end'`); `AcpUpdateFold` gathers `agent_message_chunk`s and emits the text only at a tool call or the turn's end, for opencode, Kimi and Copilot alike. Emit throttled `text-delta`s from the chunks (keyed by `messageId` where the agent sends one) so the takeover transcript grows live again. *(id provisional.)*
- **req-205 — The re-attach seam with no implementer (follow-up of milestone 226, req-182).** Every ACP harness is a stdio child of its runner, so a worker no longer outlives an unplanned runner death (req-51's re-attach of opencode's server is gone; a planned handover still resumes in place). The contract's `attach`, `onAttachInfo`, `ServerInfo`, `ProcessSupervisor.attach` / `recordAttach`, `attach.json` and `RunAdoption.reattach` now serve nothing. Decide: remove them, or bring re-attach back over a detachable transport (an ACP agent behind a socket the runner can reconnect to, if a harness offers one). *(id provisional.)*
- **req-206 — A steer queued behind the running turn over ACP (follow-up of milestone 226, req-182).** opencode's server took a prompt POST while a turn ran and delivered it at the next step (the steer ladder's native `inject` without losing the turn); over ACP a steer while busy is `session/cancel` + the message as the next turn (Kimi's way) — the running turn's unfinished work is cut. Use a queued-prompt or steering method when ACP or a harness offers one (check opencode's and Copilot's `_meta`, the ACP RFDs); until then the cancel stays. *(id provisional.)*
- **req-207 — Per-model-call telemetry for opencode over ACP (follow-up of milestone 226, req-182).** opencode's prompt reply sums a whole turn's model calls; the run's telemetry (`turns`, `lastTurnContext`, `tokensBeforeFirstWrite`) is now per prompt turn for opencode runs (the totals and the cost stay right; the context window comes from `usage_update`). Read per-message usage where opencode offers it over ACP (`opencode/child-session-updates`, `_meta`), or mark the figures as per turn on the record. *(id provisional.)*
- **req-208 — Copilot CLI live check (follow-up of milestone 226, req-182).** Copilot CLI was not installed on the build machine: its launch description follows the docs (`copilot --acp --stdio`, `--model`, `--allow-all-tools`) and is proven with fakes only. Install it (`npm i -g @github/copilot`), `copilot login`, run `acp-live.spec.ts` (and with `DREY_LIVE_ACP_MODEL`), then settle: does the installed version send `session/request_permission` (github/copilot-cli#845) and does a read-only start without `--allow-all-tools` then ask for edits; do `--model` and `--allow-all-tools` combine with `--acp`; does a session advertise a `plan` mode; does `session/resume` work (users report `--resume` does not combine with `--acp`); is the `session/prompt` abort bug #4555 still there; does the prompt reply carry `usage`. Adjust `harness/copilot.ts` and FLEET.md's table. *(id provisional.)*
- **req-209 — An ACP run resumed in place counts its tokens from zero (follow-up of milestone 226, req-182; Kimi since E10-8).** After a runner handover the fresh worker's totals restart at 0 and replace the run's earlier figures on the record (`EventFold` copies `tokensIn` etc.). The old opencode adapter read the session's cumulative totals minus the run's base; over ACP the per-turn usage has no cumulative counterpart. Carry the run's own totals so far into the resumed worker (`ProviderStart`), or sum in the fold. *(id provisional.)*
- **req-211 — An opencode slot with its own login (follow-up of milestone 226, req-182; Spike 5).** opencode's GitHub Copilot provider needs one interactive device-code login (`opencode auth login`) stored in `<XDG_DATA_HOME>/opencode/auth.json`; it reads no existing gh or Copilot CLI login. A slot's `login` has no way to give an opencode worker its own data home (only `opencodeAuthEntry` / `opencodeAuthFile` for the z.ai readout). Add `opencodeDataHome`, spawned as `XDG_DATA_HOME` (`slotEnv`), so two opencode slots (accounts, req-287) keep their logins apart; the login itself stays the owner's one step in a terminal. (The work profile it was first meant for is retired, req-290.) *(id provisional.)*
- **req-212 — Drey's own MCP server for other programs moves into Drey Service (follow-up of milestone 227, req-167; ADR-0092 R6, ADR-0094 consequences).** Milestone 227 gave the workers the service's vault MCP; Claude Desktop, the stdio bridge and other programs still reach the vault through Drey's server in the Drey process (`electron/mcp/`, `mcp.enabled` / `mcp.httpPort` / `mcp.yolo`, Settings → MCP), so they lose it when Drey closes. Serve them from the service too: a client token per program (beside the per-worker tokens), `mcp.yolo` as their write rule, the confirmation diff through Drey while Drey is open and a refusal while it is not, the stdio bridge pointing at the service; Settings → Background service's MCP row then drives the service's component, and req-187's client count follows. *(id provisional.)*
- **req-214 — The `tags` filter of the workers' `vault_search` (follow-up of milestone 227, req-167).** The shared tool set restricts a search to tagged sections through the tags plugin's section index (`SectionSearchProvider`), which lives in the Drey process; the service passes none, so a worker's `vault_search` with `tags` answers that the index is unavailable (words, phrases, regex and paths work). Give the service a section reader over the files (`shared/note-sections` + the tag grammar) as the provider. *(id provisional.)*
- **req-215 — A worker's write in the local note history (follow-up of milestone 227, req-167; ADR-0094's stated price).** `VaultManager` records every replaced text in `<userData>/history/` (ADR-0060); a worker's write through the service leaves no entry, so *File history…* cannot undo it. Either route a write to Drey while Drey is up (the proxy variant ADR-0094 names), or let Drey capture the before-text when it hears of the change (req-213's path carries the paths, not the old text — the service would keep it). *(id provisional.)*
- **req-216 — A model-driven vault tool call on every harness (follow-up of milestone 227, req-167).** `harness-mcp-live.spec.ts` (`DREY_LIVE_MCP=1`) proves opencode 2.0.32, Kimi 2.5.2 and Claude Code 2.1.319 connect to the endpoint with their token, without a prompt; no live run has yet had a model call `mcp__drey__vault_read` and a refused `vault_write` and shown both audit lines in the service window. Run one ticket per harness in a project that grants a vault (req-283; costs tokens — the owner's verification of the block covers it), and Copilot CLI once installed (with req-208). *(id provisional.)*
- **req-218 — The 1:1's answer as it is written (follow-up of milestone 228; with req-204).** The answer lands when the persona's turn ends (`PersonaTurnWatcher` reads the stream on the fleet's change push). Show the reply growing on the Crew tab, the Assistant and Mission Control from the run's `text-delta` events once the harnesses emit them (Claude Code does; ACP is req-204).
- **req-219 — The 1:1's idle span as a setting (follow-up of milestone 228).** Fixed at 15 minutes (`shared/session-lifecycle.ts`, `IdleRelease`); make it a `service.json` / Settings value the runner and the clients' release time read.
- **req-220 — The 1:1's class request (follow-up of milestone 228; ADR-0095).** A 1:1 asks for the model table's class of the persona's own default model on its harness, with no step up, so a busy default model refuses the 1:1 instead of granting the next model of the class. Since Persona v3 (milestone 268) the persona names a class and may pin a model (`fleet/persona-harness.ts` takes the pin, else the class's first model): route the 1:1 like a dispatch's class request (no ticket, no size).
- **req-221 — Cancel a 1:1 turn (follow-up of milestone 228; with req-157).** A long answer can only be waited out or the session released from the service window; give the 1:1 pane, the Assistant target and Mission Control a Cancel that interrupts the turn (`interrupt` on the run) and leaves the session held.
- **req-222 — Earlier 1:1 conversations (follow-up of milestone 228).** The newest session file with a persona's `persona:` key is its 1:1; a persona has no way to start a fresh conversation or to read an earlier one from the clients (the Assistant target offers no `history` / `open` / a real `newThread`). Decide whether a 1:1 has one file forever or one per topic, then build the list.
- **req-223 — A 1:1 on each real harness (follow-up of milestone 228).** Verified with fakes only: a live 1:1 on Claude Code (`--permission-mode plan`, a quiet start, a turn's text and result in the stream), opencode (`plan` mode over ACP) and Kimi (`plan`), and the idle release on a real worker; Copilot CLI has no read-only mode (a stream note) — say so on the 1:1 or refuse it there.
- **req-252 — The 1:1's fleet read tools (follow-up of milestone 234, req-217).** `fleet_status` and `fleet_watch` are in the 1:1's read cut (`ONE_ON_ONE_TOOLS`) but no worker can call them: they are the tickets plugin's tools in the plugin-tool registry of Drey's own MCP server (`electron/mcp/plugin-tools.ts`, `plugins/tickets/main/mcp-tools.ts`), which lives in the Drey process, and the service's vault MCP serves the vault tools only. Serve the two read tools from the service's MCP over the fleet client's read port (the engine holds the fleet in-process), keep the same per-token cut for a 1:1, and add them to `OneOnOneVaultTools`' answer so the brief names them; until then the 1:1 reads the board in the tickets repository with its harness's own tools. *(id provisional.)*
- **req-253 — The 1:1's brief names tools by prediction (follow-up of milestone 234, req-217).** The brief is composed before the worker spawns, so `## Tools` follows what the spawn path will attach (the endpoint listens, the harness has an `mcpLaunch`, `MCP_HARNESSES`); an ACP agent whose `initialize` advertises no HTTP MCP is learned only at the handshake, so the brief could name `vault_read` while the stream says *this run has no vault*. Either let the first line carry a tools sentence composed after the spawn (from the gate's real answer), or send the brief after the handshake. *(id provisional.)*
- **req-254 — A live 1:1 calls the vault read tools (follow-up of milestone 234, req-217; with req-216, req-223).** Proven with fakes and the real endpoint over the official MCP client (a 1:1 token lists three tools, reads, is refused a write and the audit lines land) — no live 1:1 on a real harness has had a model call `vault_read` and a refused `vault_write` and shown both in the service window. Run one 1:1 per harness while a project grants a vault (req-283; costs tokens — the owner's verification covers it); `harness-mcp-live.spec.ts` (`DREY_LIVE_MCP=1`) only proves a harness connects, with no prompt. *(id provisional.)*
- **req-255 — A free session's brief names its vault tools (follow-up of milestone 234, req-217).** A free session shares the starter with the 1:1 and gets the vault MCP (the full six tools; from req-283 on, the rights of the project it takes and the persona's `write-notes`; read-only only in a read-only mode), but `fleet/free-session-brief.ts` names no tool — the model learns of `mcp__drey__*` from the MCP listing alone. Decide whether the free brief carries a `## Tools` section (with the write grant stated) like the 1:1's, once the owner has used a free session with a granted persona. *(id provisional.)*
- **req-260 — The seeded step text follows a new shipped version (follow-up of milestone 235, req-256).** The seeded `prompt.md` is a snapshot of the shipped character and of the role's step prompt at seeding; a later `drey-prompt-version` of `build-default` etc. does not reach it (the vault prompts under `_meta/prompts/` have "Reset to the shipped version" and the version marker; a persona's prompt has neither, and the marker is stripped). Decide: keep the marker in the seeded prompt and offer the same reset on the Persona page, or store the step by reference. S–M.
- **req-262 — Delete a persona from Mission Control's team detail (follow-up of milestone 236, req-261).** The route is served to every paired client (`POST /api/personas/<id>/remove` with `{confirm: <title>}`, the refusals with their `code`), but only the desktop's Persona page draws the action. `libs/mission-ui/src/team/detail.ts` has no modal and no typed-confirmation pattern (its memory and journal removals act at once, and its Setup tab has no destructive step), and the phone is the client where a destructive step deserves its own board: design the typed-name ask for the phone and the pad (a sheet, the field labelled with the title, Delete disabled until it matches, the refusals in the catalog's words — the keys are `persona.delete.error.*` in `shared/i18n/catalog/en.json`; Mission Control has its own `McI18n` catalog), add `removePersona?(confirm)` to `TeamDetailVm`, `McState.personaRemove`, and close the detail on success. Read-only devices never see it.
- **req-263 — The Persona tab closes itself when its persona is deleted (follow-up of milestone 236, req-261).** After a deletion the page hands the user to the Crew tab (`PersonaPageHost.removed`), but the persona's own tab stays open and shows *"missing"* until it is closed by hand, because the plugin SDK cannot close a tab (`api.documents` has `addDoc`, `rename`, `open`, no `close`). Add `documents.close(path)` (SDK 1.58, additive: `plugin-api.ts`, `plugin-api-impl.ts` over `EditorService.closeTab(key, { silent: true })`, `versions.ts`, `plugins/AUTHORING.md`, an ADR-0044 later change) and have `removed` use it.
- **req-224 — A closing round on each real harness (follow-up of milestone 229, req-169).** Verified with fakes only: a red-gated run on Claude Code resumed by `--resume <ref>` under `--permission-mode plan` answering the round's JSON, opencode and Kimi resuming over ACP `session/load`, and a harness that refuses the resume leaving a facts-only journal entry. Run one noteworthy ticket per harness and read its `reviews.md` entry and `memory.md` line.
- **req-227 — The closing round's tuning (follow-up of milestone 229).** The cost outlier reads the runs of the supervisor the run belongs to (one provider) — read the records of all providers; make the factor (3×), the window (20) and the minimum sample (5) settings beside `closing-signals:`; let the owner's Stop cut a closing round that is running (today it ends at its answer or its 10-minute bound).
- **req-228 — The journal by model on a client surface (follow-up of milestone 229).** `GET /report`'s `byModel` (runs, red gates, retries, steers, outliers, mean cost, causes, frictions per harness/model) is curl-able only; show it on the Crew tab and in Mission Control's team view (a board first).
- **req-230 — A free session waits for its class (follow-up of milestone 230, req-173; R10).** A free session the pool cannot serve now is refused with the pool's reason; R10's "queued · waits for a <class> slot" (the record in state `queued`, started when a slot of the class frees) needs the pool's request queue (`routing/request-queue.ts`) to hold a held-session start, and the form/card to show the wait.
- **req-231 — One machine file (follow-up of milestone 230, req-173; R13).** Drey's mirrored device settings (`service.*`, `remote.*`, `chat.*`, `gitPath`, `dk.*`, `fleet.pool.*`) still sit in the engine's `config.json` beside `service.json`; fold them into `service.json` (`ServiceConfigFile`, the schema in `service-config-schema.ts`), move every reader and the plugin's mirror, and delete the retired vault keys (`defaultWorker`, `autoPermissionMode`, `personas.default`, `fleet.cap.*`, `fleet.compactAboveTokens*`, `fleet.resumePauseTtlMin`, `fleet.contextCapTokens*`, `autopilot.tranche.*`, `autopilot.earlyStop.*`) and `chain.legacy.json` one release after 0.8.x.
- **req-232 — The rest of the vault keys on Settings (follow-up of milestone 230, req-173).** `_meta/crew.md` holds the instruction output caps, but Settings → Tickets writes only the default worker, the permission, the resume pause, the context cap and the compact thresholds. Draw the rest on the canvas first (fidelity rule), then build them over `CrewSettings`. The human persona's name (`personas.humanName`) is crew configuration too and would move into `crew.md`. (`default-persona` was retired by milestone 247.)
- **req-233 — A free session in Drey's Work panel and in Mission Control's chat (follow-up of milestone 230, req-173).** The owner talks to a free session on the service window's Sessions tab (and the takeover); Drey's Thread and Mission Control show no conversation of a free session. A free session has no chat file (a 1:1 has one); decide whether it gets one under `_meta/chat/` (`kind: free`, the directory) so every client reads the same conversation.
- **req-234 — A free session on each real harness (follow-up of milestone 230).** Verified with fakes only: a live free session on Claude Code, opencode, Kimi and Copilot CLI in the tickets vault and in a repository, the permission modes, the first line, the idle release of a real worker, and Pia's card confirmed against a real chat model.
- **req-240 — Progressive loading of skills (follow-up of milestone 232, req-172; R8).** Today a run loads every selected skill in full. When a persona carries many, put each skill's name and description in the prompt and let the worker read the body with a `skill_read` tool (the vault MCP's toolset, `shared/vault-tools/`, ADR-0094), the way Claude Code loads its own skills; the count in the preview then shows the descriptions only, with the bodies as the "if read" figure. Decide from the numbers of the `selectedTokens` field when it pays.
- **req-241 — An exact token count (follow-up of milestone 232, req-143).** `core/token-count.ts` estimates from characters with a rate per family (Anthropic 3.5, OpenAI-compatible 4.0). Behind the same `estimateTokens` seam: the provider's own count where one is reachable without a new cloud call (the Claude Code worker's reported usage of a finished run as a calibration, a local endpoint's `/tokenize`), `exact: true` only then.
- **req-242 — Skills on the phone client and in Mission Control (follow-up of milestone 232, req-172).** The routes are on `TicketsRemotePort` and the engine's HTTP API; only Drey's persona page (req-171) draws them. Mission Control's team detail and the phone client list a persona's skills with the switch, the token figure and the upload (a `SKILL.md` text; a zip from a file picker).
- **req-243 — A 1:1 proposal that carries a skill body (follow-up of milestone 232, req-172; R2/R11).** The 1:1's `skill` proposal adds a *name* to the persona's `skills:` list (`persona-session-service.ts`), which with Agent Skills folders is only useful when a folder of that name exists. Let the card carry the skill's text: accepting it writes `personas/<id>/skills/<name>/SKILL.md` through the upload path (refusing an overwrite) and adds the name, one commit.
- **req-244 — The prompt preview for a ticket and a step's own template (follow-up of milestone 232, req-143).** The preview fills the ticket's parts with placeholders and, for a persona with no `prompt.md`, shows no step template (the phase's prompt rides there in a real run). Take an optional ticket id (the real description, plan, handover) and the phase's template, so the count is the run's actual start.
- **req-245 — Skill management beyond the first cut (follow-up of milestone 232, req-172).** Import a folder of skills by path (the owner's `~/.claude/skills` in one step, without zipping); enforce a skill's `allowed-tools` (read and listed today, enforced by nothing). _(2026-11-13: import from GitHub shipped as milestone 269, req-289, and with it the deletion of a shared skill after the owner confirms how many personas use it — the names stay in their `skills:` lists as missing.)_
- **req-246 — Drop the flat skill files (follow-up of milestone 232, req-172; one release later).** `loadPersonaSkills` and `SkillFolderReader` still read a legacy `<name>.md` and the migrator still turns it into a folder (milestone 232, "one release"). A release after the owner's vaults have migrated, remove the flat branch, the migrator and `SkillView.legacy`, and drop the `<name>.md` form from `specs/ticket-schema.md`.

- **Settings → Tickets as sub-pages (open question of milestone 220).** Board 7l draws `Models` as a page of its own with an h1 under a Tickets nav that lists five entries; the host draws Tickets as one scrolling page with anchors. The page is built as a section whose title sits where the board's h1 does; separate pages per nav entry would be a base change in `src/app/settings/` and, with it, the question whether `Budget and runners` and `Walkthrough videos` stay in the nav.
- **The queue's head is not reserved (follow-up of milestone 217, req-170).** R10 lets the dispatcher take the next task whose class has room, so a class-A task can wait behind lighter ones while they keep fitting under the cap. If it bites: hold back capacity for the queue's head once it has waited longer than a span. Owner's call.
- **The context a session expects is never estimated (follow-up of milestone 219, req-178).** The filter takes no model whose declared `context` is below what the step needs — `needs: context-200k` on a ticket, a part or a phase works today — but the class request's own `contextTokens` stays null: nothing measures a ticket's text, its worktree diff and the instruction against the window. A first value could come from the context pack's size at dispatch.
- **Routing on the screens (follow-up of milestone 219, req-178).** The run's `grant.route` (q, estimated cost, the filtered slots, a step up) is not drawn on the card or in the service window's log (board 8a reads the runner log line). The capability columns and the models' import are req-286's.
- **A run's share of its windows is learned in memory only (follow-up of milestone 219, req-178).** `RunShareTracker` starts every runner life at the default 5 % per window and learns from the readings around each run's end; a restart forgets. Persist the samples (beside `service.json` or on the run record) if the reserve proves too eager after restarts. A step up refused by the cap or the reserve is not logged either — add it to the route line if the owner asks why a slot with surplus did not step up.

- **A Needs-you card for a slot whose login is refused, without a ticket (follow-up of milestone 215, req-177).** A run's `authentication_failed` already shows as the run's `failed` card; a quota fetch's 401 has no ticket and shows only as the slot state `needs-login` (`GET /slots`, the `slot` event, the chain summary). A card of its own needs a new Needs-you kind (`server/needs.ts`, `contracts/remote-protocol.ts` `NeedKind`, the phone views' `NEED_LABEL`, the desk's Needs-you group) with a "Signed in again" action over `POST /slots/login-done`. Belongs with the 7l / 7e UI work.

- **The runner's `storeBacked` argument is dead (follow-up of milestone 214, req-176).** Since the runner writes tickets only through a store claim, `Args.storeBacked` and the `--store-backed` flag in `fleet/runner.ts` are read by nothing; Drey Service still computes and passes it (`service/service-host.ts`, `server/engine.ts`, `service/runner-component.ts`). Remove it end to end. Two of those files are in the size baseline, so each leaves the list or is split in the same change.
- **req-175 — The merge message in the commit field (board 9d, follow-up of milestone 211).** Board 9d's merge state shows `Merge branch 'relaunch'` in the commit field. Today the field stays empty during a merge and an empty message keeps git's own (`MERGE_MSG`) — the same commit, but the owner cannot see or edit the text before it is made. Needs `status` to carry the merge message (main already reads `MERGE_MSG` for the source branch) and the panel to prefill the draft when it is empty. A "feature not yet built" row of milestone 211's Fidelity block. *(id provisional — to be confirmed by the integrator.)*
- **A store's open ticket gets no outline on its Work row (follow-up of milestone 205, found reading D-27).** `markOpenCard` (`plugins/tickets/renderer/index.ts`) compares the active tab's path with the row's `data-path` in the board's vault, and a store document lives in the checkout under another path, so `.work-row-open` never shows on a store.
- **A hand edit in a store's checkout reaches no tab until it is committed (follow-up of milestone 205, D-28).** The paths come from the diff of two HEADs, so a change `dk` or git did not commit announces nothing. Everything that writes a store commits, so only an editor pointed at the checkout's files sees it.
- **A checkout inside a larger vault flags the whole vault as plugin-managed (follow-up of milestone 205, D-25).** `TicketDocuments.refresh` marks every vault that holds the checkout, so Source control refuses that vault's writes, also for its other files. To be weighed with the owner: the mark is one per vault, not one per folder.
- **A board event during a running refresh is coalesced into it (follow-up of milestone 205, D-40).** `createBoardRefresh` keeps the existing rule that a call during a round waits for that round, so a change landing after the round read the board shows at the next event. Not seen; the store's own announcements follow within seconds.

- **req-135 — Ask about this note on the iPad (follow-up of milestone 198, board 10n; id proposed, the integrator may renumber).** Board 10n draws no Ask, because Mission Control sits beside the note. The composer is there, but nothing names the note any more, which `Ask about this note` did. To decide with the owner where that goes.
- **req-136 — The chats list on the iPad: search, running now, waiting cards (follow-up of milestone 198, board 10f; id proposed).** The chat's history sheet had a search, the live session's `running now` row and a badge of waiting cards. Board 10f's list draws the sessions by day only, so these three are not on the iPad yet.

- **req-119 — A ticket's Type: Ship / Fix (boards 7b, 7c, 7j; milestone 196)** (owner request, outside the list, 2026-11-07; found by wave 4.3 as a "feature not yet built" row; built later, not in wave 4). `TicketMeta` has no `type`, only `track`; neither the concept nor `specs/ticket-schema.md` defines Ship/Fix. Needs the schema field, the engine reading it, the card row (Type left, Worker right as the boards place them) and the fixtures.
- **req-121 — Priority and persona as dropdowns on the ticket card (board 9a; milestone 196)** (owner request, outside the list, 2026-11-07; found by wave 4.3 as a "feature not yet built" row). Today plain values set from the board; needs the card writing `priority:` and the persona at the cursor (the persona board's `hand` move, milestone 254) through the engine, with the chevron dropdowns the board draws.
- **req-122 — The reviewer persona's verdict in the Review band (board 7d, "Ralf: no blockers"; milestone 196)** (owner request, outside the list, 2026-11-07; found by wave 4.3 as a "feature not yet built" row; built later, not in wave 4). the review report carries no per-persona verdict; needs the review phase writing it (prompt + report field) and the band drawing the third fact.
- **req-123 — blocked-by between parts (board 7c; milestone 196)** (owner request, outside the list, 2026-11-07; found by wave 4.3 as a "feature not yet built" row; built later, not in wave 4). a part line can name the part it waits on ("blocked-by P1"); today only `after P1` + reason. Needs the Parts schema field, the dispatcher honouring it, the row drawing it.
- **req-124 — The verifier's recommendation at the end of the verdict (board 7j, "The verifier recommends accepting."; milestone 196)** (owner request, outside the list, 2026-11-07; found by wave 4.3 as a "feature not yet built" row; built later, not in wave 4). the test report carries no recommendation; needs the test phase prompt asking for one, the report field, the sentence in the proof block.
- **req-125 — SDK: `EditorSurfaceContext.mode()` (milestone 196)** (owner request, outside the list, 2026-11-07; found by wave 4.3 as a "feature not yet built" row; built later, not in wave 4). a plugin editor surface does not know whether its pane is in Live Preview or Source mode; 4.3 reads the pane's toggle from the DOM, which works and is e2e-covered but depends on base markup. The SDK exposes the mode (and its change) on the surface context; the ticket document then stops reading the DOM. Minor SDK bump, sample plugin updated.
- **req-138 — Per-option descriptions on the decision card (boards 7a, 7c, 10a)** (owner request, outside the list, 2026-11-07; found by wave 4.8 against boards 7a/7c/7d; built later, not in wave 4). The engine's `choices` card carries a label per option; the boards draw a second line under each ("one undo step, what other editors do") and mark one "recommended". Needs the card contract carrying `description` and `recommended` per choice (ADR-0071 / the conversation card of SDK 1.41), the orchestrator writing them, the Assistant and the device clients drawing them.
- **req-139 — Step rows and their age in the Assistant's Mission Control answer (board 7a: "✓ T-0121 · step 1 · tests green · 7 actions ›", "4 min ago · Ben waits")** (owner request, outside the list, 2026-11-07; found by wave 4.8 against boards 7a/7c/7d; built later, not in wave 4). The engine's answer carries text only; needs a structured step list per ticket in the conversation message (status, step, summary, action count, timestamp) and the rows in the Assistant; 7c's phase rows are req-129.
- **req-140 — Detach and name a target's attached document (boards 7a–7d chip `T-0121.md ×`; milestone 200; id proposed)** (owner request, outside the list, 2026-11-07; found by wave 4.8). The chip on a conversation target reads `T-0121.md attached` (the tickets provider's label) and cannot be removed; the boards draw the file name and an ×. Needs the conversation thread to let the owner detach (SDK: `ConversationThread.attached` entries with an id and a `detach`) and the provider's label without the verb.
- **req-141 — Allow edits and Use the web on a conversation target (boards 7a–7d icon row; milestone 200; id proposed)** (owner request, outside the list, 2026-11-07; found by wave 4.8). The boards draw all four tool icons on Mission Control; the panel hides live edit and web there because neither does anything on a target. Decide what they mean on a target (the engine's chat reading the web, a target that may change the attached note) before they are drawn.
- **req-235 — A persona's picture from Mission Control, and dropped on the desktop circle** (follow-up of milestone 231, req-171; E13-19's portrait item). Milestone 253 (req-292) draws `avatar.png` everywhere; milestone 268 (req-288) built the route (`POST /api/personas/<id>/avatar`, `/avatar/remove`, one commit each, a removed shipped picture kept removed by `seeded-pictures:`) and the Persona page's change and remove control (D-67). What is left: the same control in Mission Control (phone, iPad, desk) and a picture file dropped onto the desktop circle.
- **req-236 — A persona's `Tell me when` (the Persona page's Work block)** (follow-up of milestone 231, req-171; E13-19's Notify item). The mockup puts a rule beside the daily budget (`asks or stuck`, `done`, `never`); nothing records or reads one — a flow step has a `notify` flag (`Tell me when it is done`), a persona does not. Needs the record field (`notify:` in `persona.md`, `specs/ticket-schema.md`), the notifier consuming it per run, the select on the page. Until then the page draws no such control.
- **req-247 — Skills from the Persona page, beyond the first cut** (follow-up of milestone 233, req-237). `Add skill…` refuses an existing name (`skills.error.exists`) with no offer to replace it — after the name is known (a `SKILL.md` names it; a zip or folder is read by the engine) the page should ask once and retry with `overwrite: true`; a file or folder can be **dropped** on the Skills block (a folder drop needs `DataTransferItem.webkitGetAsEntry`); and the upload goes only to the persona's own folder — the shared pool (`scope: shared`) needs a switch or a second menu entry and a words-free way to say "for everyone".
- **req-248 — The prompt preview of unsaved instructions and of another step** (follow-up of milestone 233, req-238). `personaPromptPreview` reads `prompt.md` from disk, so the panel shows the *saved* brief while the head's `≈ N tokens at start` already follows the editor (the instructions' share is swapped by `atStartTokensOf`). Let the route take an optional `prompt` (and the IPC, the remote protocol and the HTTP query with it) so the panel shows what Save would produce, and offer the step in the panel (today the persona's first step, the engine's `build` when it has none).
- **req-249 — A model row's busy count from the engine** (follow-up of milestone 233, req-239). The `0 / 2 busy` figure is counted in the page from the fleet snapshot (`deps.runs()`: live runs and sessions by model, provider and slot) against `sessions` of the model table × the slots serving the row; a runner that is down shows no slot and no figure, and the capacity cap's cost weighting and the per-slot caps are not part of it. A `byModel` count on `GET /slots` (additive, `fleet/routing/`) would give Mission Control and the phone the same figure and let it follow the caps.
- **req-250 — Human skill titles on the Persona page** (follow-up of milestone 233, req-237; fidelity). The mockup titles a skill `Test first` and `Drey plugin authoring`; Agent Skills names are the folder name (`tdd`, `drey-plugins`), so the row shows it as `Tdd` / `Drey plugins` and puts the description in the row's tooltip. Decide where a human title lives (the frontmatter's `metadata.title`, a first heading, or nowhere — the folder name is what the owner types in `skills:`).
- **req-155 — Dock panels resizable freely, down to a minimum of the other columns** (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07). A side dock may take any width as long as the centre column and the other dock keep a defined minimum; today's clamps are per dock (`WIDTH` in `dock.service.ts`).
- **req-157 — Mission Control: visible progress while working, and a session lifecycle (applies to runs *and* 1:1 sessions held by the Crew runner — concept R12)** (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07). "Shaping T-0016 with Paul — Working …" stays silent for a long time; the owner needs feedback that the model works (streamed thinking / step lines, elapsed time), and a rule for the runner session behind a chat: the same session is reused while the conversation continues (the provider cache), and it is released after a defined idle span instead of hanging on. Ties to req-110's idle logic and to the capacity pool (req-170, milestone 217: a held 1:1 holds its seat). *The 1:1's half of the lifecycle shipped with milestone 228 (req-168): held while the conversation continues, released after 15 idle minutes; what remains here is the visible progress, the Cancel control and the runs' release.*
- **req-158 — Mission Control: context is passed, not typed** (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07). "Ask about this note" puts a visible text into the composer; the owner never wants to see that — the note (its content, not its path) rides as context. Likewise a question about a ticket must carry more than its id when the model needs it (title, body, state). Today (`packages/tickets-engine/src/services/chat-service.ts`, `turn()`): the model gets the board digest (priority order, columns with counts, the open tickets' id/title/phase), the tickets named in the text (attached whole through `readTicket`), the shape context (plan) of a shape session, the last turns, and an optional `reference` string — the note's path, not its text. Done when the composer shows only the owner's words and the context block is visible on demand (a chip "note · 1 section" like the desktop's vault-context chip), and the note's content reaches the model. On the devices the engine has no note attachment either: the Notes client prefills `About the note <path>:` and the model reads it through the vault tools; a `note` field on `POST /api/chat/sessions` (like `ticket` for a shape session) would carry it as a file (ADR-0071).
- **req-174 — Find: the pickers and the Summarize / Replace messages keep their pre-board form** (found by milestone 210, req-161 follow-up). Board 9c draws no due-date or priority picker, so `plugins/tasks/renderer/task-meta.ts` (`openDuePicker`, `openPriorityPicker`, their emoji labels) and the literal messages of `search-summary.ts` / `search-replace.ts` / the replace confirmation modal still read as before the redesign; they need a board (the pickers' look) and the catalog migration (ADR-0091, req-106 area by area).
- **req-160 — Visible feedback whenever a command starts** (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07). The owner's rule for every surface (desktop, Mission Control): starting a command — a run, a chat turn, a move, a save to the store — shows at once that something happens (a busy state on the control, a progress line, the step words), and its end or failure shows too; no silent waits like "Working …" for minutes (req-157 is the chat case). One pattern, written down in CLAUDE.md's UI section once chosen, applied where a command is missing it.
- **req-159 — Editor: one mode switch and a floppy-disk Save** (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07). The meta bar now has `</>` (source) and the `⋯` menu's Live Preview ⇄ View; the owner wants one explicit control to switch View → Live Preview (write) with its own icon, so the three modes read as one switch; Save is a floppy-disk icon (board 9a shows the pill; the icon is the owner's ruling for the built app — the board is adjusted).
- **req-147 — Settings: a recurring resume time for the Autopilot, and full-row search hits (boards 7g, 10t; O9)** (owner request, outside the list, 2026-11-07; found by wave 4.7, milestone 202; built later). The board's "Resume paused autopilot at 18:00 every day" is a one-shot time today; the settings search lists hits by name only where the board shows the whole row. Needs the recurring rule in the Autopilot record and the runner honouring it, and the search drawing the hit's row.
- **req-150 — The status bar's running summary (board 10t; O4)** (owner request, outside the list, 2026-11-07; id by ruling O4, milestone 203; built later). Board 10t draws `2 running · 1 stuck · 1 queued` left of the Autopilot item. The order and the unframed items hold since milestone 203; this item is the summary itself, over the fleet's runs, its `queued` from req-148.
- **req-151 — A shaping row names its plan version (boards 7a, 7b)** (owner request, outside the list, 2026-11-07; found by milestone 203). Board 7a's row reads `T-0119 · Shaping · plan v3 · yesterday`; on a persona board that is a ticket at a `:shape` entry. The snapshot's card holds no plan version (the phone reads it from the ticket's own `plan` reply), so the row shows no pulse without a dialog. Needs the version on `TicketCard` (an engine contract addition).
- **req-149 — A note's H1 as its title on the devices (boards 10k, 10n, 10r; O11)** (owner request, outside the list, 2026-11-07; found by wave 4.7, milestone 202; built later). The Notes client lists file names; the boards draw titles. Needs `/api/notes` serving the first heading (or the frontmatter title) and the client using it.
- **req-134 — SDK: status-item dot tones `paused` and `neutral`** (owner request, outside the list, 2026-11-07; found by wave 4.4 on board 10t). `StatusItemSpec.dot` knows `positive` and `attention` only; the desktop Autopilot item draws Paused with an orange dot and Off with a grey one on the board, and the plugin can only choose between green, orange and none. Add the two tones (minor SDK bump, sample plugin and 10t row updated); until then the item's Paused and Off dots are a justified row of milestone 197.
- **req-132 — Settings: the changed-only filter ("Changed · default N", board 7g)** (owner request, outside the list, 2026-11-07; found by wave 4.4 as a "feature not yet built" row; built later, not in wave 4). A toggle at the head of the settings page that shows only the settings whose value differs from its default, with the count; needs every setting to know its default (the schema in `shared/config` has them) and the rows filtered by it, in the core categories and the plugin pages alike.
- **req-133 — Settings: "Commonly used" (board 7g)** (owner request, outside the list, 2026-11-07; found by wave 4.4 as a "feature not yet built" row; built later, not in wave 4). A first section that gathers the settings the owner reaches for most (the board lists theme, text size, assistant model, autopilot); a static curated list to start with, each row a live copy of the setting in its own category.
- **req-127 — A `Model` conversation target on the devices (boards 10e, 10q, 5b, 5c, 10n)** (owner request, outside the list, 2026-11-07; found by wave 4.6 as a "feature not yet built" row; built later, not in wave 4). the right pane's segment reads `Model | Mission Control` on the boards; the client has no direct-model target on a device (every ask goes to Mission Control). Until it exists the iPad segment reads `Mission Control | Capacity` (decisions.md 2026-11-06). Needs the client calling the chat bridge without the orchestrator persona, a per-device setting for the model, the segment.
- **req-128 — The age of a plan mark (board 5b, "2 min ago")** (owner request, outside the list, 2026-11-07; found by wave 4.6 as a "feature not yet built" row; built later, not in wave 4). `marks` carries `by` and `text` only; needs a timestamp written by the engine when a mark is set and the relative time on the mark (desk and devices).
- **req-129 — Step rows on the plan page (board 5c: "✓ Shape · decisions locked", "✓ Plan · 3 parts written into T-0130")** (owner request, outside the list, 2026-11-07; found by wave 4.6 as a "feature not yet built" row). A summary line per passed chain position with its outcome; needs the engine deriving it from the ticket's log and status lines and a row per passed position above the Parts block.
- **req-130 — Settings controls of board 5f on the devices ("Show only changed", `Open sidebars` with `Change…`, an Editor category)** (owner request, outside the list, 2026-11-07; found by wave 4.6 as a "feature not yet built" row). `/api/settings` serves Appearance, Chat, Devices, Engine and the Autopilot block only; the changed-only filter, the sidebar defaults and an Editor category need their settings on the engine and the rows in the client. (The board's "This vault" scope went with req-291, milestone 258.)
- **req-131 — "View as command" and voice in the Flow editor's composer (board 5i)** (owner request, outside the list, 2026-11-07; found by wave 4.6 as a "feature not yet built" row; built later, not in wave 4). the flow page composer gets a `View as command` toggle (the flow as its chain grammar line) and the voice button the phone composer has; needs the grammar printer on the client and the recorder wired to that composer.
- **req-114 — Attach on the phone and the iPad (follow-up of milestone 195, Q3 of its measure sheet; widened to the iPad by wave 4.6, Q6: no iPad board draws it either, desktop web keeps it).** Board 10a's composer has no
  Attach and its bar no free control; the upload itself exists. The owner places it.
- **req-115 — Notes: folder counts and the vault's note count (milestone 195, board 10k).** `/api/notes` serves folders
  by path and name only. An additive `count` per folder and `total` on the list.
- **req-116 — Parts and phases: spent cost and estimates per row (milestone 195, boards 10d, 10j).** `/parts` serves no
  spent cost per part (`$0.58`), and a phase still to run has no persona to ask an estimate for (`est. $0.30–0.40`).
- **req-117 — Check rows' run time (milestone 195, board 10o).** A criterion carries no time (`tessa · 0:12`); only a
  walkthrough's chapters do, and only when the video has one with the same label.
- **req-118 — A chat question's why and consequences, a chat's ticket reference (milestone 195, board 10a).**
  `ChatQuestionOptionView` is label + recommended; a message names no ticket, so the linked card reads the id out of
  the answer's text and only finds a worker's open question.

- **Device saves in File history and save hooks (follow-up of req-100).** A note saved from a phone or iPad runs no plugin save hooks and leaves no version under `<userData>/history/`, because both live in the Drey process and the engine also serves with Drey closed. The conflict guard still protects the text; only the "File history…" row is missing. To decide: a version store the engine can write, or a catch-up when Drey next hears of the path.
- **An SDK event for the active vault (follow-up of req-100).** The Notes API follows Drey's active vault by a push at activation and with every board fetch; a switch without a board fetch reaches the engine late. A `ctx.vault` event for the switch would make it immediate.

- **Persisted "approve" / "team" values (milestone 173 follow-up, owner request 2026-11-06, outside the list).**
  The wording change of 173 left every stored or contract identifier alone (`decisions.md`, 2026-11-06). Candidates that would read better
  as the user-facing words, each needing a migration that is not done: the engine's
  `approve` checkpoint action kind, the Mission Control tab id `team` and the
  `tickets-team` document kind (persisted in view layouts and the phone URL), and the `desk-team` CSS classes.
  Each is a rename with a read-both/write-new bridge and a release note; none is needed for the owner to see
  "Crew" and "Accept".


- **Migrate the existing UI strings into the catalog, area by area (follow-up of req-102 / ADR-0091; req-106).** The i18n catalog (`shared/i18n/`, ADR-0091) covers only the surfaces of the 2026-11-06 canvas round; every older surface keeps its literal English strings. Migrate as areas are touched, one area per change: move its strings into `shared/i18n/catalog/en.json` under its `<area>.` prefix, read them through the runtime's binding (`I18nService` / the `t` pipe, `api.i18n`, `McI18n`, `i18n` in main), replace assembled sentences with ICU messages and `toLocale*` calls with the `Intl` helpers, then add the area's directory to `shared/i18n/guarded-paths.json` (and the ADR's list) so the guard keeps it. Candidate order: the Work panel and the ticket page (closest to the new surfaces), Mission Control's existing pages, Settings, the editor chrome, the Files panel, the native dialogs; the assistant panel's `shared/duration.ts` retires into `formatDuration` when its area moves. Not built.


- **Formatting strip on the phone and iPad Notes, the rest (follow-up of req-101, canvas Q5).** The bar over the shared `libs/markdown-surface` reducer exists (milestone 195: bold, italic, heading, list, task, link, tag; above the keyboard since milestone 250). Board 10r's paragraph style, table and insert are not built.

- **Merge view for a Notes save conflict (follow-up of req-101).** A `conflict` reply from `POST /api/notes/note` today shows the desk's text and the owner's draft side by side and lets the owner keep one ("Keep mine" / "Keep the desk's"). A per-block merge like Drey's (`conflict/`, ADR-0060) needs a diff over `shared/` that both clients can use; not built.

- **Notes API gaps found by req-101.** (1) `GET /api/notes/note` returns no ticket link; the client reads `ticket:` from the frontmatter fence itself (`specs/frontmatter-schema.md`). (2) There is no rename, move or delete and no folder creation; the clients create notes in the open folder only. (The note attachment on the chat is req-158.)

- **Review and flow tab titles (follow-up of milestones 181 and 183).** The thread tab reads `T-0121 · Title` and D-15 gave a `DocumentRoute` its own title, but the review tab still reads `Review · T-0121` and the flow tab its flow title (`review/register.ts`, `flow/`); milestone 183 left them waiting for that contract, which now exists.


- **Comment composer for store tickets (follow-up of D-12 and E14-6).** The thread shows a store ticket's comments since milestone 181 but cannot write one; a free comment from the board needs one `dk comment` call behind an input, and a comment is not editable.


- **Detach a dock panel (req-111; owner request 2026-11-07, outside the list; follow-up of req-104).** Board 9a's note names "move / detach / close" for a panel header's right-click; *Move* and *Close* shipped with milestone 192. A panel in a window of its own does not exist in the base yet: it needs a design (where it lives, how a plugin panel mounts there, how it persists).


- **Mission Control over the CLI providers (D-1 follow-up, 2026-11-04).**
  The chat bridge speaks the HTTP providers (OpenAI-compatible, Anthropic
  Messages) and refuses `claude-code`, `copilot-cli` and `copilot-web` by name.
  An engine-side CLI bridge (headless `claude -p` per turn) would let the
  chat follow those too; until then the owner picks an HTTP provider in
  Settings → Assistant.

- **Chain alerts fix (owner request, 2026-10-31):** the run's usage
  in the thread as a menu, like Claude Code's context indicator — a
  small context gauge in the composer toolbar whose click lists context
  used / window, tokens in (cached) / out, cost, turns, reads and the
  elapsed time. Waits for T-0061 (W4a), which rewrites the thread and
  only carries these numbers as the meta line's tooltip.

- **req-79 (fleet token audit, 2026-10-31):** the other levers the audit
  of 52 runs / ~372M input tokens found, by size. (1) A run had no
  context ceiling — req-80 added OpenCode's mid-run compaction at
  `fleet.contextCapTokens`; still open: a Claude Code worker has no cap
  (its CLI exposes no window override), and a turn budget that ends a
  run and starts it fresh from the diff remains the alternative if the
  compaction's fidelity loss shows. (2) `plugins/tickets/main/index.ts`
  and `renderer/index.ts` (now ~50 KB and ~146 KB) were read 40 and 89
  times; splitting them makes every tickets ticket cheaper. (The commit
  runs in code since milestone 245; the prompts were revised in 242.)

- **req-75 W1 (Work panel):** the thread is one tab that follows the
  ticket opened last; one thread per ticket needs a plugin SDK way to put
  a tab into a given pane.
- **req-65 (interactive dialog):** the fleet's MCP tool `fleet_run`
  cannot start an interactive dialog — `interactive` rides neither its
  input schema nor `fleetStart`'s MCP mirror; an assistant-driven
  dialog would want it.
- **req-53 (fleet usage):** the second-opinion worker (M85 quality rungs,
  flagged off) runs in a fresh session under the same run, and its usage
  events replace the first worker's counts instead of adding to them —
  the run then under-reports. Carry the first worker's totals forward
  when the second opinion starts.
- **req-50 (Tickets settings):** a `pipeline.md` (or any tickets meta
  file) with CRLF line endings does not parse — `splitFrontmatter` finds
  no fence — so a fresh clone of the tickets repo under
  `core.autocrlf=true` shows an empty board; and plugin pages cannot
  take Ctrl+S (the keybinding layer swallows it at window capture; an
  SDK way to pause or scope chords would let the prompt editor save on
  Ctrl+S).
- **Milestone 63 (MCP, ADR-0063):** OAuth-protected servers, handing
  servers to the Claude Code CLI provider, MCP resources / prompts.
- **Milestone 77 (vault toolset, ADR-0071):** moving a note across
  vaults; deleting a folder; a per-call cache of file contents when one
  search reads a large vault; `tasks_list` and the template tools for a
  vault other than the active one.
- **Milestone 75 (configurable shortcuts, ADR-0073):** more than one
  chord per command; rebinding the mouse side buttons; the plugins' own
  key handlers (the Git panel's Ctrl Enter, the assistant composer) are
  neither listed nor rebindable; chords match `KeyboardEvent.key`, so a
  chord recorded on one keyboard layout (AltGr layouts in particular) may
  need recording again on another.
- **Milestone 80 (vault context by text search, ADR-0072):** the
  context block reads the section index, not unsaved buffers; a question
  finds only sections that contain its words — no stemming beyond
  part-word matching, no synonyms (a tool-capable model searches further
  itself); the number of sections (4) is fixed; the templates folder is
  not in the section index and so never rides as context.
- **Milestone 79 (web search, ADR-0063):** a key per search provider
  (switching the provider clears the one key); a config-change event for
  plugins, so the Web chip follows Settings at once instead of when the
  pointer or the focus returns to the composer; the private-address
  guard of milestone 88 for `web_search`'s SearXNG address too; the
  DuckDuckGo page reader breaks when that page changes — watch it.
- **Milestone 78 (open note through the tools, ADR-0071):** a
  confirmation dialog that opened before the ask was cancelled stays
  open until the user answers it (the cancel discards the raced answer
  and nothing is written — the ADR-0011 dialog has no dismiss seam);
  an edit of a chat note or of a file opened from outside the vaults
  keeps the whole-document reply form (and such a file cannot be
  live-edited); the tag filter of `vault_search` reads the
  section index, not unsaved buffers; several attached files as edit targets.
- **Milestone 64 (draw.io, ADR-0064):** dirty state / manual save for plugin
  tabs, "New diagram" in the Files context menu, SVG ⇄ PNG conversion,
  embedding a plain `.drawio`, letting the assistant read a diagram.
- **Milestone 74 (assistant on a selection):** the button on a selection
  in the assistant composer, a PDF or the browser tab; a prompt that
  rewrites only the selection (today a rewrite is a manual Action over
  the whole document, with the selection as its focus); showing the
  quoted selection as its own element in the chat card.
- **Milestone 73 (lossless template):** enforcing the vocabulary on the
  reply (today the prompt only instructs; an invented tag is caught in
  the confirmation diff), offering the built-in trigger to installs from
  before the template (they add it once in Settings → Actions), running
  it on a selection only.
- **req-42 (Cyberpunk app mark):** the desktop / Start-menu shortcut icon
  following the theme (`shell.writeShortcutLink`, installed build only —
  brittle, see the changelog entry), and a themed mark on the splash.
- **Milestone 66 (Office, ADR-0066):** rendering Office documents in a tab,
  "Open in default program" for other file types, a setting for the drop
  behaviour (copy or link).

---

## Open Risks / Undecided Details

- Stale view with the watcher off: external file changes go unnoticed
  until manual refresh. Opt-in watcher (req-14, ADR-0045) covers it when
  it bites. A dirty tab no longer wins silently: the save asks
  (milestone 60, ADR-0060).
- Model contention: assistant usage vs. parallel benchmarking runs —
  needs an availability check before every call.
- Tag sprawl: no near-duplicate detection. Autotagging biases toward
  existing vocabulary; the rename/merge tool (milestone 53) allows
  consolidating by hand — detection stays missing (Next, item 9).
- Very large vocabularies: the Autotag and lossless-template prompts embed
  the full tag list —
  fine to low hundreds, needs a pre-filter beyond that (see
  `classifier-spec.md`; Next, item 9).
- Documentation drift: `CLAUDE.md`'s milestone summary and the manual's
  version footer were found behind the code on 2026-10-12. Keep them in
  step when a milestone closes.
