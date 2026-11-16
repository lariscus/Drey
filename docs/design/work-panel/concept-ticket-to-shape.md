# From an idea to Paul's plan — the concept of the design round of 2026-11-16

Status: **D1 (a) and D2 (a) decided by the owner on 2026-11-16** (as recommended); **D6, where
Paul's results live, designed and decided in §14** (the project's document folder). The rest is
proposed — D3, D4, D5 and the new D7 (§14.4) are still the owner's. Nothing is built. The
boards are 7y – 7ac ([boards/README.md](boards/README.md)); the build items are the proposed
rows req-318 – req-324 and req-326 – req-330 of **step 5 of the finish line** (§11; req-325, the
Autopilot's pull, is withdrawn with D1 (a)). The decisions are in §10, each with a recommendation.

The owner's finding (2026-11-16, paraphrased): bringing a ticket to Paul is already hard —
it must first be moved to *Prioritized*, and then it seems it can only be moved to Paul by
dragging on the **board**. After that nothing happens; the ticket only says *shape with
Paul*. "The workflow is not coherent." He wants the concept and the design of how it can
work.

## 0. What is there today (read from code, manual and specs — not guessed)

**How a ticket gets to a persona.** A ticket is created in *Inbox* with the standard flow
copied into its chain (`paul:shape; ben; ralf; tessa; you`, cursor `x-at: 1`). A move to a
persona is the engine's `start` (`services/persona-board-moves.ts`, `startOf`): stage
`active`, the dropped-on persona takes the entry at the cursor — **from Inbox or from
Prioritized** (line 59). Nothing but the owner makes it:

| Way | Where | Works from |
|---|---|---|
| Drag the card onto a persona's column | Board (`persona-board-drop.ts`) | Inbox, Prioritized |
| The card's context menu *Start with Paul* (right click, `Shift+F10`, the menu key) | Board (`persona-board-actions.ts:106`) | Inbox, Prioritized |
| The ticket pane's *Start with Paul* (asks once) | Ticket document (`start-model.ts:22`) | **Prioritized only**, and only when the entry's persona is in the crew |
| The Tickets panel's row menu | `index.ts:2547` *Move to* | lifecycle columns only — no persona |
| Mission Control (phone, iPad, web) | `router.ts:590` | **no start at all** — only `POST …/hand`, which the engine refuses for a ticket without a holder (*"start it from Inbox or Prioritized"*, `persona-board-moves.ts:71`) |
| Pia | `chat-intents.ts` | no `start` intent (she has `transition`, `setChain`, …) |

So Prioritized is **not** a gate in the engine — the owner's *"it must first be moved to
Prioritized"* is what the surfaces teach: the one button a ticket has appears only there,
the Tickets panel's menu offers no persona at all, and the drag and the menu key are
invisible until known.

**What *Prioritized* means.** The manual says it is *"the queue the fleet pulls from"* and
that the Autopilot *"picks up tickets from Prioritized in order"* (`manual.md` 1027, 1439;
`FLEET.md` 941; the req-309 changelog entry). **The code never does.** `ownerColumnRefusal`
(`fleet/runner/request-refusals.ts:10`) says it outright — *"the board's edge columns … are
the owner's: nothing is run out of them"* — and the holder pass plans only tickets that
already have a holder (stage `active` / `running`). The only writer into `active` is the
owner's `start` move. A ticket parked in Prioritized waits for nobody.

**What *shape with Paul* is.** The entry `paul:shape` is *interactive*: Paul holds the
ticket, but **no run is dispatched for it** — `holder-pass.ts:76` (not a candidate) and
`:132` (the wait line *"waits at position 1 of 5 for the Shape chat with paul"*, which only
reaches `runner.log`). The owner's turn is to talk to Paul in the Shape chat — the
Assistant's Mission Control target, bound to the ticket document in the editor — and to
end it with *Shaping done* (the Accept the engine reads at a `:shape` entry; Paul's plan run
then starts at the same position). The label the owner reads is
`board.status.shaping` — *"shaping with you"* (`persona-card-view.ts:58`, catalog
`en.json:1236`); the ticket pane's Holder row draws Paul's picture; Mission Control's
ticket screen has a button *Shape with Paul* (`libs/mission-ui/src/ticket/view.html:508`,
a literal, "Paul" not read from the crew). Which of these the owner saw I cannot tell.

**Why "nothing happens" — three causes, in order of weight.**

1. **At Paul there is no control that begins.** The card in Paul's column says *shaping
   with you* and carries one button: **Shaping done** (`persona-card-view.ts:115`, shown
   whenever `hold.mode === 'shape'`). It is the *exit* of a conversation that has not
   begun — enabled before a single message was sent, and pressing it makes Paul plan from
   the bare idea. Nothing on the card or in the ticket pane opens the chat. The system is
   waiting for the owner and does not say what to do.
2. **The chat refuses the ticket once it is started.** The Shape chat attaches only to a
   ticket in the *first* column: `shapeTargetOf` returns null unless `card.phase ===
   pipeline[0].id` (`ticket-document/shape.ts:36`) — Inbox. After *Start* the ticket is
   `active`, so the Assistant stops being "about" it, and Mission Control's *Shape with
   Paul* (`libs/mission-ui/src/ticket/view.ts:1413`, `canShape`: phase index ≤ 1) vanishes
   as well. The two halves of the flow disagree: the persona board puts the shaping at
   Paul's column, the chat binding still lives in Inbox. (The engine itself does not
   refuse: a shape turn takes any ticket id, `chat-service.ts` `shapeContext`.)
3. **The wait is invisible.** A ticket at a Shape entry sits in the Tickets panel's
   **Running** group (`work-groups.ts:163–167`: "a Shape entry is held by its persona and
   runs as Running") although it waits for the owner; *Needs you* does not list it. The
   card's amber dot and *shaping with you* are the only hint.

A fourth leaves the flow after shaping unclear: *Keep as one* / *Split* in the chat are the
older end of shaping (`chat-service.ts` `shapeDecide` moves the ticket by `transition` to the
next pipeline phase), beside the new *Shaping done* (the cursor's Accept). Two ends for one
thing; the first was written for the phase board and is **not traced** to the end on an
`active` ticket (its target is computed from the pipeline's phases, which on a lifecycle
board lack the active column).

**"The default flow shows Paul twice" (finding of 2026-11-14).** Fixed in milestone 280
(req-305): the standard flow reads `paul:shape; ben; ralf; tessa; you` — one Paul, shaping
and planning in one entry; the board's Settings page shows *Paul (shape) → Ben → …*. The
fix does not migrate (nothing released): a ticket or a board whose chain was copied earlier
keeps two Pauls until its flow is changed, and **leftovers read as if it were still so**:
manual lines 1056, 1368, 2463 (and `public/manual`), the comment of
`ticket-document/hold-card.ts`, and the boards 7e v2 / `DeskWorkV2`, which draw `PA PA`.
Still **not verified by the owner** (the entry's own marker).

## 1. The job

> When I have an idea, I want to hand it to Paul and end with a plan I can accept — without
> learning stages, drags, hidden menus or which pane the conversation is in.

What matters to the owner, in his own words from the earlier rounds: *an Inbox and a place
the work is taken from* (req-309); *one clear next thing*; and he reads on a phone as often
as at the desk.

## 2. The flow, and who acts at each step

```mermaid
stateDiagram-v2
  [*] --> Inbox: capture (New idea, Pia, a worker)
  Inbox --> AtPaul: Shape with Paul (start + the chat opens)
  Prioritized --> AtPaul: Shape with Paul
  Inbox --> Prioritized: optional — order only
  AtPaul --> AtPaul: the chat (Paul shapes / your turn / Paul asks)
  AtPaul --> Planning: Shaping done
  Planning --> Chain: Paul's plan is written, the chain goes on
  Chain --> You: Ben, Ralf, Tessa
  You --> [*]: Accept
```

| State | Who acts | What the owner sees | The one next action |
|---|---|---|---|
| **Idea** — Inbox or Prioritized | You | the card in its lifecycle column | **Shape with Paul** (or *Start with Ben* when the chain's first step is not a Shape step) |
| **At Paul, nothing said yet** | You | amber dot, *waiting for you* | **Shape with Paul** (opens the chat) |
| **Paul is shaping** | Paul | green dot, *Paul is shaping · 40 s*; the document is locked | none (the chat shows the turn; *Stop* is in the chat) |
| **Your turn in the chat** | You | amber, *shaping with you* | **Shaping done** (and *Open chat*) |
| **Paul asks** | You | amber, *Paul asks · 1 question* | **Answer** (opens the decision card) |
| **Shaping done → waiting** | the Crew | *queued · waits for a B slot* (pool words), or *Autopilot is off* | none — or the fix (*Turn on*) |
| **Paul plans** | Paul | *running · 2 min* | none; *Open thread* |
| **Ben … Tessa** | the Crew | as today (position, `running`, `waits for Ben`) | none |
| **At You** | You | as today (*Accept*, *Send back…*) | **Accept** |

Rules behind the table:

- **One next action per state, no state without one when the owner is the one waited
  for.** Every row in which the owner acts has a control; every row in which somebody else
  acts says who and offers nothing to press.
- **A ticket waits under *Needs you* whenever it is the owner's turn** — including a Shape
  entry that Paul is not working on. While Paul's turn runs, it is *Running*.
- **The label is built from the entry, not typed in:** *Shape with {name}* uses the persona
  at the `:shape` entry (renaming Paul to Paula changes it; today's literal does not);
  *Start with {name}* is the existing `board.menu.start`.

## 3. Is *Prioritized* a gate? — no (decided, D1 (a), 2026-11-16)

Prioritized stays as an **optional, ordered "up next" lane**. It is not required, no
surface requires it, and the button works from Inbox. Reasons: the engine already allows
it (`startOf`); with the default flow the first entry is a Shape step the owner must be
present for, so there is nothing for an automatic pull to do from Prioritized; and a required
step with no information in it is the opposite of *recognition over recall*.

Because the docs promise more than the code does, the two had to be made to agree: the owner
chose **to correct the docs** (D1 (a)) over building the pull (the Autopilot starting a
Prioritized ticket whose first entry *runs*) and over a required gate; the pull is recorded in
`specs/decisions.md`. Row req-323 corrects the docs.

## 4. The action, wherever the ticket is

One verb, one label, every surface — *Shape with {name}* / *Start with {name}* /
*Shaping done* / *Answer* — with the same enabled/disabled rule from **one pure function**
(`nextActionOf`, §11 req-318), so the card, the pane, the row, the phone and the menu never
disagree.

- **The board card** (board 7y). In the states where *the owner* is waited for the button
  is **on the card**, always visible (the existing decision-button style: 26 px, accent,
  12 px). On an Inbox or Prioritized card — many of them — it is an **icon button beside
  the ⋯**, shown on hover and on focus; the ⋯ is always visible (a click opens the menu;
  today's menu is reachable only by right click or `Shift+F10`). Icon-only, with `title`
  and `aria-label` (ADR-0057).
- **The card's menu** lists the primary action **first**, then *Start with …* /
  *Hand to …*, then the lifecycle moves.
- **While a card is dragged**, the column heads say what a drop does (*Drop to shape with
  Paul*, *Drop to start with Ben*); drag stays as the direct way to hand a ticket on.
- **The ticket pane** (board 7y): the primary action is the one accent button at the right
  of the card's action row, beside *Thread* and *Change*; the state pill carries the words
  of §2 (*Idea*, *Waiting for you*, *Paul is shaping*, *Shaping with you*).
- **The Tickets panel row**: the same icon button beside the ⋯ on Inbox and Prioritized
  rows; a ticket at a Shape step lists under *Needs you*; the grey line reads
  `T-0141 · Paul · 1/5 · waiting for you`.
- **Keyboard and command palette.** The command palette gets *Shape with Paul…* and *Start
  with …* for the ticket in focus (a card, a row or the open ticket); they carry no default
  chord — the keybindings system lets the owner bind one (nothing here departs from a
  Windows or UI norm; `Shift+F10`, the menu key and `Enter` keep their meaning).
- **Mission Control (phone, iPad)** (board 7ab): the same words, and — new — the ability to
  start (§0); the ticket screen's primary
  button is full width and 44 px; *Shaping done* gets a button there too (milestone 280
  left it out on purpose until the flow was clear).
- **Pia** can start a ticket *(optional row req-324)*: *"Shape T-0141 with Paul"* becomes a
  confirmed card — `start`/`hand` intents beside `transition`.

## 5. What a click does

*Shape with Paul* on an idea:

1. **If the ticket has no holder yet**, the engine's `start` runs — one write, the status
   line `started at position 1 of 5 with paul`; the card moves to Paul's column.
2. **The ticket opens in the editor**, and the Assistant's Mission Control target attaches
   it (`T-0141.md attached`) — the binding now also accepts a ticket that stands at a
   Shape step (§11 req-319), not only one in Inbox.
3. **The composer takes focus.** The first message is the first turn.
4. **A toast reads *Started T-0141 with Paul · Undo*.** Undo is the existing `park` (back
   to where it came from, the cursor kept); it is offered while nothing holds a claim.
   Opening a chat is cheap and reversible, so there is **no confirmation**; *Start with
   Ben* — which spends money — keeps today's in-place *Start T-0017 with Ben? Cancel ·
   Start*.

If step 1 fails, nothing opens: the engine's sentence stays visible beside the control (§8).
*Shape with Paul* on a ticket already at Paul skips step 1 and only opens and focuses the
chat. Board 7z shows the result: ticket open, chat attached, *Paul is shaping · 40 s* in
the Assistant's status line, the meta bar *Paul is editing · Stop*, the Tickets row under
*Running*, the toast.

*Shaping done* asks in place (*Paul plans it next · Cancel · Done*, the pattern of *Start*),
and is **disabled until a message exists** (error prevention: today it can end a shaping
that never began). The chat's *Keep as one* and *Split* end the shaping through the same
Accept (req-321) — one end, not two.

## 6. Status words

The system always says where the ticket is and who is expected to act. New kinds in the
card's status (`HoldStatus`), next to today's:

| Kind | Words (catalog, lower case like the neighbours) | Dot |
|---|---|---|
| `shape-wait` | *waiting for you* | amber, glowing |
| `shape-turn` | *{name} is shaping · {duration}* | green |
| `shaping` (exists) | *shaping with you* | amber |
| `asks` (exists) | *{name} asks · {n} questions* | amber |
| `autopilot-off` | *Autopilot is off* | hollow |
| `queued` (exists) | *queued · waits for a B slot* | hollow |

The engine adds the two facts the card cannot know today: whether the ticket's Shape chat
has begun (a shape session exists) and whether a turn is live — a small `shape` field on
`TicketHold` (req-318), so every client reads the same state.

## 7. Missing preconditions — the control explains and offers the fix (board 7aa)

A control whose precondition is missing is **disabled, not removed, and says why next to
itself** (the tooltip repeats it; it is never the only place), with the **fix as a button
under it**. A disabled control is still focusable (`aria-disabled`), so the reason reaches a
keyboard and a screen reader.

| Missing | The control | The fix |
|---|---|---|
| The Assistant has no model (the Shape chat answers with its settings) | *Shape with Paul* disabled, *The Assistant has no model* | **Set up model** — opens Settings → Assistant |
| Drey Service is not running | disabled, *Drey Service is not running* | **Start Drey Service** (the plugin's `ensureService`); the button enables itself |
| The step names no persona | the primary becomes **Assign…** | the picker lists the crew (the Crew tab's list) |
| Shaping done, the Autopilot Off | status *Autopilot is off*, never a bare *waiting* | **Turn on** — the existing switch |
| A run holds the ticket | *Hand to …* and *Move to …* disabled, *a run holds it* | **Stop run** stays enabled |
| The move was refused | the engine's sentence under the card (*changed meanwhile — look again and retry*) | **Retry** |
| A read-only device | no control, one quiet line | none — the state is only readable |

**Empty and first-use states.** An empty board draws one primary, *New idea*. After a
capture a toast reads *T-0001 created* with **Shape with Paul** in it, so the owner does not
have to find the button (req-320).

## 8. Errors and undo

- **Errors stay.** A refused move shows the engine's own sentence on the card until the
  next action, with *Retry* (today `deps.mutate` reports and moves on). No error is only a
  toast that disappears.
- **Undo** after *Shape with Paul* (park), the existing *Move to Prioritized / Inbox* menu
  after any move, *Stop* in the chat. Undo is not offered once a run holds a claim.
- **Not undoable, therefore confirmed:** *Shaping done* (the persona's plan run starts) and
  *Start with {agent}* (the run spends money).

## 9. The Nielsen heuristics, and where each is met

| Heuristic | Where |
|---|---|
| Visibility of system status | §6 words for every state; *Needs you* membership; the toast; *Autopilot is off* instead of *waiting*; the drag-over words; board 7z |
| Match with the real world | *Shape with Paul* / *Start with Ben* in the persona's own name from the crew; no *stage*, *holder* or *cursor* on a button; Prioritized not required |
| User control and freedom | Undo after the start, *Cancel* on *Shaping done*, Park and Hand in the menu, *Stop*, drag stays |
| Consistency and standards | one verb pattern on every surface; the in-place confirm pattern of *Start*; the context menu key and `Shift+F10` unchanged |
| Error prevention | *Shaping done* disabled until a message; hand and park disabled while a run holds the ticket; a control with a missing precondition is disabled with its reason |
| Recognition over recall | the owner's turn has its button on the card; the menu's first row is the primary action; the palette names it; no drag or hidden menu to know |
| Flexibility and efficiency | drag, menu, icon button, palette, a bindable chord; Pia *(optional)* |
| Aesthetic and minimal design | one primary per state; the icon button only on hover; no taglines or hint paragraphs |
| Help recover from errors | the engine's sentence kept, *Retry*, the fix button in §7 |
| Help and documentation | the manual's *Shape a ticket in the editor* is rewritten around the button; the docs say what the Autopilot does |

## 10. Decisions

1. **D1 — What Prioritized is. Decided 2026-11-16: (a)** an optional "up next" lane, the docs
   corrected. Rejected: (b) the Autopilot also pulls from it, (c) a required gate.
2. **D2 — What the click does. Decided 2026-11-16: (a)** the ticket moves to Paul at once and
   the chat opens, with Undo. Rejected: (b) open the chat only and move on the first message.
3. **D3 — Many ideas.** Add **Shape next** at the head of the Inbox: it takes the first idea
   to Paul and opens the chat, so a queue of ideas is worked like a mailbox. Not in this
   round *(recommended: later, after the first is verified)*. **Open.**
4. **D4 — Pia starts tickets** (*"Shape T-0141 with Paul"*): row req-324, optional. **Open.**
5. **D5 — Where the chat lives.** The Assistant's Mission Control target, as built
   *(recommended)*; a chat inside the ticket pane is a second surface for the same
   conversation (`specs/decisions.md`: *Shape as a held harness session* and the
   one-conversation-partner rule). **Open.**
6. **D6 — Where Paul's results live. Decided 2026-11-16 (§14):** the **project's document
   folder** — a folder inside one of the project's Write vaults, named by the project — for
   projects with and without a repository; not beside the ticket.
7. **D7 — A run without a repository** (§14.4). Without one, *every* run after *Shaping done* is
   refused, Paul's own plan run included. Recommendation: let a persona with a structural gate
   run without a repository (row req-330). **Open — needs the owner's nod.**

## 11. The build items (proposed roadmap rows, step 5 of the finish line)

Each small enough for one Sonnet run (req-330 is engine work and may want Opus), a pause after
each. D1 (a), D2 (a) and D6 are decided; the rows are worked in the order of §11.2.

- **req-318 — The ticket's next action: one pure model and the status words** (§2, §4,
  §6). `nextActionOf(card, snapshot, live, readiness)` in `plugins/tickets/renderer/`,
  used by the card, the ticket pane and the Tickets row (Mission Control follows in
  req-320); the `shape` field on `TicketHold`; the catalog keys; the new `HoldStatus` kinds.
  `readiness` also carries *the ticket has a repository* (for req-322).
- **req-319 — The Shape chat binds to a ticket at its Shape step** (§5, cause 2): the
  desktop binding and Mission Control's `canShape` accept an Inbox, a Prioritized and an
  *active ticket at a `:shape` entry*, no run live; *Shape with {name}* reads the persona
  from the entry; the one *Start and open the chat* action; **a `start` route for Mission
  Control** (`POST /api/tickets/<id>/start {persona}` beside `…/hand`, one more
  `RemoteDrey` method over the same `personaBoardMove`) — today a phone cannot start a
  ticket at all.
- **req-320 — The action on the card, the pane and the row** (boards 7y, 7z, 7ab): the
  card button and icon button, the menu's first row, the drag-over words, the ticket pane's
  primary and pill **including the in-place *Shaping done* ask**, the Tickets row's icon,
  the palette commands, the toast after *New idea*, the phone's full-width button.
- **req-321 — A Shape step waits under Needs you, and has one end** (§2, §5): the Tickets
  panel and Mission Control list it; the **card's** *Shaping done* waits for a message; the
  chat's *Keep as one* / *Split* end through the same Accept. (The pane's button is
  req-320's, so the two rows share no file.)
- **req-322 — A missing precondition explains and offers the fix** (§7, boards 7aa, 7ac):
  the disabled-with-reason control, the five fixes, *Autopilot is off*, the refusal line
  with *Retry*, and **no repository + a builder in the flow** (said before *Shaping done*).
- **req-323 — The docs say what the code does** (§0, D1): the manual's *Prioritized* and
  *Autopilot* wording (1027, 1439), `FLEET.md` 941, the two-Paul leftovers (manual 1056,
  1368, 2463, `hold-card.ts`'s comment), *Shape a ticket in the editor*, `public/manual`.
- **req-324 — Pia starts and hands a ticket** *(optional, D4)*.
- **req-326 — The project's document folder** (§14.2, board 7ac): the record key `docs`
  (`{vault, folder}`), its validation (the vault must be marked Write), the parser and
  writer, Settings → Projects' *Documents* row, `specs/ticket-schema.md`, the ADR.
- **req-327 — The deliverables reach Paul and the stages** (§14.2): the ticket field
  `x-docs`, the `## Deliverables` block of the run brief and of the Shape system prompt (vault
  name, folder, the ticket's paths), `specs/classifier-spec.md`.
- **req-328 — The ticket pane's Documents row** (§14.2, boards 7ac, 7z): the paths of `x-docs`
  as rows that open the document in the editor.
- **req-329 — Paul writes the document in the Shape chat** (§14.2): a `documents` field in
  the shape reply, written through the vault write path under `ProjectRights` (the project's
  Write, the persona's `write-notes`), the chat card *Paul wrote …* with *Open*, `x-docs`
  updated.
- **req-330 — A run without a repository** *(D7, needs the owner's nod)* (§14.4): a persona
  with a structural gate may run without a repository — no worktree, the run's own folder,
  the vault MCP writes into the document folder; a builder without one stays refused, now with
  the reason said before it starts (req-322).

### 11.1 Dependencies

`318` ← none · `326` ← none · `319` ← 318 · `327` ← 326 · `320` ← 318, 319 · `329` ← 326, 327 ·
`330` ← 326 · `321` ← 318, 320 · `328` ← 327, 320 · `322` ← 318, 321, 328 · `323` ← all behind it ·
`324` ← 319, 329 (optional).

### 11.2 The waves — rows of one wave run in parallel, no two on the same files

| Wave | Rows | Files each owns |
|---|---|---|
| 1 | req-318 ∥ req-326 | 318: `plugins/tickets/renderer/board/*model*`, `contracts/persona-board.ts`; 326: `contracts/projects.ts`, `core/projects/*`, `renderer/projects/*`, `specs/ticket-schema.md` |
| 2 | req-319 ∥ req-327 | 319: `ticket-document/shape.ts`, `conversation/*`, `libs/mission-ui/src/ticket`, `server/router.ts`, `remote-protocol.ts`, `drey-port.ts`; 327: `fleet/runner/request-*`, `core/ticket/*` (the field), the prompts, `specs/classifier-spec.md` |
| 3 | req-320 ∥ req-329 ∥ req-330 | 320: `board/persona-card-view.ts`, `persona-board-actions.ts`, `ticket-document/dom.ts`·`strip.ts`, `renderer/index.ts`, `libs/mission-ui`; 329: `services/chat-service.ts`, `contracts/chat.ts`, `core/chat/*`, `conversation/map.ts`; 330: `fleet/runner/request.ts`·`request-plan.ts`·`request-refusals.ts`·`worker-vault.ts` |
| 4 | req-321 ∥ req-328 | 321: `work/work-groups.ts`, the card's button in `persona-card-view.ts`, `libs/mission-ui/src/work`, `chat-service.ts` `shapeDecide`; 328: `ticket-document/model.ts`·`strip.ts`·`dom.ts` (the Documents row) |
| 5 | req-322, then req-323, then (optional) req-324 | 322: `dom.ts`, `strip.ts`, `persona-board-actions.ts`; 323: docs only; 324: `core/chat/chat-intents.ts`, `chat-service.ts` |

Two files every row touches in passing: `shared/i18n/catalog/en.json` (each row appends its own
keys) and `docs/manual/manual.md` with its `public/manual` copy — merge a wave's branches in
row order and resolve those two by hand; nothing else is shared inside a wave.

Specs and docs ride the rows: the manual, the catalog (a literal *Shape with Paul* leaves
`view.html`), `specs/classifier-spec.md` (req-327: the `## Deliverables` block and the shape
prompt's document rule; req-329: the reply's `documents`), `specs/ticket-schema.md` (the `shape`
hold field; the project's `docs`; `x-docs`), docs/05, docs/06, and an ADR with req-326
(*Documents belong to the project*: where, why not beside the ticket, the rights).

## 12. The boards

| Board | File | What it shows |
|---|---|---|
| 7y · Shape with Paul: the card and the ticket action, state by state | `ShapeStart` | the card in Inbox, Prioritized and at Paul (five states) and after; the card menu; the drag-over heads; the ticket pane's primary per state; the Tickets row |
| 7z · The first shaping: ticket open, chat attached, *Paul is shaping* | `ShapeFirst` | the desk, Work view: *Running* row, the pane with its *Documents* row, the locked document, the Assistant's status line and Paul's *wrote concepts/sync-status.md* card, the toast |
| 7aa · When something is missing: the control explains and offers the fix | `ShapeBlocked` | the nine states of §7 and the empty board |
| 7ab · Shape with Paul on the phone | `MPhoneShapeStart` | Work with *Needs you*, the idea's ticket with the full-width button, the ticket in the chat with *Shaping done* |
| 7ac · Where Paul's documents go | `ShapeDocs` | Settings → Projects' *Documents* row (set, and with no Write vault), the ticket pane's *Documents* row on a repo-less ticket, Paul's *wrote …* card, the folder in the Files panel, *Ben has no repository to work in* |

## 13. What I could not verify

- I did **not run the app**: "nothing happens" is read from code, manual and specs; which of
  the labels (*shaping with you*, the Holder picture, Mission Control's button) the owner
  saw is not known.
- **No SDK call selects the Assistant's target.** The binding follows the open document
  while the Assistant stands on Mission Control (the Work view's preset, board 7q); a
  case where the Assistant is on *Model* may need `conversations.select(targetId)`.
- **Whether a live shape turn is observable in the snapshot** (§6): the engine runs the
  turn, so it knows; the field is proposed, not traced.
- *Keep as one* on an `active` ticket (§0, fourth point), and **how the owner starts one
  step by hand with the Autopilot Off** (the manual says "you start every step"; the
  control is not located) — so the fix for *Autopilot is off* uses the existing switch only.
- The new elements' measures (icon button, toast, pill) are drawn after the existing card
  and strip, not measured against a build.
- §14: that a repo-less non-scout run is refused is read from `composeRunRequest` (`request.ts:159`,
  `request-plan.ts:40`), not run; whether the dricket store would tolerate a stray file beside a
  record (the owner's `tickets/t/0000/t-1/` example) is not tested — the argument against it does
  not rest on that; whether `ProjectRights` can be called from the chat service as it is (it sits
  in the service's vault MCP) is not traced — req-329 may need a small seam.

## 14. Where Paul's results live — the project's document folder (D6, decided 2026-11-16)

The owner's question: in his project no repository hangs at the project; where do Paul's
concepts and documents go — beside the ticket, or in the project (the project, he thinks,
is the better place)? The example: ticket `tickets/t/0000/t-1/ticket.md`, whose plan proposes a
`konzept.md` "next to this ticket file"; req-311 keeps concept snapshots at
`_meta/concepts/<slug>/applied.md`.

### 14.1 What is there

- **Paul's chat writes the ticket's `## Plan` and nothing else** (`chat-service.ts`: the shape
  turn replies `shape.plan`; it has no vault tools — a mission turn does, a shape turn reads its
  repository instead). The `konzept.md` of the example is a line in the plan; no code path
  writes it anywhere.
- **A run needs a repository.** `composeRunRequest` refuses every ticket run that is not a
  scout with *"names no repository — set repo:"* (`request.ts:159`, `request-refusals.ts:22`)
  and `planRun` takes `worktreePathFor(…, input.repo!, …)`. That covers Ben, Ralf, Tessa **and
  Paul's own plan run after *Shaping done*** — it is an ordinary run. A scout runs without a
  repository but writes only its ticket's `## Report` (`ticket-schema.md`, the scout form).
- **"Next to the ticket" has no home.** The ticket is a record of the dricket store (the
  owner's `t-1/ticket.md`); dk owns that folder and commits it by `put`; the store is
  project-scoped (req-316) and may be remote. A worker never sees it: it gets a temporary
  **copy** of the ticket that the runner takes back (`ticketCopyPathFor`, D-30), so a file
  placed beside that copy is lost with the run.
- **The meta vault does not serve it either.** `tickets/` is out of every vault tool's reach
  (`disk-tool-vault.ts:107`: *"tickets/, chats/ and dot-folders are not served"*). So
  `tickets/_meta/projects/<id>/docs/` — the owner's first idea — could be written by no worker
  and shown by no Files panel, Find or editor; it would need a second write path beside the
  rights of ADR-0071/0094.
- **What a project has today:** name, colour, repositories, read-only folders, vaults
  `none | read | write`, the purpose. A worker writes a vault only where the project says
  Write, its persona has `write-notes` and the run is not read-only
  (`service/vault-mcp/project-rights.ts`). `_meta/concepts/<slug>/applied.md` (req-311) is the
  *snapshot* Apply compares against — machine state, not the concept the owner edits.

So for a repo-less ticket Paul's only delivery place today is the plan chapter inside the ticket.

### 14.2 The decision

**Documents belong to the project.** The project record names one **document folder**:

```yaml
docs:
  vault: Drey notes        # a registered vault's NAME, and it must be marked `write` in `vaults:`
  folder: concepts         # vault-relative; created with the first document
```

- **A real folder of a real vault** — so it is in the Files panel, Find and Backlinks, opens in
  the standard editor and takes live edit (the concept-note flow of `concept-apply-draft.md`
  starts in a note of the project's Write vault). Nothing new for a worker to reach: the
  vault MCP serves it under the **existing** rights (project Write, persona `write-notes`,
  not read-only).
- **Validation:** the vault must be one the project marks `write`, else a warning and the key
  reads as none (a folder in a read vault could not be written); no `..`, not `tickets/`,
  `chats/` or a dot-folder. **Absent** = Paul writes no documents and says so in the chat; the
  plan chapter stays the one product. Settings → Projects gets one row, *Documents* (board 7ac,
  1 and 2): a vault picker over the Write vaults and a folder field; with no Write vault the
  row is disabled and says why.
- **The ticket points at them:** `x-docs` — paths relative to the folder (`concepts/x.md`) —
  written by the engine when Paul writes a document or the plan lists
  `### Deliverables`. The ticket pane's **Documents** row lists them and opens one in the
  editor (boards 7ac 3, 7z).
- **Paul and the stages know the place:** the Shape system prompt and every run brief get
  one block, `## Deliverables` — *"Documents that steer the work go in `<vault>:<folder>`;
  never beside the ticket"* and the paths the ticket already has (req-327).
- **Paul writes the document in the Shape chat** (req-329): the reply may carry
  `documents: [{path, text}]`; the engine writes them through the vault write path under the
  same rights check, adds them to `x-docs`, and the chat shows *Paul wrote
  concepts/capture-to-vault.md* with *Open* (board 7ac 4). Why there: the owner iterates with
  Paul in that chat; the document is the shape's product exactly like the plan; no run is
  needed, and a repo-less ticket works today's chain up to *Shaping done*.
- **The Outline stays per document** — it shows the headings (and, with req-311, each
  section's applied state) of the open note. I did not add "the project's documents" to it:
  that is the Files panel's job and, per ticket, the pane's. (The relay of this task suggested the
  Outline; this is the one place the design does not follow it, and why.)

### 14.3 Projects *with* a repository

Code stays in the repository's worktree — nothing changes. **Concepts belong in the project's
document folder there too**, for four reasons: a concept is the owner's source of truth, edited
live in a note, not a file of a branch; a worktree copy lives on `t/<id>` and is **removed when
the ticket ends** (finished worktrees), so a concept in it would not outlive its ticket; one
concept spans many tickets (req-311's Apply cuts stages from it); and the worktree is invisible
to Files and Find. The rule that decides a case: **a document the product ships** — a README,
an ADR the code change updates, the architecture docs of the repository — **is code**, written
in the worktree like any file of the change; **a document that steers the work** — a concept,
research, open questions — **is the project's**. If the project's Write vault *is* the
repository (Drey's own `docs/` opened as the vault *Drey notes*), the two coincide and no copy
exists; a stage still works the worktree copy, the concept the main checkout.

### 14.4 A run without a repository (D7)

Even with the folder, a repo-less ticket stops after *Shaping done*: Paul's plan run and every
builder are refused (§14.1). Options for the owner:

1. **(recommended) A persona with a structural gate runs without a repository** (req-330): no
   worktree, the run's own folder as its home, the vault MCP for the document folder; the
   planner is already judged by what it wrote (`gate: structural`, req-258). A builder without a
   repository stays refused, and the reason is said **before** *Shaping done* (board 7ac 6),
   not after a refused run.
2. A flow for repo-less tickets that ends at You after the shaping (`paul:shape; you`) and
   *Shaping done* then moves on without a plan run — a second meaning for the Shape entry
   (req-305 made it *shape, then the persona runs*); not recommended.
3. Leave it: a repo-less ticket is only ever shaped; *Shaping done* ends with a refusal the owner
   reads. The honest minimum, and the thing he met.

### 14.5 The alternatives

| | Where | For | Against |
|---|---|---|---|
| **A — the project's document folder** *(decided)* | a Write vault's folder the project names | reachable by existing rights, Files, Find, the editor, live edit; outlives tickets; one place per project; works with and without a repository | needs a Write vault in the project (the row says so); one more thing to set up once |
| B — beside the ticket | the store record's folder | moves with the ticket; one id | dk's folder, remote store, no worker can write it (temporary copy), invisible to Files and Find; a project has many tickets, concepts do not die with them |
| C — `tickets/_meta/projects/<id>/docs/` | the meta vault | versioned with the board, shared by devices, no vault needed | `tickets/` is served by no vault tool: a second write path outside the rights of ADR-0071/0094, not in Files or the editor; the board repository is configuration, not documents |
| D — only the repository | the worktree | one place for code and docs | nothing for a repo-less project; dies with the branch |
