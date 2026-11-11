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

**Status (2026-11-11):** version 0.8.1, milestones 1–151, 153–163, 165–169 and 171–238 and 240, plus req-98, req-101, req-104 (the desktop frame matches board 9a), req-126 (the frame follow-ups of wave 4.2: no strip on a one-panel bottom dock, a view badge, a view's own tabs), req-110 (the fleet runner leaves when deactivated or when Drey quits idle), req-102 (the i18n catalog, ADR-0091), req-99a, req-95a, req-95b, req-97, req-96 and req-99b built (109–111 are recorded in the changelog by the convergence audit backfill) — 1–83
owner-verified (milestone 82, auto-update from GitHub Releases ADR-0074,
end-to-end on a real install, the 0.7.0 → 0.7.1 update round included
docs/07 checklist; milestone 83, the tickets foundation ADR-0075/0076,
through the live board rounds T-0001 – T-0006 in the owner's tickets
repo). **Milestones 84 (the fleet runner) and 85 (continuous
orchestration, ticket T-0007, ADR-0077) — like the later owner requests
86–91 — are built and suite-green but await the owner's rounds** — see
their changelog markers. **Milestones 97 (the tickets-engine package cut), 98 (one transition
machine + status log + fleet ledger), 99 (the host-agnostic service
layer) and 100 + 101 (the remote/gateway move and the standalone engine
process, ADR-0088 E2b) and 102 (personas, ADR-0088 E3) and 103
(verify/proof, ADR-0088 E4) and 104 (the Mission Control chat engine,
ADR-0088 E5a) and 105 (the Mission Control app, ADR-0088 E5b) and 106
(the ticket screen + proof card + Drey hosting, ADR-0088 E5c) and 107
(the self-improvement loop, ADR-0088 E6) and 108 (the status log +
fleet ledger surface, ADR-0088 E7) and 109 (the Scout track,
ADR-0088 E8 — concept §5.6) and E9 (the chain delta, ADR-0088 E9 —
concept §5.7, the last concept item) are built
and suite-green but await the owner's
rounds** — with E9 the whole E0–E9 arc stands built and the concept
is complete, caveat:
none of it is owner-verified yet; the next step is the owner's
verification round before anything further. **Milestones 123 (E13-1, views — saved layouts with their own tabs, ADR-0089), 124 (E13-3, status bar slot), 125 (E13-4, link fallback to other vaults), 126 (E10-4, plan to accept), 127 (E13-2, view presets and home views, SDK 1.39), 128 (E10-5, flow editor), 129 (E13-6, the ticket as a document) 130 (E13-8, Board and Crew tabs, the Capacity band) and 131 (D-1, the Mission Control chat reaches its model: sync on change, both HTTP dialects, the error card, Settings → Chat), 132 (E10-6, you as a crew member: manual steps that park the ticket and notify), 133 (E12-6, the Markdown surface lib and Mission Control's View / Live / Source) and 135 (D-2, the paired-devices list with total and last connected, and pairing from Mission Control), 136 (E12-7, the Anthrazit design decisions: pastels, radius scale, type floor, text size scale) and 137 (the text size steps S / M / L / XL) and 140 (D-3, engine writes refresh Drey's vault views), 138 (E13-5, Assistant conversation targets), 139 (E13-7, the Review tab), 141 (E13-13 first cut, the Work view), 143 (D-5, the Mission Control frame stays put on iOS) and 144 (E13-9, Shape in Drey: Paul edits the open ticket through Mission Control, the Refine button removed) are built and suite-green and await the owner's round** (E13 is the desktop integration of Mission Control, below). The owner's verification round for 1–81 closed
2026-10-17: every "not yet
manually verified" marker below those entries is cleared, the bug-11
fix included. Milestone
ids are assigned when work starts — check `changelog.md` for the
highest used (latest: milestone 109 = the Scout track (E8, concept §5.6);
milestone 108 = the status log + fleet ledger
surface (E7); milestone 107 = the self-improvement loop (E6);
milestone 106 = the ticket screen + proof card + Drey hosting (E5c); milestone 105 = the Mission Control app (E5b); milestone 104 = the Mission Control chat engine (E5a); milestone 103 = verify/proof (E4); milestone 102 = personas (E3); milestone 101 = the standalone tickets engine (E2b); milestone 100 = gateway + fleet client in the engine (E2b-1); milestone 99 = the host-agnostic service layer (E2a); milestone 98 = one transition machine + the two data forms; milestone 97 = the tickets-engine package cut; milestone 96 = fleet stability, the rest (limits, prompt versions, edit counts, Tell/Nudge, soft pause); milestone 95 = fleet stability part 4 (the run view); milestone 94 = fleet stability part 2; milestone 93 = fleet stability part 1b; milestone 92 = fleet stability part 1; milestone 91 = ticket T-0084; latest requirement id: req-94
(req-94 = CI green again: the e2e suite rewritten for req-84/W4a and typechecked via tsconfig.e2e.json, the Ready-card fold CSS bug fixed; req-93 = JIT planning: the plan columns leave the default pipeline, the build step derives file-level detail itself; req-92 = BLOCKED keeps an incomplete step put; req-86 = the step card follows the pipeline, column editor, Settings tidied; req-81–85 see the changelog; req-80 = fleet token economy; req-75–78 added 2026-10-31: the Work panel, STRIDE, TARA, the red-gate
back-move; req-79 = the fleet brief's short instructions file; req-74 = due-date reminders, T-0012; req-73 is readable board
issues, renumbered from req-66 — the tickets remote holds req-66)),
the update check's positive answer is inline text — req-43 and req-44
were owner requests outside the list, shipped and owner-verified in
the same step).
Items A1–A5 of the architectural cleanup shipped on 2026-10-13, and
A10–A12 on 2026-10-17 (changelog); A6–A9 remain.

### Known defects


- **D-53 — The Assistant composer's prompts icon vanishes** (S; (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07)). The icon shows only while the pointer is on its row; it must stay visible (board 9a's icon row is static).
- **D-54 — Settings: the navigation marker follows a programmatic scroll step by step** (S; (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07)). Selecting a sub-item scrolls the page smoothly (fine), but the scroll-spy moves the marker through every section on the way. Done when the marker jumps once to the selected item and the spy is suspended during a programmatic scroll, active again for the user's own scrolling.
- **D-55 — Mobile: the formatting bar is covered by the keyboard** (M; (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07); board 10p). The bar must show only while editing and sit directly above the keyboard (visual viewport / `env(keyboard-inset-height)`); today the keyboard overlays it.
- **D-56 — The owner's configured Flow and Crew settings are missing in his installation** (M; (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07); **needs the owner's detail: which page is empty, what was configured before the cut-over**). Facts: the store's `_meta/personas` holds only `build-default`, `commit-default` and `you`; the default crew (E12-9d) is shipped and seeded since milestone 235 (req-256) — a board without it gets it at the engine's next start, so that half is closed; milestone 230 moves the crew keys of `config.json` / `chain.json` into `crew.md` once and the pools live in `service.json`'s slots (req-177), which seeding does not touch; the chain config in `~/.drey-engine/fleet/chain.json` still points at `ticketsVaultPath E:\projects\drey-tickets` with three pools. Done when Settings → Tickets → Flow and Crew show what the owner configured, and a cut-over migrates those settings or says what it cannot carry.
- **D-64 — A plugin panel's header status goes stale after a plugin-only state change** (S; owner request, outside the list; found by milestone 211, req-162). The dock re-reads every plugin widget's `status()` on the status tick, and the tick is bumped only by document events and vault change rounds (`WidgetRegistryService.bumpStatusTick`), not by a plugin's own backend events or state changes. The Source control header kept "3" after a Refresh had emptied the lists (a status round the plugin applied without a document or vault event). Fix in the base: bump the tick on `plugin:event` deliveries, or give the SDK a `api.ui.refreshStatus()` the plugin calls after it changed what `status()` reads. *(id provisional — to be confirmed by the integrator.)* Integration note (2026-11-08): milestone 210 shipped `ui.refreshStatus()` (SDK 1.54) for exactly this — the git plugin calls it after a plugin-only state change; what remains here is that call, not a base change.
- **D-57 — The Mission Control composer draws a rectangular focus frame in the accent colour, does not grow, and Enter does not send** (S; (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07); boards 10a/10e). The frame goes (the boards draw a rounded field without it); the field grows with the text while typing (up to a cap, then scrolls); **Enter sends**, Shift+Enter breaks the line — the same on the desktop Assistant composer.







(D-50, `tickets-dricket-sweep` red since 203, shipped with 205's spec fix (the row opens the ticket, the thread is reached through the card's button) and green on the integrated tip; D-45, the Review tab empty on store tickets, shipped as 196; D-23 shipped as milestones 184 and 185, D-24 as 184, D-35 as 188, D-36 as 189, D-37 as 190, D-43 as 193.; what the wave-3 smoke could not see — the Autopilot status item and popover in a built app with a runner — waits for the owner's round, noted in the 184 changelog entry.)


D-7 (b) was reproduced on the scratch build: Mission Control → ticket → Change by chat opens the chat field
pre-filled with "T-0002:". (a), (c), (d) need a model / a real phone — untested.

_Shipped defects:_ D-52, the Crew 1:1 that no model answered, as milestone 228 (req-168); D-25, D-27, D-28, D-33, D-40 and D-49, the desktop and client store defects, as milestone 205; D-11 to D-22, the sweep on a dricket store, shipped as milestone 181; D-1, Mission Control chat reaching no model, shipped as
milestone 131; D-2, the paired-devices list and pairing from Mission
Control, as milestone 135; D-3, engine writes not refreshing Drey's vault
views, as milestone 140; D-4, runs.spec flaking under full-suite load, as milestone 142; D-5, the page moving on iPhone/iPad scroll
(owner report 2026-11-04), as milestone 143; D-6, selecting a ticket switching the view and views saving themselves, as milestone 163; D-8, the flaky gate specs, as milestone 168; D-7, the phone chat about a ticket (unknown ticket, id prefix, view switching back, iOS keyboard) and D-5b (the phone wobble), as milestone 165; D-9, the Tickets panel footer on a dricket board, as milestone 171; D-11 to D-22, the sweep's store defects, as milestone 181; D-23 (the store's ticket header) and D-24 (the Autopilot stylesheet in the build), as milestone 184 — see the changelog.)

### Now (small, daily value)

_The persona board (req-257's concept, approved by the owner 2026-11-11, [persona-board-concept.md](../docs/design/work-panel/persona-board-concept.md)), in build order (req-264, the boards, shipped as milestone 237): req-265 first; then req-266 and req-258 in parallel; req-267 after req-258; req-257 after req-266, req-258 and req-267; req-268 after req-257; req-269 after req-258, beside req-267/req-257; req-270, then req-271 … req-273; req-274; req-275 lands with req-265 … req-257._

- **req-265 — Lifecycle stages on the store** (owner request 2026-11-10/11, the approved persona board concept). `inbox prioritized active running done` with `claim = ["running"]` in `dricket.toml`; the reader maps stages to lifecycle columns and holders; the run lease releases into `active` in one commit (no R-31 workaround); migration steps 1–2. ADR-0090 later change. Concept row 2.
- **req-266 — The chain as a persona list** (owner request 2026-11-10/11, the approved persona board concept). `x-chain` the full ordered persona list, `x-at` the position, `x-sent-back`; `flow:` in `pipeline.md`; the standard flow written into a ticket at creation; `validateChain` over personas; the flow editor writes lists; parts' chains; `### Chain` in the plan. Concept row 3.
- **req-258 — Persona settings, the run's instruction and the crew order** (owner request 2026-11-10/11, the approved persona board concept). re-scoped by the approved concept (was "a persona's prompt displaces the step prompt" — that is now the intended behaviour): `min-class`, `needs`, run ceilings, `gate`, `parallel`, `min` (default 0), `leaving` and `readonly` on `persona.md`; the runner's mode wrappers (interactive shape, closing round, review read-only); `order:` in `crew.md` with drag. Concept row 4.
- **req-267 — Persona leaving actions: `sync-main` and commit** (owner request 2026-11-10/11, the approved persona board concept). machine runs inside the claim when a ticket leaves a persona: the builder's `sync-main` (after Ben, before the review — owner 2026-11-11; a conflict stays with Ben), You's commit after the sign-off at the chain's last entry; the status on the card; the engine's `done` after the commit. Concept row 5.
- **req-257 — The runner on persona chains** (owner request 2026-11-10/11, the approved persona board concept). re-scoped by the approved concept: dispatch by the holder (the chain's entry at `x-at`); no persona → the ticket stands at You with the reason; one release per run end; a send-back to a named earlier position invalidates it and every later entry, one send-back per ticket, the second goes to You; a question in a run moves the card to You and back; the per-persona pool inside the big pool and the per-persona breaker; dispatch order by position; retire `default-persona`, the ring run for ticket entries, `x-persona` and `migrateLegacyPersonas`. No role fallback (`decisions.md`). Concept row 6.
- **req-268 — Live board migration** (owner request 2026-11-10/11, the approved persona board concept). migration steps 3–5 on the owner's board: `pipeline.md` (lifecycle phases and `flow:`), `crew.md` order and persona settings, deleting `build-default` and `commit-default` (the owner confirms each, req-261's route). Concept row 7.
- **req-269 — Pia's persona and Mission Control's prompt** (owner request 2026-11-10/11, the approved persona board concept). `personas/pia/`, her `prompt.md` (how the owner wants to work with her) composed into Mission Control's system prompt; the seeder ships her; the delete refusal while Mission Control uses her; Pia as a chain entry (a Mission Control turn, no session). Concept row 8.
- **req-270 — Board DTO and moves** (owner request 2026-11-10/11, the approved persona board concept). holder, position n of m, the chain initials and the wait reason on the card; start, drag between holders and of column headers, Accept / Send back with a target, park. Concept row 9.
- **req-271 — Desktop Board and Tickets panel on persona columns, the Capacity band merged into the board** (owner request 2026-11-10/11, the approved persona board concept). per the accepted boards of req-264, with drag and the `+ n personas` fold chip; the per-persona load in the column headers (`Ben · 2/2 · 1 waiting`) and the big pool as a chip in the board's header (`4/5 · 1 queued`) whose popover holds slots, tranche, queue head and a minimum overrun — the bottom-dock Capacity band and its Work-view arrangement go (owner 2026-11-11). Concept row 10.
- **req-272 — Shape and Flow chat as the assigned persona** (owner request 2026-11-10/11, the approved persona board concept). the prompts composed from the holder's `prompt.md` and the mode wrapper instead of the hard-coded "You are Paul"; the roster from the crew. Concept row 11.
- **req-273 — Mission Control desk, iPad and phone on persona columns** (owner request 2026-11-10/11, the approved persona board concept). groups by holder with the holder's load in the group header (`Ben · 2/2 · 1 waiting`), Accept / Send back with a target, the new cards, the flow editor's persona lists, the team's order; per the accepted boards. Concept row 12.
- **req-274 — Metrics per persona and position** (owner request 2026-11-10/11, the approved persona board concept). `hold` ledger lines, the position in the telemetry, the report grouped by persona, Cost by persona. Concept row 13.
- **req-275 — ADR and specs of the persona board** (owner request 2026-11-10/11, the approved persona board concept). an ADR "the persona board" (later changes of ADR-0088's persona ladder, ADR-0077's chain, ADR-0090's stages), `specs/ticket-schema.md`, `specs/frontmatter-schema.md` where it names stages, the manual — landing with req-265 … req-257, not after. Concept row 14.


_The Crew internals, designed 2026-11-07/08 — build in this order:_

- **req-184 — Persona page v2 as a canvas board** (follow-up of req-171; 7k v2). `crew-internals/persona-page-mockup.html` becomes board 7k v2 on the canvas, plus the concept's one row: the persona's sub-agent policy `off | read-only` per phase; req-171 was built against the mockup (milestone 231); the board is still to be drawn from it.
- **req-185 — Worker sandbox and trust boundary (Spike 1)** (concept 2026-11-08: security before routing and Lead). What a worker may reach beyond its worktree (file system, network), per harness; the finding becomes an ADR-0075 later change or a new ADR; until then the worktree plus the permission mode is the boundary and the concept says so.

_Order of the block after the review of 2026-11-08: req-176 shipped as milestone 214; now two tracks — engine on Opus (req-177 shipped as milestone 215, req-170 as milestone 217, req-178 as milestone 219, req-179 as milestone 221, req-180 as milestone 223, req-181 as milestone 224, req-183 as milestone 225, req-182 as milestone 226 (re-scoped by the owner 2026-11-09: ACP for every harness except Claude Code), req-167 as milestone 227, req-168 as milestone 228 (D-52 resolved), req-169 as milestone 229, req-173 as milestone 230 (the session record, free sessions, the three configuration layers), req-171 as milestone 231 (the Persona page v2: the Markdown editor in Instructions, Allowed to, models from the table, Skills with switches, Proposals, the one line for the crew list, one prose in prompt.md), req-172 as milestone 232 (skills as Agent Skills: the folder format, the loader, the routes, the prompt preview and its token count), req-237, req-238 and req-239 as milestone 233 (the Persona page over those routes: the Skills block with off rows, removal and Add skill…, Preview full prompt with `≈ N tokens at start`, the commit age beside Saved, the models' busy count)) and boards on Sonnet (7l over req-170's `GET /models` and the `poolModels` IPC; 8c shipped as milestone 216; 7e's Slots row and queue part shipped as milestone 218, its tranche part, 10t and 10u parts 1, 6 and 7 with req-179 as milestone 221; 8a/8b shipped as milestone 222 with req-165/166; the rest of 10u — merge conflict, budget stop, quota stop, queued — with the rows that raise those cards). req-184 and 185 when the owner picks them. The owner's "Stufe 0" (two weeks of concept statements with ids, by hand) is his own process beside this and gates nothing here._


**Tickets-Engine extraction + Mission Control** (owner request, outside
the list, 2026-11-01; migration plan accepted by the owner,
[ADR-0088](../docs/09_architecture_decisions/0088-tickets-engine-package-cut.md)).
The strangler restructure of the tickets system per the architecture
concept: `packages/tickets-engine` (domain, fleet, contracts — E0/milestone 97)
grew through E1 (one transition machine, status log + fleet ledger —
milestone 98), E2a (the host-agnostic service layer — milestone 99),
E2b (the standalone engine process: invoke channel + SSE, lockfile
adoption, the plugin as its client — milestones 100+101; phone without
Drey) and E3 (personas — milestone 102) and E4 (verify/proof —
milestone 103) and E5a (the Mission Control chat engine — milestone 104:
chat sessions + proposal cards, the confirm-executes-through-the-board
rule, the OpenAI-compatible bridge, invoke methods + SSE + gateway
routes; built and suite-green but awaiting the owner's round) and E5b
(the Mission Control app — milestone 105: `apps/mission-control`, the
Angular phone-first PWA with the Work/Chat/Team shell the engine serves;
built and suite-green but awaiting the owner's round, so the legacy
remote stays the fallback) and E5c (the ticket screen + proof card +
Drey hosting — milestone 106: the read-only-first ticket screen with the
gate bar, the proof card's swipable gallery and fullscreen shot viewer,
the capped per-file-zoomable diff, the warned raw-edit save, the
accept/send-back routes with the mandatory note, the name-pinned
bearer attachment route, and `RemoteService.localClient` with the
sandboxed BrowserView host that shows the same app in a Drey window;
built and suite-green but awaiting the owner's round) and E6 (the
self-improvement loop — milestone 107: the workers' friction becomes
the personas' improvement drafts, the owner accepts or dismisses each
in the persona 1:1, one armed decision at a time; built and
suite-green but awaiting the owner's round) and E7 (the status log +
fleet ledger — milestone 108: concept §3.3, the per-ticket
`<id>.status.log` with its verb grammar and keyed open decisions, the
`_meta/ledger.jsonl` fleet events behind optional writer seams, the
two new Needs-you kinds; built and suite-green but awaiting the
owner's round) and E8 (the Scout track, concept §5.6 — milestone
109: the scout form `form: scout` for exploration-only tickets, the
`## Report` chapter + decision list a scout run writes into its own
ticket file — no worktree, no gate, no move —, the report card in
Needs you and the chat's `promote` command with confirmation
flipping the ticket to ship; built and suite-green but awaiting the
owner's round) and E9 (the chain delta, concept §5.7 — the last
concept item: the ticket's `chain:` delta against the pipeline's
standard flow, the insert/skip/notify grammar with its semantic
write-guard, the merge that feeds the gate bar and the Bescheid
"Needs you" cards, and the chat's `setChain` command with
confirmation; built and suite-green but awaiting the owner's
round). **Milestone 111 completes the board itself**: configurable
priorities — pipeline.md's top-level `priorities:` names the vault's
own vocabulary (weight order, its middle entry the default, its first
half the dispatch's jump class), and every priority path — board
order, dispatch classes, chat digest + envelope validation, header
edits, `createTicket` — reads it instead of a hard-coded list — plus
the blocked-by chat/edit path: the chat's `setBlockedBy` command and
the engine's whole-list replacement (an empty list clears the
blockers), the last board field without a conversational/edit way to
write it. Built and suite-green but awaiting the owner's round.
**E9 completes the concept** — all of E0–E9 stands
built, none of it owner-verified; next is the owner's verification
round (§4.9's watcher depth now rides on
the status log in place). Drey keeps its
native Work panel/thread/editor throughout. Supersedes req-75 W6–W8 (E3/E5 replace the Shape
dialog, the rules-file orchestrator and the phone-client rebuild); W9 stays.
**Mission Control redesign — concept v2 (E10, E11, E12)** (owner request,
outside the list, 2026-11-03; owner decisions D5–D12 closed; the design
canvas "Drey Tickets — Workflow redesign" is binding for the UI;
[ADR-0088](../docs/09_architecture_decisions/0088-tickets-engine-package-cut.md)
"Later changes" records the decisions). Worked in this order, one
milestone at a time, a pause after each; milestone numbers are taken
when an item ships (next free: 137; 133 = Markdown surface, 134 = the convergence audit, 135 = devices, 136 = design decisions; 112 = specs + the English pass, 113 = navigation, 114 = settings, 115 = crew states, 116 = proof mode + videos, 117 = diff review, 118 = line comments, 119 = cost table + estimate, 120 = parts schema, 121 = plan delta, 122 = shape mode; E12-1 – E12-4, E11, E10-1 – E10-6 shipped). Nothing here creates tickets — the
owner builds without the tickets system.

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
  strip over the plan; Paul on his own persona model instead of the chat
  model.
- **E10-5b — Flow editor follow-ups.** The switch that lets Paul propose
  a flow for **every new plan** (concept §5.7 point 3: he starts at the
  standard flow; today only the "Ask Paul" draft exists), a per-gate model
  pick (the model is the persona's today and shown, not set), the default
  flow under Settings → Tickets (E13-12 / E12-3), and the fleet executing
  `move` / `assign` (the dispatcher reads the delta nowhere yet — it is
  data and renders on the gate bar, the cards and the editor).

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

Order and dependencies (an item needs everything it names):

13. **E13-13 — The Work view (rest).** The first cut is built (milestone
    141: the preset, the Tickets panel / ticket / Assistant / Capacity
    arrangement, home views, Ctrl+2). What is left: ~~the Capacity band only
    while the Board or Crew tab is active~~ — superseded 2026-11-11: the band
    goes with req-271 (merged into the persona board); the centre opening on the
    Board when the view is first shown empty; **Mission Control as the
    Assistant's default target** (the `assistantTarget` field of the preset
    stays unset until E13-5 exists, then the preset names it); and the tabs it
    arranges once they exist (Review 7, Shape 9, Parts 10, Flow 11).

Parallel lanes: 1, 3 and 4 are disjoint and can run together; 5 and 8 can
start when their needs are met without waiting for 1. Relation to the
E10–E12 line: 10 and 11 waited for E10-4 and E10-5 (both built); E12-5 (device rules
audit) is independent of E13.
Persona names follow D7 (Pia = Mission Control, Paul plans).

**Follow-ups of E13-11 / E13-12 (milestones 145–146):**

- **E13-12b — Budget pause and runners dialog.** "Pause when the budget is
  spent" (running work finishes first) and a runners dialog behind *Manage*
  (board 7g) need a desk setting first (E12-3b); today *Daily budget* only
  adds up the personas' budgets and *Manage* scrolls to the Workers section.
  The "default flow for new plans" (E10-5b) would also get its row here.
- **E13-11b — Flow tab, what is left.** The tab opens from the ticket
  strip and Settings; the plan block's "Change flow ›" link arrives with the
  Parts block (milestone 196, the tab can open `flow://<id>/<part>` already). The word
  helpers (`changesLabelOf`, `marksOf`, `moveRoomOf`, `addablePhasesOf`) exist
  twice, in `libs/mission-ui` and in the plugin; one pure module in the
  engine package that both import would remove the copy.

**Follow-ups of E13-5 (milestone 138):**

- **E13-5b — Assistant targets, what is left.** Streaming of Mission
  Control's words into the thread (the engine already streams `chat` events
  on its `/api/events` channel; the plugin's `EngineClient.onEvent` drops
  them, so a turn shows "Working …" until it is whole); the step cards
  ("T-0121 · step 1 · tests green · 7 actions ›", board 7a) once runs report
  steps to a chat thread; a 1:1 that
  answers (the persona thread holds only the owner's messages today, E12-4);
  the Claude Code CLI provider as the *Model* target with its tools switched
  off (`claude -p --tools ""` — the empty argument through `shell: true` on
  Windows is not verified); the Work view preset must name
  `assistantTarget: 'tickets.mission-control'` (E13-13); dictation reaching a
  speech service inside Electron (the Web Speech API needs a network service
  the packaged app may not reach — only seen as "button shown", not as words
  heard).

**Follow-ups of E13-9 (milestone 144):**

- **E13-9b — Shape in Drey, what is left.** The open tab follows the ticket
  when "Keep as one" moves its file (today the tab keeps the old path until
  reopened); Paul's edit as one Ctrl+Z step (needs the engine to return the
  plan instead of writing it, or the plugin to push the reloaded text as a
  buffer transaction); tinted lines for the marks inside the plan (E10-3b) and
  the line-level edit sheet; the Work view preset naming
  `assistantTarget: 'tickets.mission-control'` (E13-13) so the Assistant is on
  Mission Control without the owner picking it.

**Proposed by the convergence audit (2026-11-04, milestone 134)** — evidence
and severity per item in
[`convergence-gaps.md`](../docs/design/work-panel/convergence-gaps.md); the
owner confirms scope and order before any of it starts:

- **E13-17 — Board filter and cost toggle.** "Filter: all personas" and
  "Cost by column" on the Board tab (board 7e) (G-15).
- **E13-19 — Crew tab completion.** New persona from a template, Remove from
  crew, Notify / Runs after / This week / Typical run fields,
  "Talk to <name> 1:1 in the Assistant" (with E13-5), the per-persona slot
  share (needs an engine count) (G-14). Editing a persona shipped as the
  Persona page (board 7k, milestone 201), rebuilt to the R11 mockup as milestone 231 (req-171): the page items that
  were listed here left with it — removing and reordering the models, the
  daily budget, the harness — and the rest became their own rows: the
  portrait (req-235) and `Tell me when` (req-236); the file's commit age beside
  `Saved` shipped as milestone 233 (req-239). The steps stay read-only chips of the flows (R11; the
  flow editor owns the toggles, `specs/decisions.md`), and a provider per
  model is the entry's `<provider>/<model>` form of the pool.
- **E12-9e — Follow-ups of the default pipeline (E12-9c, milestone 166)** (S–M). Open: (1) **Plan →
  Build has no checkpoint** in the default (both agent columns): decide whether a finished plan
  should park for the owner (a `persona: you` pin / an inserted `manual` gate in the default
  chain) — today the owner inserts one per ticket; (2) **Sign Off is manual**, so the merge and
  push of `commit-default` is by hand or by a session working the checkpoint (BOARD.md) — decide
  whether Sign Off should offer "Merge and push" as an owner-started agent run; (3) a **reverse
  converter that reads the store's own stage list** (today `--stages a,b,c`, default the new
  six); (4) the Work panel's *Prioritized* group is empty on a new board (its queue is Inbox only
  while Plan is an agent column) — keep, rename or retire it; (5) **Open question: migration of `prioritized` tickets** — `inbox` (today) or `plan` (an agent
  column: planning would start on arrival); (6) E12-9b Q2 (crew seeding) and Q3
  (default worker) are still open.
- **E12-16 — Board and Crew completion** (proposed by the E12-10 audit; M, partly
  L). `Filter: all personas` and `Cost by column` (E13-17); empty columns say
  `Empty` quietly, `New idea` moves to the board header; `New persona`, `Remove
  from crew`, the Friction tab, the Setup fields and `Talk to …
  1:1` (E13-19) [H-01–H-03, I-02]. Files: `plugins/tickets/renderer/board/`,
  `team/team-view.ts`.
- **E12-19 — Assistant labels, review layout, settings leftovers** (proposed by
  the E12-10 audit; S). (The Assistant's top row and its way of input stay as the owner adjusted them on 2026-11-05 — `docs/design/work-panel/assistant-owner-layout-2026-11-05.png`: icon-only target switch, composer with its field text, mic, send, icon row and model name; audit row M-01 is withdrawn. Only how the chat itself looks may follow the design.) `Pause when the budget is spent` (needs
  E12-3b's setting first); the Default flow row without the ticket dropdown;
  the Settings list no longer clips `Panels & plugins`; the disabled `Split`
  button says why; flow wording `Move earlier / Add a gate after this one /
  Remove this gate` [M-01, R-01, R-02, K-01, K-02, E-03, J-01].
- **E12-20 — Audit fixtures and the canvas export** (proposed by the E12-10
  audit; S). Export boards 4a–7j next to the stale repo copies (or delete the
  copies), and add the fixtures the audit could not seed: an MC ticket with a
  waiting question, one with proof and a diff, an MC plan to accept, an MC shape
  session, the Views menu, a dricket-store Work panel — then run the audit's
  remaining rows [Z-02, A-08, B-02, R-04, F-02]. Docs and e2e fixtures only.

- **E12-7 — Token alignment** (owner decision 2026-11-04: the Anthrazit design
  system wins). Milestone 136 on branch `design-to-code` owns it: peach / pink /
  mint tokens in the three themes, badges re-pointed, radii 4/8/16, a 13 px
  floor on mobile, Settings text size (decided as S / L / XL / XXL / XXXL, superseded 2026-11-06 by five steps S / M / L / XL / XXL = 15 / 16 / 17 / 19 / 21 px, L = 17 px
  default; the fifth step, XXL = 21 px, is bundled into the Appearance / theme work of wave 3, build-plan item 3.7, Q9), the capture label Ctrl+Alt+T (binding `Mod+Alt+T`) (G-13, G-23–G-26).
  This entry only states the decision; the work is not duplicated here.
- **E2b-4 — The engine announces its writes to Drey.** Changed paths ride the
  `board` event and the plugin calls `ctx.vault.announceChanges`, so the
  Files tree, indexes and open ticket tabs stay fresh with the watcher off
  (G-08).
- **X-1 — Documentation and code hygiene.** The schema's noise promise
  versus the parser (G-20), delete `plugins/tickets/main/engine-host.ts` and
  reword the engine's package description (G-21), German code comments (G-22),
  undocumented commit subjects (G-33), the unaudited legacy parts of docs/05
  and docs/06 (G-34), a stray `apps/mission-control/node_modules` (G-35).


The assistant tool rework (owner request, outside the list, 2026-10-13)
shipped as milestones 76–79, the removal of the embedding retrieval
(owner request, outside the list, 2026-10-14) as milestone 80,
configurable shortcuts as milestone 75 (ADR-0073) and zen mode (the
former "Next" item 6) as milestone 81 — see the changelog. All of it is
owner-verified (verification round closed 2026-10-17), the bug-11 fix
included.

**Fleet stability, what is left** (owner request, outside the list,
2026-10-31; parts 1, 1b, 2, 4 and the rest of 1c/2b/4b shipped as
milestones 92–96). **(M3)** — postponed by the owner, last in line: the
column as a `phase:` frontmatter field — one atomic write instead of
rename + write, a revision check between runner and Drey, CRLF
tolerance (alternative if the migration is too big: journal the move and
add the live-run check to `moveCard`). Smaller leftovers: the runner
writing the handover section from the worker's answer (today the worker
edits the ticket file, the runner commits it); a runner-side check that
the plan's acceptance commands can pass (the plan prompt asks the
worker to; a generic check cannot tell a command for a file the build
still creates from a broken one); **the fork base of a fresh ticket
branch** (req-93 follow-up): `baseRef` is the repos.md `branch:` as a
*local* ref of the owner's checkout, which can lag the remote the
commit step pushes to (T-0062 forked 8 commits behind) — fork from the
freshest ref instead (fetch before `worktree add -b`, never touching
the owner's checkout); "Hand to Claude Code" on a worker
card (no defined meaning yet).

**req-75 — The Work panel replaces the kanban board** (owner request,
outside the list, 2026-10-31; [ADR-0087](../docs/09_architecture_decisions/0087-work-panel-replaces-the-kanban-board.md),
accepted with W1). The board goes; the owner sees **Ideas** and what is **in
progress**, plus **Needs you** for decisions; an accepted ticket goes to
the archive. Two tracks chosen at triage (**Auto** for bugs and small
changes, **Shape** for a plan-mode dialog), one page per ticket with the
live worker, questions that carry their context, an orchestrator that
routes phase tickets, and the phone as a chat client. Design reference:
the owner's canvas "Drey Tickets — Workflow redesign" (11 screens).
Usability findings that motivate it: ADR-0087 "Context". Stages, each
shipped and confirmed on its own, in this order (W1 shipped as
milestone 89, W2 as milestone 90, W4 as req-75 W4a + W4b — changelog;
W1b, W2b and W3 shipped as owner-requested additions, see the
changelog).

- **W5 — Capture by hotkey and voice.** A second global chord "New
  ticket" (ADR-0073) raises Drey and opens the New ticket dialog in the
  main window (no separate capture window — the quick-capture call,
  ADR-0002); the dialog starts Windows
  dictation (Win+H) — no own speech recognition (req-11 stays excluded;
  local Whisper may be reopened later). One model call tidies the
  dictated text into title and description (raw text kept in the Log)
  and suggests the track. W5a shipped: the system-wide New ticket chord.
  W5b shipped: Windows dictation in the New ticket dialog.
  W5c shipped: the tidy-up; W5 is complete.
- **W6 — Shape track (recut, 2026-11-03: carried by E10-2 – E10-4).** The plan-mode dialog with the project context
  assembled automatically and shown as chips (CLAUDE.md, specs, ADRs,
  related tickets — over the existing context pack); read-only on the
  work repo; the plan grows beside the dialog in the ticket file;
  "split into phase tickets". **Both edit the plan** (owner request
  2026-10-31): the owner changes text or the Mermaid architecture
  diagram in the editor (Mermaid only to start), and the next message
  carries **only the owner's edits** since the model's last turn —
  never the model's own (a shadow text that receives the model's edits
  but not the owner's; delta = shadow → file) — as diff + per-block
  summary, shown in the thread and as a removable composer chip, for
  discussion; gutter marks show who changed which block (ADR-0087
  decision 8).
- **W7 — Orchestrator (dropped, owner decision D5, 2026-11-03: no overlap guard, no
  touches, no routing; the chain delta of E9 replaced the gates).** Phase tickets with gates between phases;
  routing by a rules file in the tickets repository (first match wins:
  worker, model, review); `touches:` paths per ticket and an overlap
  guard that holds a ticket while a running one touches the same
  paths; rebase on the integration branch and re-test before Ready.
- **W8 — The phone as a chat client (dropped, D5: Mission Control, E5b, is that
  client).** The req-66 client rebuilt: each
  ticket a conversation, one composer for capture, answers and
  shaping, compact chips for options, the Needs-you list as home.
  Push notifications stay R7's own decision.
- **W9 — Audit runs (own decision before it starts).** Read-only
  architecture and security reviews (incl. a check against pinned OWASP
  cheat sheets) that write a report into the work repo's `docs/` with
  stable finding ids and propose tickets into Ideas. STRIDE and TARA
  are separate items (req-76, req-77).

Ideas order (owner, 2026-10-31): by the existing `priority:` field
(urgent / high / normal / low), newest first within a priority — no
exact hand order; the `order.md` pins go with the board (the file is
left in place and ignored, the validator stops reading it). Priority
is set from a chip on the row and in the capture window.

**Fresh worktrees check out CRLF; the tickets prompt specs require raw
LF.** The repo-local git config has `core.autocrlf=true`, so a fresh
worktree writes every text file with CRLF — while the main checkout
carries LF on disk (written directly, never re-checked-out). The spec
`plugins/tickets/main/default-prompts.spec.ts` reads the shipped prompt
files *raw* and asserts byte-exact LF, so it fails in every fresh
worktree (first seen in the req-52 gate run, 2026-10-19). A
`.gitattributes` marking the tracked text as LF would make checkouts
deterministic; owner decision (it touches every file type).

**Ticket system + agent fleet** (owner request, outside the list,
2026-10-17; ADR-0075 + ADR-0076, format spec in
[`specs/ticket-schema.md`](ticket-schema.md)). A kanban-style pipeline
over Markdown ticket files in a **dedicated tickets repository**
(registered as an ordinary vault), with external agent CLI sessions
doing gated work in the work repos' `t/<id>` branches and Drey as the
cockpit. The foundation shipped as milestone 83, the runner with
run control as milestone 84, and continuous orchestration as
milestone 85 (ticket T-0007, ADR-0077 — the board now runs itself
wherever a column has a worker; see the changelog; the owner's live
rounds on real runs are still pending there).

**Runner retirement of stamp-less daemons + board setup defaults**
(owner request, outside the list, 2026-10-18, milestone 87). A fleet
daemon that reports no build stamp predates the stamp and was never
retired, so an old build kept serving (it still pulled from
`prioritized`). Treat it as stale. And "Initialize board" seeds the
plan and build columns as agent handovers plus the three prompts
(`plan-default`, `build-default`, `review-default`) in
`tickets/_meta/prompts/`.

**Takeover follow-ups.** The Claude Code interrupt (stream-json `control_request`)
is not yet verified against the installed CLI. Also open: a token budget per run
(stop a worker that reads without writing), and a tickets-repo-side credit
figure for flat plans (GLM coding plan reports cost 0).

**req-66 — Tickets remote: the board from a phone or tablet**
(owner request, outside the list, 2026-10-30; ADR-0086). Move, run,
take over, answer and refine tickets from an iPhone or iPad on the
couch — the tickets plugin only, not Drey on the device (that stays
excluded as req-10). An HTTP gateway in the tickets plugin's main side
behind a host-neutral `TicketsRemotePort`, so a later standalone or
VS Code host serves the same client. Loopback by default, reached
through Tailscale Serve (HTTPS); a LAN mode is opt-in with a warning.
Off by default; QR pairing, per-device tokens (hashes only), revoke,
Host/Origin check, bypass runs refused remotely. Owner decisions D1–D5
of 2026-10-30 confirmed. R1 (command layer + port), R2 (gateway,
pairing, Settings), R3 (the phone client), R4 (runs on the phone), R5
(refine), R6 (the iPad board), R8 (images from the phone, the run
view's pinned header) and R9 (markdown on the phone) shipped — see the changelog; only the optional
R7 remains. The client's display flicker (a double paint at
startup/wake and one per live-run tick) was fixed as T-0053 — the
paint is keyed on the built view (see the changelog). Follow-up of R5: an SDK seam
over `OpenDocsBridge` so a plugin's main side (the remote's refine)
edits a ticket open in a Drey tab through that tab instead of relying
on the ADR-0060 save-conflict merge. Follow-up of R8: an authed image
route (query token or cookie) so the phone can *display* the uploaded
attachments — an `<img>` cannot send the bearer token; rides the
phone's markdown rendering. Remaining steps, each shipped on its own:

- **R7 (optional, its own decision)** — Web Push: needs HTTPS and
  Apple's push service, a further cloud exception.

### Tickets on dricket (owner request 2026-11-04; built, the board on the store since 2026-11-06)

**Built through E14-8 and the cut-over (E14-7 steps 1-8, 2026-11-06): the owner's board runs on the store `E:\projects\drey-board`, `drey-tickets` is the meta vault. Open below: the owner's round (E14-7 step 9), the decommission (E14-9b) and the follow-ups. Nothing here reorders the lists above or below.**
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
  156). Open: the ticket header strip, the thread pairing and the Shape marks
  for a checkout document (they key on the vault card path, so a dricket ticket
  opens as a plain document today); the checkout vault is not marked managed
  in Source control (one `markManaged` claim per plugin, taken by the tickets
  vault); `saveAsset` into the checkout's `tickets/` tree is not guarded; the 5 s
  ref check and the real-run check of the watcher, the write moves and the editor
  save shipped with milestone 161 (E14-8: a 10 s ref check as a safety net, the run in
  a built app on a scratch store, the checkout vault flagged managed).
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
  159; no dk feature was missing: Drey reads the `comments/` files itself, so R-08
  is not needed). Open: (1) ~~the chain orchestrator's status events~~ (milestone 160: on a store a run's end is the run's own release
  comment, the chain's parks are `paused:` comments, `working:` is not persisted);
  (2) an **answer reaches the next run only through the thread**: the answer is a
  `resolved: <key>` comment, but nothing yet hands it to the persona's next
  instruction (a run that waits for the owner now releases and re-claims on the answer, milestone 160, Q-03); (3) **no Needs-you answer control** in Mission Control or Drey —
  the route (`POST /api/tickets/<id>/answer`) and the engine method (`answerNeed`)
  exist, the button does not; (4) the story builder ("How it got here") reads the
  Log only, so a send-back shows from the short Log line, never from the comment;
  (5) a comment is not editable and the thread has no composer (a free comment from
  the board needs one `dk comment` call behind an input); (6) the ledger file sits
  in the meta vault's working tree and rides that repository's next commit
  (`tickets/_meta/ledger.jsonl`, uncommitted by Drey, as before); a meta vault that
  is also the store's checkout would make dk flag it `unexpected-path` — keep them
  two folders; (7) the real check on a second instance (answer from the phone, a
  send-back from the Ready card) — only the engine services ran, on a scratch store.
- **E14-7 — Cut-over (wave 3, the owner present).** **Steps 1 to 8 ran on 2026-11-06, the board runs on the store
  ([`cutover-2026-11-06.md`](../docs/design/dricket/cutover-2026-11-06.md)). Open: step 9, the owner's first round. Owner, 2026-11-07:
  after the UI integration, which may still change what the round would check. Nothing else of this item is left, and
  it moves to the changelog with that round.** One start, prepared by E14-7a (milestone 175) and
  rehearsed on a copy of the real vault
  ([`rehearsal-2026-11-06.md`](../docs/design/dricket/rehearsal-2026-11-06.md), milestone 169). The
  owner's real `drey-tickets` is only touched here. req-99a is merged, so the store is written
  once with the six stages `inbox shaping prioritized building ready done` (decision 27), and step B
  of the guide repeated after that merge: the rehearsal ran on the old names. The exact sequence, with
  what each step should show, is
  [`cutover-guide.md`](../docs/design/dricket/cutover-guide.md), section C:
  1. Freeze: quit Drey, stop the engine (`engine.lock` names the pid), commit `tickets/archive`,
     `git -C E:\projects\drey-tickets tag pre-dricket`.
  2. Fresh allow list: `Get-ChildItem <vault>\tickets -Recurse -File -Filter 'T-*.md' | % { $_.BaseName } | sort | Set-Content <allow>`.
  3. Dry run: `node scripts/migrate-tickets.mjs --legacy <vault> --allow <allow> --include-archive --pipeline-out <file>`
     (`0 skipped`; check the pids of the stale run stamps, T-0030 and T-0050 today).
  4. Import: `--legacy`, `--allow`, `--include-archive` as above, plus `--apply --allow-live-runs --store E:\projects\drey-board --dk <dk> --actor owner@legion --data E:\projects\drey-board-data --report <file>`
     (`dk validate: clean`, `shadow diff: identical`, the comparison of record; the exit code does not cover the diff).
  5. Store check: the six ids in `git -C <store> show main:dricket.toml`, `dk validate`, the `dk ls` count.
  6. Shadow: plugin config `backend: shadow`, `dk.store`, `dk.dataDir`; `.\dev.ps1 -Built` once;
     `<engine home>\shadow\board-diff.md` says `Identical` (only while no live ticket stands in `build` or
     `commit`: it reads one pipeline for both sides); quit, stop the engine.
  7. Flip: the `--pipeline-out` file is committed as `tickets/_meta/pipeline.md`, `backend: dricket`, `.\dev.ps1 -Built` once.
  8. Smoke: same tickets in six columns, move, priority, editor save, comment, short fleet run,
     Accept into Done, an archived ticket opens; each write one `dricket: ...` commit.
  9. The owner's round; then E14-9b.

  **Stages (req-99a):** the engine's file-versus-store shadow reads one pipeline for both sides and cannot match across the rename, so the clean comparison is the migration tool's (`--apply` maps the phases). The reverse's default `--stages` is now the legacy board.

  **Decided:** the archive migrates (`--include-archive`, O-3 replaces OD-7). **Follow-ups, not
  blockers:** the shadow report names the store it compared and a changed store bypasses the 30 s gap
  in `scheduleShadow` (`store/store-board-source.ts`; matters only for an engine left running, the
  guide stops it); the apply's exit code covers the shadow diff, and `--allow` over archive ids without
  `--include-archive` is refused instead of skipping them with exit 0 (`migrate/cli.ts`); a
  `--phase-dirs` flag for the reverse converter (legacy folder numbers); a commit step settles into
  Done without a connected client (one line in `server/engine.ts`, req-99a hand-over).
- **E14-9b — Decommission, part b: Drey on dricket only.** **Released by the owner on
  2026-11-11** ("sicherstellen, dass diese Version nur noch auf dricket läuft, und alle
  Tickets entsprechend anpassen"; "Ja, so" to the plan) — no longer waits for the
  verification round; **starts after req-265 is merged** (both touch `board-service.ts`
  and the store settings). The owner's confirmations: no rollback to the files backend is
  wanted (item 3 below goes), the legacy phone remote goes (item 4). **Added by the
  owner's release:** (6) **a fresh install runs on dricket**: `tickets.backend` defaults
  to `dricket`, and with no store configured the first start creates one (`dk init`, the
  lifecycle stages of req-265, `claim = ["running"]`) beside the meta vault — the second
  exception to Q-05 after req-265's stage migration; the bundled `dk` (milestone 240) is used;
  (7) **the owner's legacy folders**: `E:\projects\drey-tickets\tickets\{10-inbox,
  20-prioritized,50-build,60-commit,80-done,archive}` hold only the frozen pre-cut-over
  copies of the store's 92 tickets (the tag `pre-dricket` keeps them) — deleted in one
  commit **after the owner's OK on the exact list**, the untracked files (`tickets/videos/`,
  the inbox attachments, `T-0092.md`, `ledger.jsonl`) shown to him one by one first,
  `tickets/_meta/` untouched; (8) **the store's tickets on the new model**: through
  req-265's stage migration and req-268's chain migration (where `x-legacy-phase` and
  `x-rank` go; `x-legacy-id` stays — the board's `T-0091` numbers come from it). Original
  text: after the cut-over **and the owner's
  verification round** (owner, 2026-11-05: no fixed 30 days), delete what part (a)
  proved cannot go earlier — the inventory with callers and evidence is
  [`docs/design/dricket/decommission.md`](../docs/design/dricket/decommission.md)
  (part a, milestone 162, found class A empty and removed nothing). Exact scope: (1) the
  files forks of the board writers, phase-folder numbering ("Number folders", reorder
  renumbering), the drift pass, the file IO half of `core/transition.ts` (keep its pure
  patchers — the dricket bridge uses them), `core/phase-dirs.ts`, `core/normalize.ts`;
  (2) run / claim stamps and takeover-as-overwrite on files, the `.status.log` writer,
  the files-only ledger writers (the ledger path in the meta vault stays),
  `FileTicketStore`, `files-guard`; (3) the `files` and `shadow` modes of
  `tickets.backend`, the migration tool's legacy reader, the shadow diff, the reverse
  converter and `scripts/migrate-tickets.mjs` — only once the owner confirms no rollback
  is wanted; (4) the legacy phone remote (`plugins/tickets/remote/`, `fallback-client`,
  the `engine-main` fallback, the two `tickets-remote*` e2e specs) once Mission Control on
  the phone is verified — a product decision, nothing depends on it; (5) supersede
  `specs/ticket-schema.md` and the ADR-0076 file layout; the manual. Not in scope:
  `core/ticket-files.ts`, `ticket-board.ts`, `legacy-bridge.ts` (the dricket path runs on them).
  The Crew runner's share of (1)–(2) — its file writer, stamps, moves and status lines —
  left with req-176 (milestone 214); what remains here is the board and engine side.
  Three orphan helpers (`parkLine`, `phaseIdFromTitle`, `columnWorkerPin`) can go with it.

**What this does to running or planned items** (marks, not reordering):

| Item | Effect |
|---|---|
| E13-9 Shape in Drey (running) | **Stays valid** (UI, live edit, plan delta). Finish on the `files` backend; it must add **no new direct file writer**; its write path is re-targeted by milestone 155 (E14-4b: every board write is `put`). |
| E13-10 Plan to accept in the ticket | **Stays valid**; the `### Parts` block is body text. The engine routes (`parts`, `release`) are the contract: build the widget against them and put **no direct file write** behind them; the release is children-first, parent-last, resumable on dricket since milestone 155. |
| E13-11 Flow tab, E13-13..19 (Work view rest, panel naming, status bar, capture button, board filter, views polish, crew completion) | **Stay valid** (UI/DTO driven). |
| E13-12 Settings → Tickets in Drey | **Stays valid** except the pipeline/column editor: **waits** for OD-4 (stage vocabulary) and Q-05 (who edits `dricket.toml`). |
| E11-1c video size rule, E11-1b, E11-2b, E10-3b/4b/5b, E10-7, E12-3b/5/7/8 | **Stay valid** (videos stay outside git; UI follow-ups). |
| E11-4 cost table and estimate; `## Verlauf` writer | **Stay valid**; the writer moves inside the runner's claim (E14-5); history for the estimate comes from `dk log` (dk R-07). |
| E7 ledger and status log | **Reshaped, shipped on the board side** (E14-6, milestone 159): the ledger stays in the meta vault, `phase` lines dropped on a store; the status log is keyed comments. No new work on `.status.log` files. |
| E2b-4 engine announces its writes | **Reshaped** into E14-8 (shipped, milestone 160); do not extend. |
| Fleet stability remainder, "Takeover follow-ups", req-78 (red gate sends back) | **Wait**: claims, takeover and moves are re-based on `dk` in E14-5; do not start new claim/takeover code. |
| req-66 remote (refine, claim routes, R7 push), req-75 W5 capture, W9 audit runs | **Stay valid**; their write calls go through the port. |
| ADR-0076 file layout, T-0041 numbered folders, req-50/req-86 "Number folders" and column renaming, archive folder and marker, "a file move is a ticket move" and the drift pass, `entered-*`, the `run:` map, `claimed-by`/`claimed-at`, the pipeline `push:` key | **Obsolete after E14-7** (kept only as a read fallback for migrated tickets); do not extend. |
| X-1 documentation hygiene | Stays valid for notes; skip the parts of `ticket-schema.md` that E14-9 supersedes. |
| Mission Control UI, chat (Pia), personas (Paul, Ben, Ralf, Tessa, You), flows and chains, plans and parts, proof/verification/video, costs, views, Assistant targets | **Unchanged.** |

### Next

~~7. **Screenshots in the app.** Capture a region or window and embed it
   as an attachment (`attachments/`, ADR-0024). ⚠️ Scope open: whole
   window, region, or another application's window.~~
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
- **Tasks inside the document.** First define what the Tasks panel
  (filters, due dates, priorities, completion dates — ADR-0033) and the
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

### Needs an owner decision

- **`copilot-web`** stays excluded (fragile prototype); the req-29
  remainder below is therefore `copilot-cli` only.

### Backlog (unordered, uncommitted)

~~- **Req-6** — further CodeMirror 6 themes on demand (bundled set + `@uiw`
  themes since milestone 16; Cyberpunk is the third bespoke theme).~~
~~- **Req-12** — automatic image captioning via a vision model.~~
- **Req-18** — flow descriptions / agentic workflow automation
  ("Description => Sebastian => Peter"). The "=> Jira" target is excluded
  (Req-17).
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
- **req-78 — A red gate sends the ticket back** (owner request,
  2026-10-31). An optional `on-red: <phase>` key per phase in
  `pipeline.md`: a red gate moves the ticket back to that phase with
  the gate's failure log in the ticket (Log line + the next run's
  brief), instead of only backing off. The target is configured, so
  the back-move may cross a manual checkpoint — the checkpoint only
  stops the machine because nothing told it otherwise (owner,
  2026-10-31). Flow the owner expects (e.g. `test` red, `on-red:
  plan`): the plan worker revises the plan with the failure as
  feedback and tells the owner what failed; when that needs decisions,
  the ticket waits in Needs you until the owner has made them; then it
  goes straight back into the phase whose gate went red (the phase it
  had started), not through the queue again. The loop is bounded by
  the phase's `max-red:` — past it the circuit breaker parks as today.
  The pipeline stays linear apart from this one rule; a visual workflow
  designer (branches, parallel paths) is not planned. Open: where the
  "return to" phase is recorded (a frontmatter key vs. derived from the
  Log), whether a checkpoint between the two (plan-review) is skipped
  on the way back, and how it interacts with W7's gates and routing
  (req-75).
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

- **The tranche sizes and early-stop limits on Settings → Tickets → Autopilot (follow-up of milestone 221, req-179).** The runner reads `autopilot.tranche.{runs, budgetShare, minutes}` and `autopilot.earlyStop.*` from the tickets plugin's config (FLEET.md), but no screen writes them — board 7g predates the tranche and draws no such rows, so none were added (fidelity rule). Draw them on the canvas (the Autopilot group of 7g, or 7l), then build; *Adjust…* already opens Settings → Tickets.
- **req-277a — dk: a Settings field, a way to update the bundled one, other platforms (follow-up of milestone 240, req-277).** The path rule is `dk.path` in the tickets plugin's `config.json` (no UI, like `dk.store`); a Settings → Tickets field would show which `dk` is in use (bundled or configured) and its version, which the board issue only reports when something is wrong. The bundle is the pinned release and changes with Drey's own releases; an in-app dk update (or a newer `dk` on PATH winning) is not built. `fetch:dk` and the extra resource are Windows-only, like the installer; a macOS or Linux build (`docs/design/macos-port.md`) needs its own archive and checksum in `scripts/dk-version.json`. The board issues are literal English strings in the engine (the engine package has no i18n binding): move them to the catalog when the engine gets one (req-106).
- **Settings opens at a section (follow-up of milestone 221, req-179).** *Adjust…* on the checkpoint card and popover opens Settings → Tickets (desktop: `settings.open {category}`, a base change of milestone 221) and Mission Control's Settings tab, but neither scrolls to the Autopilot group: the desktop's `SettingsService` / Settings component has no `openSection`, Mission Control's shell no deep link.
- **The Lead reads the checkpoint report (follow-up of milestone 221, req-179; with req-168/ADR-0093).** The card is drawn by every client from the chain status; Pia's chat context does not carry the tranche or its report yet, so "why did the tranche stop?" in Mission Control gets no answer from her. Feed `tranche.report` into her context when the checkpoint waits.
- **A run that settles in the next tranche counts there (follow-up of milestone 221, req-179).** A run released in tranche *n* that is still out when tranche *n+1* opens lands as a fact of *n+1* (ADR-0077 later change). If reports read wrong because of it, attribute a fact by its start instead (the record already lists the pending tickets per tranche).
- **req-187 — The MCP row's client count (follow-up of milestone 222, req-165).** Board 8a reads `127.0.0.1:4319 · 3 clients (2 runs, Claude Desktop)`; Drey's MCP endpoint is stateless Streamable HTTP in the Drey process and keeps no notion of a client, so the service window draws `served by Drey`. Count clients (by `initialize` client info, recent requests) once req-212 moves Drey's server into the service (milestone 227 served the workers there: its row counts their live tokens), and put the count on the `mcp` record. *(id provisional — the integrator confirms it.)*
- **req-188 — Keep the harness's raw output (follow-up of milestone 222, req-166).** The Sessions tab's *Raw JSON* shows the normalized `stream.jsonl` lines; the board means the harness's own JSON. The runner would write each adapter's raw lines beside the stream (`raw.jsonl`, capped) and serve them as `GET /raw/<run>`. *(id provisional.)*
- **req-189 — A held run's release time (follow-up of milestone 222, req-166).** Board 8b's `held · releases in 11 min`: a held run (the takeover, a 1:1 dialog) has no release timer today; with ADR-0093's keep-warm span the record gets `releasesAt` and the session row and the runner row's `1:1 with Ben idle 4 min` read it. *(id provisional.)*
- **req-190 — Harness version and permission mode on the run (follow-up of milestone 222, req-166).** The fact grid's `claude-code 2.1 · sonnet · permission auto`: the run record carries neither the CLI's version (each adapter can read it at spawn) nor the permission mode the request had; add both to `RunInfo` and the window shows them. *(id provisional.)*
- **req-191 — *Open in Drey* at the ticket (follow-up of milestone 222, req-166).** The Sessions tab's *Open in Drey* (and *Open Drey*) brings Drey to the front; opening it at the run's ticket needs a way to hand Drey a target (an argument its single-instance hand-over reads, or a `drey://ticket/<id>` scheme). *(id provisional.)*
- **req-192 — The uninstaller ends a running Drey Service (follow-up of milestone 222, req-165).** `build/installer.nsh` removes the `DreyService` `Run` value; a service (and its tray process) still running from the old install keeps the files busy. The NSIS hook should ask the service to leave (`service-main.js --stop`) before it removes the files. *(id provisional.)*
- **req-193 — Heavy seats for what a worker starts itself (follow-up of milestone 223, req-180).** The governor seats the gate's commands, the ci checks and dev servers it sees listening on a leased port; a worker's own `npm test`, build, dev server or browser inside its harness session runs unseated — bounded only by the parallelism variables in the worker's environment. A small runner route (`POST /governor/seat {runId, task}` → a lease, released by the call's end or the run's) plus a shell helper the worker's instructions name (`drey-seat <task> -- <command>`) would let a worker take a heavy seat; browsers (Playwright, the proof screenshots) are the first caller. *(id provisional — the integrator confirms it.)*
- **req-194 — CPU rate cap and I/O priority for heavy processes (follow-up of milestone 223, req-180).** `os.setPriority` lowers the priority class (below normal) and `nice`; it does not cap CPU or lower I/O priority. A Windows Job Object (`JOBOBJECT_CPU_RATE_CONTROL_INFORMATION`, background I/O) needs a native helper behind the `ProcessPriority` port (ADR-0096 keeps that door open); worth it only if the owner still feels heavy tasks with the class lowered. *(id provisional.)*
- **req-195 — Dev servers off Windows; the dev-port range on Settings (follow-up of milestone 223, req-180).** The process table's listener probe answers on Windows only, so on Linux and macOS a dev server on a leased port holds no seat and the Governor block reads `none`; `lsof -iTCP:<port> -sTCP:LISTEN` / `ss -ltnp` would do it. The range (`service.json` `governor.devPorts`, default 4300–4399) has no field on Settings → Background service (board 8c draws none). *(id provisional.)*
- **req-196 — The pool popover's upgrade mark reads the engine's routing (follow-up of milestone 224, req-181; the Capacity band's slot chips move into the board's pool chip with req-271).** The Models page reads `routing.upgradeAboveQ` from `GET /models` since milestone 224, but the 7e band's slot chips still mark `q` above the renderer's fixed `UPGRADE_Q` (1.3) — the chain status carries no routing. Put `routing` (or the mark itself) on the chain status's `slots` and let `slotChipsOf` read it. *(id provisional — the integrator confirms it.)*
- **req-197 — One local day for the ledgers, the tranche and the burn rate (follow-up of milestone 224, req-181).** All three count the UTC date, so the owner's day turns at 01:00 (02:00 in summer) in Berlin and the burn-rate card says `resumes 01:00`. A day boundary in the machine's zone, behind one injected day port, for every "today" of the service at once. Owner's call. *(id provisional.)*
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
- **req-210 — Copilot CLI's models in the settings (follow-up of milestone 226, req-182).** `worker-models.ts` lists no models for `copilot` (the id is typed). Read them from `copilot --help`'s `--model` choices or the CLI's model listing once req-208 has the installed version's output. *(id provisional.)*
- **req-211 — A work-profile opencode slot with its own login (follow-up of milestone 226, req-182; Spike 5).** opencode's GitHub Copilot provider needs one interactive device-code login (`opencode auth login`) stored in `<XDG_DATA_HOME>/opencode/auth.json`; it reads no existing gh or Copilot CLI login. A slot's `login` has no way to give an opencode worker its own data home (only `opencodeAuthEntry` / `opencodeAuthFile` for the z.ai readout). Add `opencodeDataHome`, spawned as `XDG_DATA_HOME` (`slotEnv`), so a work slot keeps the work login apart; the login itself stays the owner's one step in a terminal. *(id provisional.)*
- **req-212 — Drey's own MCP server for other programs moves into Drey Service (follow-up of milestone 227, req-167; ADR-0092 R6, ADR-0094 consequences).** Milestone 227 gave the workers the service's vault MCP; Claude Desktop, the stdio bridge and other programs still reach the vault through Drey's server in the Drey process (`electron/mcp/`, `mcp.enabled` / `mcp.httpPort` / `mcp.yolo`, Settings → MCP), so they lose it when Drey closes. Serve them from the service too: a client token per program (beside the per-worker tokens), `mcp.yolo` as their write rule, the confirmation diff through Drey while Drey is open and a refusal while it is not, the stdio bridge pointing at the service; Settings → Background service's MCP row then drives the service's component, and req-187's client count follows. *(id provisional.)*
- **req-214 — The `tags` filter of the workers' `vault_search` (follow-up of milestone 227, req-167).** The shared tool set restricts a search to tagged sections through the tags plugin's section index (`SectionSearchProvider`), which lives in the Drey process; the service passes none, so a worker's `vault_search` with `tags` answers that the index is unavailable (words, phrases, regex and paths work). Give the service a section reader over the files (`shared/note-sections` + the tag grammar) as the provider. *(id provisional.)*
- **req-215 — A worker's write in the local note history (follow-up of milestone 227, req-167; ADR-0094's stated price).** `VaultManager` records every replaced text in `<userData>/history/` (ADR-0060); a worker's write through the service leaves no entry, so *File history…* cannot undo it. Either route a write to Drey while Drey is up (the proxy variant ADR-0094 names), or let Drey capture the before-text when it hears of the change (req-213's path carries the paths, not the old text — the service would keep it). *(id provisional.)*
- **req-216 — A model-driven vault tool call on every harness (follow-up of milestone 227, req-167).** `harness-mcp-live.spec.ts` (`DREY_LIVE_MCP=1`) proves opencode 2.0.32, Kimi 2.5.2 and Claude Code 2.1.319 connect to the endpoint with their token, without a prompt; no live run has yet had a model call `mcp__drey__vault_read` and a refused `vault_write` and shown both audit lines in the service window. Run one ticket per harness with a persona granted one vault (costs tokens — the owner's verification of the block covers it), and Copilot CLI once installed (with req-208). *(id provisional.)*
- **req-218 — The 1:1's answer as it is written (follow-up of milestone 228; with req-204).** The answer lands when the persona's turn ends (`PersonaTurnWatcher` reads the stream on the fleet's change push). Show the reply growing on the Crew tab, the Assistant and Mission Control from the run's `text-delta` events once the harnesses emit them (Claude Code does; ACP is req-204).
- **req-219 — The 1:1's idle span as a setting (follow-up of milestone 228).** Fixed at 15 minutes (`shared/session-lifecycle.ts`, `IdleRelease`); make it a `service.json` / Settings value the runner and the clients' release time read.
- **req-220 — The 1:1's class request over the persona's pool (follow-up of milestone 228; ADR-0095).** A 1:1 asks for the model table's class of the persona's own default model on its harness; there is no class pick over the persona's pool and no step up, so a busy default model refuses the 1:1 instead of granting the next model of the class. Route it like a dispatch's class request (no ticket, no size).
- **req-221 — Cancel a 1:1 turn (follow-up of milestone 228; with req-157).** A long answer can only be waited out or the session released from the service window; give the 1:1 pane, the Assistant target and Mission Control a Cancel that interrupts the turn (`interrupt` on the run) and leaves the session held.
- **req-222 — Earlier 1:1 conversations (follow-up of milestone 228).** The newest session file with a persona's `persona:` key is its 1:1; a persona has no way to start a fresh conversation or to read an earlier one from the clients (the Assistant target offers no `history` / `open` / a real `newThread`). Decide whether a 1:1 has one file forever or one per topic, then build the list.
- **req-223 — A 1:1 on each real harness (follow-up of milestone 228).** Verified with fakes only: a live 1:1 on Claude Code (`--permission-mode plan`, a quiet start, a turn's text and result in the stream), opencode (`plan` mode over ACP) and Kimi (`plan`), and the idle release on a real worker; Copilot CLI has no read-only mode (a stream note) — say so on the 1:1 or refuse it there.
- **req-252 — The 1:1's fleet read tools (follow-up of milestone 234, req-217).** `fleet_status` and `fleet_watch` are in the 1:1's read cut (`ONE_ON_ONE_TOOLS`) but no worker can call them: they are the tickets plugin's tools in the plugin-tool registry of Drey's own MCP server (`electron/mcp/plugin-tools.ts`, `plugins/tickets/main/mcp-tools.ts`), which lives in the Drey process, and the service's vault MCP serves the vault tools only. Serve the two read tools from the service's MCP over the fleet client's read port (the engine holds the fleet in-process), keep the same per-token cut for a 1:1, and add them to `OneOnOneVaultTools`' answer so the brief names them; until then the 1:1 reads the board in the tickets repository with its harness's own tools. *(id provisional.)*
- **req-253 — The 1:1's brief names tools by prediction (follow-up of milestone 234, req-217).** The brief is composed before the worker spawns, so `## Tools` follows what the spawn path will attach (the endpoint listens, the harness has an `mcpLaunch`, `MCP_HARNESSES`); an ACP agent whose `initialize` advertises no HTTP MCP is learned only at the handshake, so the brief could name `vault_read` while the stream says *this run has no vault*. Either let the first line carry a tools sentence composed after the spawn (from the gate's real answer), or send the brief after the handshake. *(id provisional.)*
- **req-254 — A live 1:1 calls the vault read tools (follow-up of milestone 234, req-217; with req-216, req-223).** Proven with fakes and the real endpoint over the official MCP client (a 1:1 token lists three tools, reads, is refused a write and the audit lines land) — no live 1:1 on a real harness has had a model call `vault_read` and a refused `vault_write` and shown both in the service window. Run one 1:1 per harness with a persona granted a vault (costs tokens — the owner's verification covers it); `harness-mcp-live.spec.ts` (`DREY_LIVE_MCP=1`) only proves a harness connects, with no prompt. *(id provisional.)*
- **req-255 — A free session's brief names its vault tools (follow-up of milestone 234, req-217).** A free session shares the starter with the 1:1 and gets the vault MCP with its persona's rights (the full six tools, writes where `allowed: write-vaults` says; read-only only in a read-only mode), but `fleet/free-session-brief.ts` names no tool — the model learns of `mcp__drey__*` from the MCP listing alone. Decide whether the free brief carries a `## Tools` section (with the write grant stated) like the 1:1's, once the owner has used a free session with a granted persona. *(id provisional.)*
- **req-259 — A seeded persona's models follow the model table once it exists (follow-up of milestone 235, req-256).** A machine without a model table for the persona's worker seeds with the parser's default (`opus`) and the marker keeps it from being re-picked, so the owner sets the models on the Persona page by hand. Offer "Use the model table" on the page (the rule is `CrewSeedModels`: the worker's rows, strongest class first), or re-pick while the persona still holds the parser default and no run has used it. S.
- **req-260 — The seeded step text follows a new shipped version (follow-up of milestone 235, req-256).** The seeded `prompt.md` is a snapshot of the shipped character and of the role's step prompt at seeding; a later `drey-prompt-version` of `build-default` etc. does not reach it (the vault prompts under `_meta/prompts/` have "Reset to the shipped version" and the version marker; a persona's prompt has neither, and the marker is stripped). Decide: keep the marker in the seeded prompt and offer the same reset on the Persona page, or store the step by reference. S–M.
- **req-262 — Delete a persona from Mission Control's team detail (follow-up of milestone 236, req-261).** The route is served to every paired client (`POST /api/personas/<id>/remove` with `{confirm: <title>}`, the refusals with their `code`), but only the desktop's Persona page draws the action. `libs/mission-ui/src/team/detail.ts` has no modal and no typed-confirmation pattern (its memory and journal removals act at once, and its Setup tab has no destructive step), and the phone is the client where a destructive step deserves its own board: design the typed-name ask for the phone and the pad (a sheet, the field labelled with the title, Delete disabled until it matches, the refusals in the catalog's words — the keys are `persona.delete.error.*` in `shared/i18n/catalog/en.json`; Mission Control has its own `McI18n` catalog), add `removePersona?(confirm)` to `TeamDetailVm`, `McState.personaRemove`, and close the detail on success. Read-only devices never see it.
- **req-263 — The Persona tab closes itself when its persona is deleted (follow-up of milestone 236, req-261).** After a deletion the page hands the user to the Crew tab (`PersonaPageHost.removed`), but the persona's own tab stays open and shows *"missing"* until it is closed by hand, because the plugin SDK cannot close a tab (`api.documents` has `addDoc`, `rename`, `open`, no `close`). Add `documents.close(path)` (SDK 1.58, additive: `plugin-api.ts`, `plugin-api-impl.ts` over `EditorService.closeTab(key, { silent: true })`, `versions.ts`, `plugins/AUTHORING.md`, an ADR-0044 later change) and have `removed` use it.
- **req-224 — A closing round on each real harness (follow-up of milestone 229, req-169).** Verified with fakes only: a red-gated run on Claude Code resumed by `--resume <ref>` under `--permission-mode plan` answering the round's JSON, opencode and Kimi resuming over ACP `session/load`, and a harness that refuses the resume leaving a facts-only journal entry. Run one noteworthy ticket per harness and read its `reviews.md` entry and `memory.md` line.
- **req-225 — The runner's persona writes as commits (follow-up of milestone 229).** The closing round's journal entry, memory lesson and `improvements.md` proposal are plain file writes into the tickets repository (as the E3 memory line was), so they stay uncommitted until the owner commits; give the runner one commit per round (`personas: <id> closing round <ticket>`) over the tickets repository's git, or hand the writes to the engine's board service.
- **req-226 — A `memory_write` / `journal_write` tool during the run (R14's later item; follow-up of milestone 229).** If lessons turn out to get lost between the run and its closing round, the worker may write one memory line (and one journal note) itself through a tool, with the same line form and caps.
- **req-227 — The closing round's tuning (follow-up of milestone 229).** The cost outlier reads the runs of the supervisor the run belongs to (one provider) — read the records of all providers; make the factor (3×), the window (20) and the minimum sample (5) settings beside `closing-signals:`; let the owner's Stop cut a closing round that is running (today it ends at its answer or its 10-minute bound).
- **req-228 — The journal by model on a client surface (follow-up of milestone 229).** `GET /report`'s `byModel` (runs, red gates, retries, steers, outliers, mean cost, causes, frictions per harness/model) is curl-able only; show it on the Crew tab and in Mission Control's team view (a board first).
- **req-229 — Shape with Paul as a session record (follow-up of milestone 230, req-173; R9, concept open question 3).** `SessionKind` types `shape`, but Shape still runs over the chat bridge with read rounds (`chat-service.ts` shape turns), not as a session of a harness. Decide from the numbers whether Shape becomes a held session (kind `shape`, the ticket's repository read-only, Paul's harness, the plan as its working file) and build it on `HeldSessionStarter` with a `ShapeKind`.
- **req-230 — A free session waits for its class (follow-up of milestone 230, req-173; R10).** A free session the pool cannot serve now is refused with the pool's reason; R10's "queued · waits for a <class> slot" (the record in state `queued`, started when a slot of the class frees) needs the pool's request queue (`routing/request-queue.ts`) to hold a held-session start, and the form/card to show the wait.
- **req-231 — One machine file (follow-up of milestone 230, req-173; R13).** Drey's mirrored device settings (`service.*`, `remote.*`, `chat.*`, `gitPath`, `dk.*`, `fleet.pool.*`) still sit in the engine's `config.json` beside `service.json`; fold them into `service.json` (`ServiceConfigFile`, the schema in `service-config-schema.ts`), move every reader and the plugin's mirror, and delete the retired vault keys (`defaultWorker`, `autoPermissionMode`, `personas.default`, `fleet.cap.*`, `fleet.compactAboveTokens*`, `fleet.resumePauseTtlMin`, `fleet.contextCapTokens*`, `autopilot.tranche.*`, `autopilot.earlyStop.*`) and `chain.legacy.json` one release after 0.8.x.
- **req-232 — The rest of the vault keys on Settings (follow-up of milestone 230, req-173; with the tranche follow-up of milestone 221).** `_meta/crew.md` holds the default persona, the instruction output caps and the tranche / early-stop limits, but Settings → Tickets writes only the default worker, the permission, the resume pause, the context cap and the compact thresholds; draw the rest on the canvas first (fidelity rule), then build them over `CrewSettings`. The human persona's name (`personas.humanName`) is crew configuration too and would move into `crew.md`.
- **req-233 — A free session in Drey's Work panel and in Mission Control's chat (follow-up of milestone 230, req-173).** The owner talks to a free session on the service window's Sessions tab (and the takeover); Drey's Thread and Mission Control show no conversation of a free session. A free session has no chat file (a 1:1 has one); decide whether it gets one under `_meta/chat/` (`kind: free`, the directory) so every client reads the same conversation.
- **req-234 — A free session on each real harness (follow-up of milestone 230).** Verified with fakes only: a live free session on Claude Code, opencode, Kimi and Copilot CLI in the tickets vault and in a repository, the permission modes, the first line, the idle release of a real worker, and Pia's card confirmed against a real chat model.
- **req-240 — Progressive loading of skills (follow-up of milestone 232, req-172; R8).** Today a run loads every selected skill in full. When a persona carries many, put each skill's name and description in the prompt and let the worker read the body with a `skill_read` tool (the vault MCP's toolset, `shared/vault-tools/`, ADR-0094), the way Claude Code loads its own skills; the count in the preview then shows the descriptions only, with the bodies as the "if read" figure. Decide from the numbers of the `selectedTokens` field when it pays.
- **req-241 — An exact token count (follow-up of milestone 232, req-143).** `core/token-count.ts` estimates from characters with a rate per family (Anthropic 3.5, OpenAI-compatible 4.0). Behind the same `estimateTokens` seam: the provider's own count where one is reachable without a new cloud call (the Claude Code worker's reported usage of a finished run as a calibration, a local endpoint's `/tokenize`), `exact: true` only then.
- **req-242 — Skills on the phone client and in Mission Control (follow-up of milestone 232, req-172).** The routes are on `TicketsRemotePort` and the engine's HTTP API; only Drey's persona page (req-171) draws them. Mission Control's team detail and the phone client list a persona's skills with the switch, the token figure and the upload (a `SKILL.md` text; a zip from a file picker).
- **req-243 — A 1:1 proposal that carries a skill body (follow-up of milestone 232, req-172; R2/R11).** The 1:1's `skill` proposal adds a *name* to the persona's `skills:` list (`persona-session-service.ts`), which with Agent Skills folders is only useful when a folder of that name exists. Let the card carry the skill's text: accepting it writes `personas/<id>/skills/<name>/SKILL.md` through the upload path (refusing an overwrite) and adds the name, one commit.
- **req-244 — The prompt preview for a ticket and a step's own template (follow-up of milestone 232, req-143).** The preview fills the ticket's parts with placeholders and, for a persona with no `prompt.md`, shows no step template (the phase's prompt rides there in a real run). Take an optional ticket id (the real description, plan, handover) and the phase's template, so the count is the run's actual start.
- **req-245 — Skill management beyond the first cut (follow-up of milestone 232, req-172).** Delete a **shared** skill (refused while another persona selects it, or after the owner confirms the list of them); import a folder of skills by path (the owner's `~/.claude/skills` in one step, without zipping); enforce a skill's `allowed-tools` (read and listed today, enforced by nothing).
- **req-246 — Drop the flat skill files (follow-up of milestone 232, req-172; one release later).** `loadPersonaSkills` and `SkillFolderReader` still read a legacy `<name>.md` and the migrator still turns it into a folder (milestone 232, "one release"). A release after the owner's vaults have migrated, remove the flat branch, the migrator and `SkillView.legacy`, and drop the `<name>.md` form from `specs/ticket-schema.md`.

- **The pool popover's queue part reads the pool's queue (follow-up of milestone 220, req-186; the Capacity band's queue line moves into the board's pool chip with req-271).** The band's last line still words the first queued ticket as `T-0127 queued · waits for a slot · 1st` from the dispatcher's order (milestone 218); the Board card and the Work row already read the chain status's `queue` (`queue-line.ts`) — the band takes the head of `queue` too, with its class and place (`T-0123 queued · waits for a B slot · 2nd`, board 7e).
- **A slot editor on Settings → Models (follow-up of milestone 220, req-186).** `Add slot…` opens the folder of `service.json`; the engine has `POST /slots/config` (the whole list) but `GET /slots` returns derived views, not the raw entries (login folders, limits), so a page cannot add one slot without losing the others' data. Needs a read of the raw `slots` list on the engine (or an `add` route) before the page can offer an editor.
- **Settings → Tickets as sub-pages (open question of milestone 220).** Board 7l draws `Models` as a page of its own with an h1 under a Tickets nav that lists five entries; the host draws Tickets as one scrolling page with anchors. The page is built as a section whose title sits where the board's h1 does; separate pages per nav entry would be a base change in `src/app/settings/` and, with it, the question whether `Budget and runners` and `Walkthrough videos` stay in the nav.
- **The queue's head is not reserved (follow-up of milestone 217, req-170).** R10 lets the dispatcher take the next task whose class has room, so a class-A task can wait behind lighter ones while they keep fitting under the cap. If it bites: hold back capacity for the queue's head once it has waited longer than a span. Owner's call.
- **The context a session expects is never estimated (follow-up of milestone 219, req-178).** The filter takes no model whose declared `context` is below what the step needs — `needs: context-200k` on a ticket, a part or a phase works today — but the class request's own `contextTokens` stays null: nothing measures a ticket's text, its worktree diff and the instruction against the window. A first value could come from the context pack's size at dispatch.
- **Routing on the screens (follow-up of milestone 219, req-178; with req-186).** Settings → Models has no capability columns (input, tools, context, output), and no **Import from models.dev** action (`poolModelsImport`) (the Routing group is wired since milestone 224, req-181); the run's `grant.route` (q, estimated cost, the filtered slots, a step up) is not drawn on the card or in the service window's log (board 8a reads the runner log line). Sonnet, with req-186's page.
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
- **req-120 — Start build from the ticket card (board 9a; milestone 196)** (owner request, outside the list, 2026-11-07; found by wave 4.3 as a "feature not yet built" row; built later, not in wave 4). the card's primary button starts the build phase for a Prioritized ticket: one engine call (the transition the chain would make), the button only in the states the board shows it, confirmation per the `tools` write policy.
- **req-121 — Priority and Worker as dropdowns on the ticket card (board 9a; milestone 196)** (owner request, outside the list, 2026-11-07; found by wave 4.3 as a "feature not yet built" row; built later, not in wave 4). today plain values set from the board; needs the card writing `priority:` and the worker/persona assignment through the engine (`personaPatch` / ticket put), with the chevron dropdowns the board draws.
- **req-122 — The reviewer persona's verdict in the Review band (board 7d, "Ralf: no blockers"; milestone 196)** (owner request, outside the list, 2026-11-07; found by wave 4.3 as a "feature not yet built" row; built later, not in wave 4). the review report carries no per-persona verdict; needs the review phase writing it (prompt + report field) and the band drawing the third fact.
- **req-123 — blocked-by between parts (board 7c; milestone 196)** (owner request, outside the list, 2026-11-07; found by wave 4.3 as a "feature not yet built" row; built later, not in wave 4). a part line can name the part it waits on ("blocked-by P1"); today only `after P1` + reason. Needs the Parts schema field, the dispatcher honouring it, the row drawing it.
- **req-124 — The verifier's recommendation at the end of the verdict (board 7j, "The verifier recommends accepting."; milestone 196)** (owner request, outside the list, 2026-11-07; found by wave 4.3 as a "feature not yet built" row; built later, not in wave 4). the test report carries no recommendation; needs the test phase prompt asking for one, the report field, the sentence in the proof block.
- **req-125 — SDK: `EditorSurfaceContext.mode()` (milestone 196)** (owner request, outside the list, 2026-11-07; found by wave 4.3 as a "feature not yet built" row; built later, not in wave 4). a plugin editor surface does not know whether its pane is in Live Preview or Source mode; 4.3 reads the pane's toggle from the DOM, which works and is e2e-covered but depends on base markup. The SDK exposes the mode (and its change) on the surface context; the ticket document then stops reading the DOM. Minor SDK bump, sample plugin updated.
- **req-138 — Per-option descriptions on the decision card (boards 7a, 7c, 10a)** (owner request, outside the list, 2026-11-07; found by wave 4.8 against boards 7a/7c/7d; built later, not in wave 4). The engine's `choices` card carries a label per option; the boards draw a second line under each ("one undo step, what other editors do") and mark one "recommended". Needs the card contract carrying `description` and `recommended` per choice (ADR-0071 / the conversation card of SDK 1.41), the orchestrator writing them, the Assistant and the device clients drawing them.
- **req-139 — Step rows and their age in the Assistant's Mission Control answer (board 7a: "✓ T-0121 · step 1 · tests green · 7 actions ›", "4 min ago · Ben waits")** (owner request, outside the list, 2026-11-07; found by wave 4.8 against boards 7a/7c/7d; built later, not in wave 4). The engine's answer carries text only; needs a structured step list per ticket in the conversation message (status, step, summary, action count, timestamp) and the rows in the Assistant; 7c's phase rows are req-129.
- **req-140 — Detach and name a target's attached document (boards 7a–7d chip `T-0121.md ×`; milestone 200; id proposed)** (owner request, outside the list, 2026-11-07; found by wave 4.8). The chip on a conversation target reads `T-0121.md attached` (the tickets provider's label) and cannot be removed; the boards draw the file name and an ×. Needs the conversation thread to let the owner detach (SDK: `ConversationThread.attached` entries with an id and a `detach`) and the provider's label without the verb.
- **req-141 — Allow edits and Use the web on a conversation target (boards 7a–7d icon row; milestone 200; id proposed)** (owner request, outside the list, 2026-11-07; found by wave 4.8). The boards draw all four tool icons on Mission Control; the panel hides live edit and web there because neither does anything on a target. Decide what they mean on a target (the engine's chat reading the web, a target that may change the attached note) before they are drawn.
- **req-235 — A persona's portrait (the Persona page's Profile block: `Upload picture…`)** (follow-up of milestone 231, req-171; E13-19's portrait item). The page draws the initials circle; the mockup puts an `Upload picture…` control beside it. `avatar.png` (`personas/<id>/avatar.png`, optional in the record) has no route: needs an upload and drop route that writes it as one commit, the page control, and the cards of Drey, Mission Control and the phone drawing the picture instead of the initials.
- **req-236 — A persona's `Tell me when` (the Persona page's Work block)** (follow-up of milestone 231, req-171; E13-19's Notify item). The mockup puts a rule beside the daily budget (`asks or stuck`, `done`, `never`); nothing records or reads one — a flow step has a `notify` flag (`Tell me when it is done`), a persona does not. Needs the record field (`notify:` in `persona.md`, `specs/ticket-schema.md`), the notifier consuming it per run, the select on the page. Until then the page draws no such control.
- **req-247 — Skills from the Persona page, beyond the first cut** (follow-up of milestone 233, req-237). `Add skill…` refuses an existing name (`skills.error.exists`) with no offer to replace it — after the name is known (a `SKILL.md` names it; a zip or folder is read by the engine) the page should ask once and retry with `overwrite: true`; a file or folder can be **dropped** on the Skills block (a folder drop needs `DataTransferItem.webkitGetAsEntry`); and the upload goes only to the persona's own folder — the shared pool (`scope: shared`) needs a switch or a second menu entry and a words-free way to say "for everyone".
- **req-248 — The prompt preview of unsaved instructions and of another step** (follow-up of milestone 233, req-238). `personaPromptPreview` reads `prompt.md` from disk, so the panel shows the *saved* brief while the head's `≈ N tokens at start` already follows the editor (the instructions' share is swapped by `atStartTokensOf`). Let the route take an optional `prompt` (and the IPC, the remote protocol and the HTTP query with it) so the panel shows what Save would produce, and offer the step in the panel (today the persona's first step, the engine's `build` when it has none).
- **req-249 — A model row's busy count from the engine** (follow-up of milestone 233, req-239). The `0 / 2 busy` figure is counted in the page from the fleet snapshot (`deps.runs()`: live runs and sessions by model, provider and slot) against `sessions` of the model table × the slots serving the row; a runner that is down shows no slot and no figure, and the capacity cap's cost weighting and the per-slot caps are not part of it. A `byModel` count on `GET /slots` (additive, `fleet/routing/`) would give Mission Control and the phone the same figure and let it follow the caps.
- **req-250 — Human skill titles on the Persona page** (follow-up of milestone 233, req-237; fidelity). The mockup titles a skill `Test first` and `Drey plugin authoring`; Agent Skills names are the folder name (`tdd`, `drey-plugins`), so the row shows it as `Tdd` / `Drey plugins` and puts the description in the row's tooltip. Decide where a human title lives (the frontmatter's `metadata.title`, a first heading, or nowhere — the folder name is what the owner types in `skills:`).
- **req-142 — Persona permissions: the runner enforcing them ("Allowed to", board 7k)** (owner request, outside the list, 2026-11-07; found by wave 4.9 against board 7k; built later, not in wave 4). The record and the page are done: milestone 227 (req-167) built `allowed: write-vaults`, enforced per call by Drey Service's vault MCP; milestone 217 (req-170) `spend-above-allowance`; milestone 231 (req-171) the page block (read vaults fixed, write vaults per vault, run commands, network, spend above the allowance) and the two new record fields `allowed: run-commands: accept-edits | bypass` and `allowed: network: true`. **Still open:** the runner reading those two per run — it starts every harness with the crew's `permissionMode` today, so the choice is recorded and changes nothing — and a network switch that means something (it needs the harness sandbox of req-185, Spike 1).
- **req-152 — The Crew's 1:1 and the personas' inner workings** (owner request 2026-11-07) — **designed** 2026-11-07/08 with the owner: rulings R1–R14 in `docs/design/work-panel/crew-internals-concept.md`, ADR-0092–0095 proposed. Leaves the roadmap with req-164–173, which carry the build; D-52 is resolved by req-168.
- **req-155 — Dock panels resizable freely, down to a minimum of the other columns** (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07). A side dock may take any width as long as the centre column and the other dock keep a defined minimum; today's clamps are per dock (`WIDTH` in `dock.service.ts`).
- **req-156 — Mission Control: the model is selectable per runner** (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07). Mission Control offers the models the chosen runner (worker) can serve, like the desktop's model picker; today the chat model is one config value (`chat.model`).
- **req-157 — Mission Control: visible progress while working, and a session lifecycle (applies to runs *and* 1:1 sessions held by the Crew runner — concept R12)** (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07). "Shaping T-0016 with Paul — Working …" stays silent for a long time; the owner needs feedback that the model works (streamed thinking / step lines, elapsed time), and a rule for the runner session behind a chat: the same session is reused while the conversation continues (the provider cache), and it is released after a defined idle span instead of hanging on. Ties to req-110's idle logic and to the capacity pool (req-170, milestone 217: a held 1:1 holds its seat). *The 1:1's half of the lifecycle shipped with milestone 228 (req-168): held while the conversation continues, released after 15 idle minutes; what remains here is the visible progress, the Cancel control and the runs' release.*
- **req-158 — Mission Control: context is passed, not typed** (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07). "Ask about this note" puts a visible text into the composer; the owner never wants to see that — the note (its content, not its path) rides as context. Likewise a question about a ticket must carry more than its id when the model needs it (title, body, state). Today (`packages/tickets-engine/src/services/chat-service.ts`, `turn()`): the model gets the board digest (priority order, columns with counts, the open tickets' id/title/phase), the tickets named in the text (attached whole through `readTicket`), the shape context (plan) of a shape session, the last turns, and an optional `reference` string — the note's path, not its text. Done when the composer shows only the owner's words and the context block is visible on demand (a chip "note · 1 section" like the desktop's vault-context chip), and the note's content reaches the model.
- **req-174 — Find: the pickers and the Summarize / Replace messages keep their pre-board form** (found by milestone 210, req-161 follow-up). Board 9c draws no due-date or priority picker, so `plugins/tasks/renderer/task-meta.ts` (`openDuePicker`, `openPriorityPicker`, their emoji labels) and the literal messages of `search-summary.ts` / `search-replace.ts` / the replace confirmation modal still read as before the redesign; they need a board (the pickers' look) and the catalog migration (ADR-0091, req-106 area by area).
- **req-160 — Visible feedback whenever a command starts** (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07). The owner's rule for every surface (desktop, Mission Control): starting a command — a run, a chat turn, a move, a save to the store — shows at once that something happens (a busy state on the control, a progress line, the step words), and its end or failure shows too; no silent waits like "Working …" for minutes (req-157 is the chat case). One pattern, written down in CLAUDE.md's UI section once chosen, applied where a command is missing it.
- **req-159 — Editor: one mode switch and a floppy-disk Save** (owner request, outside the list; owner's first verification round on the integrated build, 2026-11-07). The meta bar now has `</>` (source) and the `⋯` menu's Live Preview ⇄ View; the owner wants one explicit control to switch View → Live Preview (write) with its own icon, so the three modes read as one switch; Save is a floppy-disk icon (board 9a shows the pill; the icon is the owner's ruling for the built app — the board is adjusted).
- **req-147 — Settings: a recurring resume time for the Autopilot, and full-row search hits (boards 7g, 10t; O9)** (owner request, outside the list, 2026-11-07; found by wave 4.7, milestone 202; built later). The board's "Resume paused autopilot at 18:00 every day" is a one-shot time today; the settings search lists hits by name only where the board shows the whole row. Needs the recurring rule in the Autopilot record and the runner honouring it, and the search drawing the hit's row.
- **req-148 — Queued and waiting runs in the fleet report (boards 10i, 5d; O11)** (owner request, outside the list, 2026-11-07; found by wave 4.7, milestone 202; built later). The Crew cards draw "queued" and "waits for a slot"; the fleet report knows live runs only. Needs the dispatcher's queue in the report and the clients drawing the state.
- **req-150 — The status bar's running summary (board 10t; O4)** (owner request, outside the list, 2026-11-07; id by ruling O4, milestone 203; built later). Board 10t draws `2 running · 1 stuck · 1 queued` left of the Autopilot item. The order and the unframed items hold since milestone 203; this item is the summary itself, over the fleet's runs, its `queued` from req-148.
- **req-151 — A Shaping row names its plan version (boards 7a, 7b)** (owner request, outside the list, 2026-11-07; found by milestone 203). Board 7a's row reads `T-0119 · Shaping · plan v3 · yesterday`. The snapshot's card holds no plan version (the phone reads it from the ticket's own `plan` reply), so the row shows no pulse without a dialog. Needs the version on `TicketCard` (an engine contract addition).
- **req-149 — A note's H1 as its title on the devices (boards 10k, 10n, 10r; O11)** (owner request, outside the list, 2026-11-07; found by wave 4.7, milestone 202; built later). The Notes client lists file names; the boards draw titles. Needs `/api/notes` serving the first heading (or the frontmatter title) and the client using it.
- **req-134 — SDK: status-item dot tones `paused` and `neutral`** (owner request, outside the list, 2026-11-07; found by wave 4.4 on board 10t). `StatusItemSpec.dot` knows `positive` and `attention` only; the desktop Autopilot item draws Paused with an orange dot and Off with a grey one on the board, and the plugin can only choose between green, orange and none. Add the two tones (minor SDK bump, sample plugin and 10t row updated); until then the item's Paused and Off dots are a justified row of milestone 197.
- **req-132 — Settings: the changed-only filter ("Changed · default N", board 7g)** (owner request, outside the list, 2026-11-07; found by wave 4.4 as a "feature not yet built" row; built later, not in wave 4). A toggle at the head of the settings page that shows only the settings whose value differs from its default, with the count; needs every setting to know its default (the schema in `shared/config` has them) and the rows filtered by it, in the core categories and the plugin pages alike.
- **req-133 — Settings: "Commonly used" (board 7g)** (owner request, outside the list, 2026-11-07; found by wave 4.4 as a "feature not yet built" row; built later, not in wave 4). A first section that gathers the settings the owner reaches for most (the board lists theme, text size, assistant model, autopilot); a static curated list to start with, each row a live copy of the setting in its own category.
- **req-127 — A `Model` conversation target on the devices (boards 10e, 10q, 5b, 5c, 10n)** (owner request, outside the list, 2026-11-07; found by wave 4.6 as a "feature not yet built" row; built later, not in wave 4). the right pane's segment reads `Model | Mission Control` on the boards; the client has no direct-model target on a device (every ask goes to Mission Control). Until it exists the iPad segment reads `Mission Control | Capacity` (decisions.md 2026-11-06). Needs the client calling the chat bridge without the orchestrator persona, a per-device setting for the model, the segment.
- **req-128 — The age of a plan mark (board 5b, "2 min ago")** (owner request, outside the list, 2026-11-07; found by wave 4.6 as a "feature not yet built" row; built later, not in wave 4). `marks` carries `by` and `text` only; needs a timestamp written by the engine when a mark is set and the relative time on the mark (desk and devices).
- **req-129 — Step rows on the plan page (board 5c: "✓ Shape · decisions locked", "✓ Plan · 3 parts written into T-0130")** (owner request, outside the list, 2026-11-07; found by wave 4.6 as a "feature not yet built" row; built later, not in wave 4). a per-phase summary line with the phase's outcome; needs the engine deriving it from the ticket log / phase records and a row per passed phase above the Parts block.
- **req-130 — Settings controls of board 5f on the devices (scope "This vault", "Show only changed", `Open sidebars` with `Change…`, an Editor category)** (owner request, outside the list, 2026-11-07; found by wave 4.6 as a "feature not yet built" row; built later, not in wave 4). `/api/settings` serves Appearance, Chat, Devices, Engine and the Autopilot block only; the board's vault scope, the changed-only filter, the sidebar defaults and an Editor category need their settings on the engine and the rows in the client.
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

- **Persisted "approve" / "team" / "Sign Off" values (milestone 173 follow-up, owner request 2026-11-06, outside the list).**
  The wording change of 173 left every stored or contract identifier alone. Candidates that would read better
  as the user-facing words, each needing a migration that is not done: the default pipeline's stage title
  **Sign Off** is not a candidate on its own any more: the owner fixed one state list on 2026-11-06 and the column goes away (next item). The rest: the engine's
  `approve` checkpoint action kind, the Mission Control tab id `team` and the
  `tickets-team` document kind (persisted in view layouts and the phone URL), and the `desk-team` CSS classes.
  Each is a rename with a read-both/write-new bridge and a release note; none is needed for the owner to see
  "Crew" and "Accept".

- **Order of the canvas-2026-11-06 items (dependencies, concept §8.1):** guide step B repeated on the six stages → E14-3b / E14-7 cut-over (the final import writes the six stages) → req-99c phases inside Building. Shipped: req-102, req-99a, req-100, req-95a, req-97, req-99b, req-96 (with req-103, the phone menu root), req-98, req-95b and req-101.

- **Migrate the existing UI strings into the catalog, area by area (follow-up of req-102 / ADR-0091; req-106).** The i18n catalog (`shared/i18n/`, ADR-0091) covers only the surfaces of the 2026-11-06 canvas round; every older surface keeps its literal English strings. Migrate as areas are touched, one area per change: move its strings into `shared/i18n/catalog/en.json` under its `<area>.` prefix, read them through the runtime's binding (`I18nService` / the `t` pipe, `api.i18n`, `McI18n`, `i18n` in main), replace assembled sentences with ICU messages and `toLocale*` calls with the `Intl` helpers, then add the area's directory to `shared/i18n/guarded-paths.json` (and the ADR's list) so the guard keeps it. Candidate order: the Work panel and the ticket page (closest to the new surfaces), Mission Control's existing pages, Settings, the editor chrome, the Files panel, the native dialogs; the assistant panel's `shared/duration.ts` retires into `formatDuration` when its area moves. Not built.

- **Phases of the chain inside Building (req-99c; follow-up of req-99a, needs `fleet/orchestrator.ts` and `fleet/runs.ts`, which wave 2 kept apart).** The owner decided (Q6) that Plan, Build, Ralf's review and Tessa's test are phases of the chain inside the one Building stage. The engine's chain is still built from pipeline columns (`mergeChain`, `validateChain`), so today Building runs one `build-default` run and then hands over to Ready to try, the same as the live board's one agent column. To do: the gates as data of the Building column, the fleet running them one after the other inside one claim, the flow editor and gate bar showing them instead of the stages. Also decides how `review-default` and `qa-default` come back into the default flow.

- **Formatting strip on the phone and iPad Notes (follow-up of req-101, canvas Q5).** The pinned formatting strip (44 pt, `libs/markdown-surface` actions) above the keyboard of the Notes editor. Today `mc-markdown` shows its own small strip while editing; the pinned, designed strip of boards 10p/10r (paragraph style, bold, italic, lists, link, table, insert) is not built. Reuse the desktop's reducer from `libs/markdown-surface`.

- **Merge view for a Notes save conflict (follow-up of req-101).** A `conflict` reply from `POST /api/notes/note` today shows the desk's text and the owner's draft side by side and lets the owner keep one ("Keep mine" / "Keep the desk's"). A per-block merge like Drey's (`conflict/`, ADR-0060) needs a diff over `shared/` that both clients can use; not built.

- **Notes API gaps found by req-101.** (1) "Ask about this note" cannot attach the note to the chat the way a ticket rides a shape session (`ticket` on `POST /api/chat/sessions`): the engine has no note attachment, so the composer is prefilled with `About the note <path>:` and the model reads it through the vault tools; a `note` field on the chat call would carry it as a file (ADR-0071). (2) `GET /api/notes/note` returns no ticket link; the client reads `ticket:` from the frontmatter fence itself (`specs/frontmatter-schema.md`). (3) There is no rename, move or delete and no folder creation; the clients create notes in the open folder only.

- **Review and flow tab titles (follow-up of milestones 181 and 183).** The thread tab reads `T-0121 · Title` and D-15 gave a `DocumentRoute` its own title, but the review tab still reads `Review · T-0121` and the flow tab its flow title (`review/register.ts`, `flow/`); milestone 183 left them waiting for that contract, which now exists.

- **The gate bar's cost line says what it is (follow-up of req-98).** `cs-total` in the ticket view's gate bar is still a bare amount beside the gate pills; every other surface reads `$1.20 so far` / `$1.84 in total`.

- **Comment composer for store tickets (follow-up of D-12 and E14-6).** The thread shows a store ticket's comments since milestone 181 but cannot write one.


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
  compaction's fidelity loss shows. (2) The
  commit phase is mechanical (merge, push, verify from a fresh fetch)
  yet spent 7 % at 15–92 calls per run; the runner could do it in code
  and call a worker only on a conflict. (3) `plugins/tickets/main/index.ts`
  and `renderer/index.ts` (~80 KB each) were read 40 and 89 times;
  splitting them makes every tickets ticket cheaper. (4) The board's
  own `_meta/prompts/` copies predate req-55's "keep the context small"
  rule (Settings → Tickets offers "Reset to the shipped version").

- **req-75 W1 (Work panel):** the per-phase brakes (pause / stop / play
  one automatic phase) are no longer drawn — only the master switch is;
  a single phase is held over the runner's `POST /chain/column`. The
  Workers view (W4b) shipped without them; decide whether they come
  back there. The thread is one
  tab that follows the ticket opened last; one thread per ticket needs a
  plugin SDK way to put a tab into a given pane. The remote client's
  iPad drag still sends a drop index, which the desk now ignores — it
  goes with W8.
- **req-65 (interactive dialog):** the fleet's MCP tool `fleet_run`
  cannot start an interactive dialog — `interactive` rides neither its
  input schema nor `fleetStart`'s MCP mirror; an assistant-driven
  dialog would want it. Also open: a per-column picker for the
  interactive worker (today the assignment ladder decides silently).
- **req-62 (ticket header):** move the ticket from the header's phase
  chip. A board move renames the file, and an open tab whose file
  vanished turns into a draft that a save recreates at the old path (a
  duplicate id) — the same trap a card drag has today while its ticket is
  open. Needs the open tab to follow the move (a rename-follow on
  `announceChanges`, or a `documents.close` for plugins) before the chip
  can move anything.
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
~~- **Milestone 65 (Git, ADR-0065):** clone as a new vault, rebase /
  cherry-pick, partial staging, dotfiles in the tree.~~
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
