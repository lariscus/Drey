# The persona board — concept for req-257 (2026-11-11)

Status: **concept, for the owner's decision; nothing built.** Roadmap row req-257,
re-scoped by the owner on 2026-11-11 ("no persona, no run; the board shows who
holds a ticket"), asks for *"a concept with a board draft on the dricket store
… then the owner's approval, then rows and sessions."* This note is that
concept. The draft lives beside it:

| File | What |
|---|---|
| `persona-board/persona-board-mockup.html` | Board 7e redrawn: Inbox · Prioritized · Paul · Ben · Ralf · Tessa · You · Done, the step as status on the card; then the same board with the personas named Plan · Build · Review · Test |

Every statement about today's behaviour names the file it comes from. Where I
did not verify something, the text says so. The owner's words are quoted as
they are recorded in the repository; the German originals of the 2026-11-10/11
rulings are not in the repository (only their English record in
`specs/decisions.md` and roadmap req-257, and the integrator's relay), so they
are quoted in English.

## 0. What exists today (the findings the concept rests on)

**The board is the pipeline.** Every surface's column list is
`BoardSnapshot.columns`, built from `_meta/pipeline.md`'s phases in order plus
unknown directories (`packages/tickets-engine/src/core/ticket-board.ts`
631–655). On the dricket store a record's `stage` *is* the phase id ("variant
A", `store/legacy-bridge.ts`); the shipped stages are hard-coded as
`STATE_IDS` = `inbox shaping prioritized building ready done`
(`core/pipeline-states.ts`).

**Steps are pipeline phases — the largest gap.** The chain grammar
(`core/chain-delta.ts`, `specs/ticket-schema.md` "The chain delta") only
knows *pipeline phases*: `insert <phase>(<persona>) after <anchor>` is refused
for a phase the pipeline does not contain (`validateChain`), the only
exception being `manual` / `manual-<word>`. The six-stage default has exactly
one agent phase, `building`; `pipeline.md`'s prose says *"plan, build, review
and test are phases of the chain inside it"*, but no code runs them as steps:
one run of `build-default` (or of the persona's prompt) does the whole of
Building, and the runner's green end moves the ticket one column right
(`fleet/chain.ts` header comment; agent lane rules in `specs/ticket-schema.md`).
So a per-ticket sequence *plan → UX/UI design → architecture → build → test →
acceptance* does not exist today in any form; the owner's model needs steps
that are **decoupled from stages**. This is the point where today's code
differs most from the owner's model.

**Persona resolution is per ticket per column, not per step.**
`resolvePersona` (`core/persona.ts` 268–283) walks ticket pin
(`x-persona`) → column `persona:` → `crew.md` `default-persona` → none;
`BoardPersonas.resolve` (`fleet/orchestrate/board-personas.ts`) runs it once
per card with the column's persona. A per-step persona exists only inside the
chain delta (`insert …(<persona>)`, `assign <phase> <persona>`). With no
persona the run still starts: the assignment ring picks a worker and the step
prompt runs (the "ring run" of the dispatch order, `specs/ticket-schema.md`).

**A persona's prompt replaces the step prompt.** `runPrompt`
(`fleet/request-instruction.ts` 73–77): the persona's `prompt.md`, when
non-empty, is the instruction base, else the phase prompt. That is why the
seeded crew (milestone 235) carries the role's step text inside its
`prompt.md` (`core/default-crew.ts` `seededPromptText`: `## Who <name> is`
then `## The <step> step`), and why req-258 found Paul losing the interactive
`QUESTION:` protocol.

**`<step>-default` personas come from the legacy-key migration.**
`BoardService.migrateLegacyPersonas` (`services/board-service.ts` ~4111)
turns a column's old `worker:` / `model:` / `prompt:` keys into a persona
named after the prompt ref or `<phase>-default` (`personaMigrationFor`,
`core/persona.ts` 303). The owner's meta vault holds `build-default` and
`commit-default` this way.

**The human persona exists.** `personas/you` with `kind: human`
(`HUMAN_PERSONA_ID`, `core/persona.ts`); a gate it works parks the ticket
(`awaiting: you`), never takes a slot, a budget or a capacity figure
(E10-6, "The manual step" in `specs/ticket-schema.md`). The owner's
`pipeline.md` already pins `persona: you` on Inbox, Shaping, Prioritized and
Ready.

**Shape and Flow chat are hard-coded Paul.** `SHAPE_SYSTEM_PROMPT`
(`services/shape-system-prompt.ts`) and `FLOW_SYSTEM_PROMPT`
(`services/chat-llm.ts` 66) open with *"You are Paul, the planner of the
tickets crew"*, and the shape prompt also hard-codes the roster: *"persona:
<id>" (ben builds, ralf reviews, tessa tests, paul plans)*. Both are chat-bridge
calls with the assistant's LLM settings, not the persona's model
(`crew-internals-concept.md` §0).

**`role:` carries logic in two places.** `inPipelineOrder` sorts personas by
role (`core/persona.ts`, "the role decides because the stock pipeline names no
persona per step of Building"), and `CREW_STEPS` maps a role to the step
prompt a seeded persona gets (`core/default-crew.ts`).

**What the store offers (dk ≥ 0.6, ADR-0090 and `dricket-requirements.md`).**
`x-<name>` extension fields (R-01, shipped as specified: single-line,
size-capped, never interpreted — the exact byte cap I did not check);
configurable `[stages]` with `claim` stages (R-03; `validate` replays history
with the stage set of each commit); every human edit or move is one
`dk put -F --claim --if-version` commit (R-24; `dk set` / `dk move` were removed
again in v0.6.0); a run claims (`dk claim`, which moves the ticket into the
first claim stage), writes inside its claim (`put -F`), and ends with
`release --stage S` or `commit --release --stage S`; **an agent may not release
into the stage it is in** (R-31, exit 14) — Drey works around it with a
release one stage back plus a `put --claim` (two commits, owner decision
2026-11-05: "R-31 not needed"). Drey's own ticket keys already ride as
extension fields: `EXTENSION_KEYS` = worker, persona, track, form, proof,
awaiting, class, model, size, allowance, needs (`store/extension-keys.ts`),
plus `x-chain` (entries joined by `;`, `store/legacy-bridge.ts` 85–86) and
`x-rank`.

**WIP is a label.** `wip:` is parsed (`core/pipeline-phase.ts`) but no engine
code reads it; only the legacy remote PWA draws it (`plugins/tickets/remote/kanban.ts`).
Parallelism is the capacity pool and the slots (`fleet/orchestrate/dispatcher.ts`,
`PoolCapacity`), plus the per-column breaker (`fleet/orchestrate/breaker.ts`,
`max-red`, default 3) and the column's `held` mode (`fleet/protocol-chain.ts`).

**The owner's live board (read-only, 2026-11-11).** Store
`E:\projects\drey-board`, `dricket.toml` on `main`: stages `inbox shaping
prioritized building ready done`, `claim = ["building"]`. Its checkout holds 92
tickets: 71 `done` (66 of them labelled `archived`) and 21 `inbox`; **nothing
in shaping, prioritized, building or ready.** The meta vault's `pipeline.md`
pins `persona: build-default` and `handover: agent build-default` on Building
(`wip: 3`, `token-budget: 40000000`); `crew.md` has no `default-persona`; the
personas are `ben build-default commit-default paul ralf tessa you`.

## 1. The owner's rulings

Recorded in `specs/decisions.md` ("A role fallback in the persona ladder",
2026-11-11) and in roadmap row req-257 (re-scoped 2026-11-11); the relay of the
integrator adds the phase-board sentence.

1. **Settled 2026-11-11 by §12b: the holder is the chain's entry at the cursor.** **No role fallback (2026-11-11).** *"Everything hangs on the personas, not
   on roles — two builders build differently ('Bob the Builder and Rubble from
   Paw Patrol both build, but not alike'), so a role says nothing about who
   should take a step; where the owner wants the same character several times,
   that is one persona running several tickets at once."* Rejected with it:
   `default-persona` set at seeding. *"The `role:` field stays a free label
   without logic."*
2. **Answered 2026-11-11: shown in the running persona's column, `running` stays the store's claim stage, §12b.** **No persona, no run (2026-11-11).** *"A step with no persona from the
   ticket or the column does not run: the ticket stands at the human persona
   as a manual step and says why."* (a Needs-you card).
3. **Answered 2026-11-11: (a), §12a.** **Steps per ticket (2026-11-10/11).** The steps of a ticket are set per
   ticket by **Paul** (with the plan) or **Pia** (Mission Control, as a card) —
   e.g. *plan → UX/UI design → architecture → build → test → acceptance*, or
   *research → plan → acceptance*.
4. **Answered 2026-11-11: (a), as invalidation, §12a.** **Send-back anywhere earlier (2026-11-10/11).** *"A step may send a ticket
   back to any earlier step, up and down the chain."*
5. **Answered 2026-11-11: one send-back per ticket, the second goes to You, §12b.** **Columns are holders (2026-11-11).** *"The board's columns are the personas
   that hold a ticket, the step is status on the card."*
6. **Answered 2026-11-11: in the responsible persona's column, §12b.** **The phase board is a special case (2026-11-11, relayed).** *"If I name the
   personas after phases I have my phase board again — we gain flexibility."*

Earlier rulings this concept keeps: R10 (a session requests a class and gets
exactly it or waits, no downgrade), R11 (the prompt *is* the persona), R12/R13
(sessions as records, three configuration layers) from
`crew-internals-concept.md`; ADR-0090 (gaps in dricket are dricket
requirements, not Drey workarounds; personas, flows and chains stay Drey's).

## 2. The model

Five words carry it.

- **Stage** — where a ticket is in its *life*: `inbox`, `prioritized`,
  `active`, `done` (and dricket's reserved `cancelled`). A stage says nothing
  about who works it. (§3 adds `running` as the claim's own stage.)
- **Step** — a unit of work from the **step catalogue** (§5): `shape`, `plan`,
  `research`, `design`, `architecture`, `build`, `review`, `test`,
  `acceptance`, `commit`, or one the owner adds. A step says *what* must be
  delivered and how it is checked; it says nothing about *who*.
- **Chain** — the ticket's ordered list of steps, each with the persona that
  takes it: `plan(paul); architecture(ralf); build(ben); test(tessa);
  acceptance(you)`. Set by Paul with the plan, by Pia as a card, by the owner
  in the flow editor, or copied from the board's **standard flow** when nobody
  set one.
- **Cursor** — which step of the chain is current. It exists while the ticket
  is `active`.
- **Holder** — the persona of the current step. **The board's columns are the
  holders.** A step whose persona is missing, unreadable or absent is held by
  the **human persona** with a reason (*"no persona for UX/UI design"*); a step
  assigned to the human persona (acceptance, a manual step) is held by it with
  an action (Accept / Send back).

Consequences of the model:

- **The phase board is a special case, not a mode.** Name four personas
  *Plan*, *Build*, *Review*, *Test*, give each exactly that step in the
  standard flow, and the persona board draws exactly the old phase board
  (state 2 of the draft). Nothing in the engine knows which of the two the
  owner has; there is no setting.
- **One persona, several tickets at once.** Ben holding three tickets is three
  cards in Ben's column; how many of them run at once is capacity (§9), not a
  copy of Ben.
- **The step is status, not a column.** A card says `Architecture · 3 of 6`
  and whether it runs, waits for a slot, waits for its persona, or was sent
  back. The column says who.
- **Lifecycle stays outside the crew.** Inbox, Prioritized and Done are
  columns of their own at the board's edges; a ticket there has no holder.
- **Parallel work is parts, not parallel steps.** A chain is a sequence. A
  plan that splits work keeps today's `### Parts` (each part its own ticket and
  chain, `specs/ticket-schema.md` "Parts").

## 3. The data on the dricket store

### The options

| | Shape | For | Against |
|---|---|---|---|
| **A** | `x-holder: ben` + `x-step: build` stored, the chain beside them | one read per card; a foreign `dk` reader sees the holder | two truths: the holder can disagree with the chain's persona for the current step (a drag that writes one, a hand edit, a Paul replan that writes the other); needs a drift check |
| **B** | personas as dricket stages (`[stages] values = [inbox, prioritized, paul, ben, ralf, tessa, you, done]`) | `dk ls --stage ben` works without Drey | the crew is in `dricket.toml` on protected `main`, edited by hand (Q-05); every persona added, renamed or deleted changes the vocabulary and migrates tickets; the claim hangs on stages, so every persona stage is a claim stage and dk moves a claimed ticket into the *first* claim stage (`paul`), which is wrong for Ben's runs; a stage cannot say which step, so the step needs a field anyway; a phase board would need a second stage set |
| **C** | the chain as a full list `x-chain` + the cursor `x-step`; **the holder is derived** (persona of the cursor's step, or You) | one truth; a drag is one edit of the chain; renaming a persona touches only the tickets that name it, never the store's config; the phase board falls out | a foreign `dk` reader must parse `x-chain` to know the holder |
| **D** | a native dricket `assignee` field (a new R-xx) + `x-step` | trackers have assignees; `dk ls --assignee` | the holder is a persona, which ADR-0090 decision 7 keeps Drey's; a field dricket would have to interpret for filtering; one more dricket release before the board can be built; still two truths with the chain |

### Decision (recommended): C, with lifecycle stages and a claim stage of its own

```
stage:   inbox | prioritized | active | running | done      (cancelled reserved)
x-chain: plan(paul); architecture(ralf); build(ben); test(tessa); acceptance(you); commit
x-step:  architecture
x-returns: 1                                                   (send-backs so far, §4)
```

```toml
[stages]
values    = ["inbox", "prioritized", "active", "running", "done"]
initial   = "inbox"
terminal  = ["done"]
claim     = ["running"]
cancelled = "cancelled"
```

Why:

1. **One truth.** The chain says who takes which step; the cursor says which
   step is current; the holder follows. A Paul replan that changes the current
   step's persona moves the card, which is what happened. Nothing can drift.
2. **The crew never touches `dricket.toml`.** Personas come and go with
   `_meta/personas/` (req-261 deletes one); the store's vocabulary is the five
   lifecycle stages and changes only when the lifecycle does.
3. **`running` as its own claim stage removes the R-31 problem without a
   dricket change.** In the persona board *every* step end is a release back
   into the stage the ticket lives in — with today's single claim stage that is
   the refused `building → building`, worked around by two commits that move
   the card a stage back and returns it (the E14-5b later change of
   ADR-0090). With `claim = ["running"]`, `dk claim` moves `active → running`
   by itself, and the step end is **one** `dk commit --release --stage active`
   carrying the advanced `x-step` (R-24, shipped in v0.6.0). The stage also
   tells a foreign reader that a run holds the lease. (Alternative, if the
   owner prefers one agent stage: raise **R-31 from Nice to Needed** as a
   dricket requirement — it is no longer a rare failed-run case but every step
   end. Not a Drey workaround either way.)
4. **No new dricket requirement for the board itself.** Extension fields,
   configurable stages, `put --claim`, `commit --release --stage` all exist. The
   board is built from the checkout's files as today (ADR-0090 later change
   E14-4), so derivation costs nothing per card.
5. **D stays open as a Nice** for when someone uses the store without Drey; it
   is not needed now and would add the two-truths problem.

`x-chain` keeps its key (it exists, `store/store-board.ts` 130) and its `;`
separator, but its **content changes from a delta to the full list** (§6). One
line stays well under any sane cap: six steps are about 90 bytes. `x-step` is a
step id that is unique in the ticket's chain (a second `review` is
`review-2`, as `manual-<word>` is today). `x-persona` (the ticket pin)
retires: a pin is now the persona of a step in the chain. `x-awaiting` stays
for a question inside a running step (§4). `x-returns` is new.

## 4. The transitions

| Move | Who | What is written (one commit unless said) |
|---|---|---|
| Inbox → Prioritized | owner (drag, menu), Pia (card) | `put --claim`, stage |
| Inbox / Prioritized → a persona column ("start") | owner (drag), Pia (card) | stage `active`; the chain is the ticket's own or a copy of the standard flow; the cursor on the first step; **the dropped-on persona takes that step** (the same rule as any drag between holders) |
| holder → holder | owner (drag), Pia (card) | the current step's persona in `x-chain` becomes the target; refused while the ticket is `running` — the card offers *Stop and hand to Ralf* |
| holder → You | owner | the current step's persona becomes `you`: the owner does this step by hand |
| step end, green | the runner | `commit --release --stage active`, `x-step` → next step (a missing persona → the card stands at You with the reason); the last step done → the engine's `put --claim` into `done` (an agent may not release into a terminal stage, v0.5 observation #3; today's handback works the same) |
| step end, sent back | the runner, on the worker's structured verdict | `x-step` → the named earlier step, `x-returns` + 1, the note as a comment (`dk comment`, never `release -m`, R-21) |
| Accept at You | owner (desktop, phone), Pia (card) | `x-step` → next step |
| Send back at You | owner, Pia | target picker over the earlier steps, a mandatory note, the structured feedback of E11-3 |
| any → Prioritized ("park") | owner | stage `prioritized`, the cursor kept |
| any → Done | owner only | stage `done` |
| claim | the runner only, at a run's start | `dk claim` (`active → running`); humans never claim (their edits are `put --claim`) |

**The claim** stays exactly ADR-0090's: one owner id per run
(`agent-<run>@<host>`), lease by size, epoch fencing, takeover after the lease.
Only the stage names change.

**The send-back.** The worker ends a step with a verdict the runner already
parses as the first line of a comment (`core/status-comment.ts`); a new verb
`send-back: <step> <reason>` names the target. The runner checks that the
target is an earlier step of this ticket's chain (anything else becomes a
red gate with that reason). After the target step finishes, the chain runs
forward again from there — every step in between runs again (question 4).
**The limit:** `max-returns` per ticket (crew default 3, `_meta/crew.md`; a
step of the catalogue may lower it). The send-back that would exceed it does
not move the cursor back: the ticket stands at You, *"sent back 3 times between
Test and Build"*. The circuit breaker stays, counted per persona instead of per
column (§9).

**A question inside a step** (a `needs-decision:` while running) keeps the card
in its holder's column with the *Question* badge and a Needs-you card; the run
releases to `active` with `x-awaiting: you` and re-claims on the answer (Q-03
as accepted on 2026-11-05). The card does not jump to You (question 7).

**The manual step** is a step assigned to `you` (acceptance, a hand check) or a
step with no persona. Both stand at You; only the first is an approval. The
second's card says why and offers *Assign…* (a persona picker over the crew,
filtered by the persona's steps, §5) and *Do it myself*.

## 5. The step catalogue and the composition of persona and step (superseded by §12b)

**The catalogue** is a folder in the meta vault, `tickets/_meta/steps/<id>.md`,
one file per step:

```markdown
---
title: Architecture
mode: agent            # agent | interactive | machine | manual
delivers: "## Plan › ### Architecture with a mermaid diagram; the touched components named"
gate: none             # machine checks the runner re-runs (today: the acceptance commands for build)
min-class: B           # the class floor (today the column's min-class, req-170)
needs: []              # model capabilities (req-178)
max-turns: 120         # the run ceilings (today the column's max-turns / max-work)
max-returns: 2
---
The task text: what this step does, what it must leave in the ticket, how it
reports a send-back.
```

The shipped catalogue is today's `_meta/prompts/` promoted:
`plan-default` → `plan`, `plan-interactive-default` → `shape` (mode
`interactive`, the `QUESTION:` protocol), `build-default` → `build`,
`review-default` → `review`, `qa-default` → `test`, `commit-default` →
`commit` (mode `machine` when the board sets a `ci:` command), plus new
`research`, `design`, `architecture`, `acceptance` (mode `manual`). The
version marker and "Reset to the shipped version" of the vault prompts carry
over (absorbs req-260 for steps).

**The composition** replaces req-258's "a persona's prompt replaces the step
prompt":

```
the run's instruction =  persona prompt.md      (who Ben is, how he works — R11)
                       + ## The <step> step     (the catalogue's task text and `delivers`)
                       + ## Skills, memory slice, ticket context  (as today)
```

The persona says *how*; the step says *what*. Paul on `shape` keeps the
interactive protocol because it is in the step, not in Paul (req-258's
failure). A persona with no `prompt.md` runs the step with no character.

**Migration of the prompts.** The seeded crew's `prompt.md` carries a
`## The <name> step` section (`seededPromptText`); it is removed when it equals
the shipped step text, kept and reported otherwise (the owner decides on the
Persona page). `build-default` and `commit-default` are prompt copies, not
characters (question 12).

**Which persona can take which step.** A persona record gains `steps:` —
the catalogue ids it is fit for (`steps: [build, review]`). The Persona page's
"Steps Ben can take" chips (R11 mockup, today "read chips from the flows")
become editable. It is **never** a fallback: it filters the pickers and tells
Paul and Pia whom to propose. `role:` stays the free label of the ruling.

**Where Paul and Pia get the steps.** The catalogue (id, title, `delivers`) and
the crew (title, summary, `steps:`) are composed into the shape step's and
Pia's context instead of the hard-coded roster. Paul writes the chain into the
plan (`### Steps`, beside `### Parts`); Pia proposes it as a card (the
existing `setChain` intent, `core/chat-intents.ts`, renamed `setSteps`) that
executes on the owner's confirm.

## 6. The chain per ticket

What changes: **a full list instead of a delta.** The delta made sense when the
standard flow was the pipeline's columns and a ticket only deviated; with steps
chosen per ticket the list *is* the plan. When a ticket starts without a chain
of its own, the standard flow is **copied** into it, so a later change of the
standard flow never reshuffles running tickets and `3 of 6` stays stable
(question 8).

| Today (`core/chain-delta.ts`) | Persona board |
|---|---|
| `insert <phase>(<persona>, notify) after <anchor>` | a list element `<step>(<persona>, notify)` where it stands |
| `skip <phase>` | the element is removed |
| `move <phase> after <anchor>` | the element stands elsewhere |
| `assign <phase> <persona>` | the element's persona |
| `notify <phase>` | `notify` inside the element — survives |
| `manual(you)` / `manual-<word>` | any step assigned to `you`; `manual` stays a catalogue step for "a hand check" |
| phases must be pipeline phases | steps must be catalogue ids |
| current and past gates locked | survives: only steps after the cursor are editable while active |

The flow editor (`core/flow-edit.ts`, `applyFlowOp`) already edits an
arrangement and only *then* encodes it as a delta; it writes the list
directly instead and the canonical-delta regeneration goes. `validateChain`
becomes `validateSteps`: known step ids, unique ids, a persona that exists,
no agent persona on a `manual`-mode step, no edit at or before the cursor.
**Parts** keep their own chain line in the same list grammar.

**The standard flow** moves from the pipeline's columns into `pipeline.md` as
one key: `flow: plan(paul); build(ben); review(ralf); test(tessa);
acceptance(you); commit`.

## 7. Shape and Flow chat as the assigned persona

- **Shape** is the `shape` step (mode `interactive`) held by a persona — by
  default the standard flow's shape persona, Paul on the shipped board. The
  chat's system prompt becomes *the holder's `prompt.md` + the shape step's
  task + the JSON contract*; "You are Paul" and the hard-coded roster go.
  Renaming Paul to Paula, or giving shaping to Ralf, changes who speaks.
- **Flow** (drafting the steps) is the persona of the ticket's `plan` step, or
  the shape persona when there is no plan step; without either, the chat asks
  which persona to ask.
- **Still the chat bridge.** Both stay direct calls with the assistant's LLM
  settings (D-1); only the character is the persona's, not its model. Making
  Shape a persona session is the deferred question 3 of
  `crew-internals-concept.md` §2 (req-109's numbers); this concept does not
  decide it.
- **Where a shaped ticket goes.** Shaping is work the owner does now, so a
  ticket enters Paul's column straight from Inbox (*Shape with Paul*); when the
  shape ends, *Start* moves the cursor to the next step and *Queue* parks it in
  Prioritized with its chain set (question 3). The Shaping stage goes.

## 8. Defaults, the pipeline and the old keys

| Today | Persona board |
|---|---|
| `pipeline.md` `phases:` = the board's columns | `phases:` = the lifecycle columns only (Inbox, Prioritized, Done; `active`/`running` are drawn as the holder columns), plus `flow:` |
| Building's handover keys: `handover: agent build-default`, `claim`, `wip`, `token-budget`, `max-red`, `min-class`, `needs`, `max-turns`, `max-work`, `audit`, `semantic`, `ci` | per **step** (catalogue): `min-class`, `needs`, `max-turns`, `max-work`, `audit`, `semantic`, `ci`; per **persona**: `parallel` (§9), the breaker's `max-red`, the budget (exists); per board: `token-budget` |
| column `persona:` (the ladder's middle) | gone — the chain says who |
| `crew.md` `default-persona` (the ladder's floor) | retired: read with a warning, never used; Settings drops the field; req-261's `pinned` refusal for it goes |
| `<step>-default` personas created by `migrateLegacyPersonas` | not created any more; existing ones stay ordinary personas until the owner deletes them (req-261) |
| the ring run (no persona → assignment ring + step prompt) | gone for ticket steps: no persona, no run; free sessions and 1:1s keep their own persona choice (R12) |
| `role:` sorts the crew (`inPipelineOrder`) and picks a seeded prompt (`CREW_STEPS`) | free label; the crew order is the standard flow's order (§10); seeding gives each shipped persona its `steps:` instead of a prompt copy |
| `x-persona` ticket pin | retired into the chain; a plan part's `persona:` becomes its build step's persona |

**CI and commit steps.** A step of mode `machine` (a `ci:` command, the merge
of `commit`) has no persona and takes no model slot (it takes a governor
*heavy* seat, as tests do today). On the board it stays in the column of the
step before it, with the status `merging · CI` and no action badge (draft:
T-0117 at You after Acceptance). Red → the catalogue's `on-red:` step (default:
the step before) as a send-back, counted against `max-returns`.

## 9. Capacity, the pool and the governor

- **The pool is unchanged** (R10, ADR-0095): a run asks for a class — the
  ticket's `class:` / `size:`, raised to the step's `min-class` (today the
  column's) — from the holder's model pool, and gets exactly that class or
  waits (`queued · waits for a B slot`). The routing within the class (req-178),
  the slots, the ledgers and the tranche stay.
- **Per persona:** `parallel:` on `persona.md` (absent = no cap; the pool still
  limits). It is what makes *"waits for Ben"* (persona at its cap) different
  from *"waits for a B slot"* (pool full) on the card. Column header: `Ben 3 ·
  2 of 2 running`. A cap is enforced, unlike today's column `wip:` which
  nothing reads (§0).
- **The breaker** counts red gates per persona (and per step, for the report)
  instead of per column; a tripped persona is *held* the way a column is today
  (`ColumnMode` → a persona mode), shown on its column header and as today's
  chain alert.
- **Dispatch order:** priority class first (unchanged), then *finishing beats
  starting* by the cursor's position in the chain (later steps first) instead of
  the rightmost column, then the board's rank.
- **The governor** is unchanged (light seats for model runs, heavy seats for
  tests, builds and machine steps).
- **The human persona** never takes a slot, a seat or a budget (unchanged).

## 10. Metrics

- **Per persona:** runs, cost (exists: the persona's daily budget figure),
  red gates, send-backs it issued and received, time held (from the cursor's
  moves), the journal grouped by model (R14, exists).
- **Per step:** duration (busy time of its runs, from run telemetry, which
  gains the step id) and waiting time (from the cursor's moves). The cursor's
  moves are written as `step` lines into the meta vault's ledger
  (`tickets/_meta/ledger.jsonl`; ADR-0090 E14-6 keeps the ledger there and
  writes no `phase` lines on a store), so no per-ticket reading of the store's
  git history is needed (`dk log`, R-07, is not shipped as far as I could
  tell).
- **Board:** "Cost by column" becomes **Cost by persona**.

## 11. Every surface and what changes

| Surface | Today (where the columns come from) | Persona board |
|---|---|---|
| **Desktop Board, 7e** (`plugins/tickets/renderer/board/board-model.ts` 98–194, `board-view.ts`) | one column per pipeline phase; the card's persona is the live run's, else `x-persona`, else the column's (139–142); the last phase is "Done this week"; no drag (the context menu's *Move to ▸*, `renderer/index.ts` 2845–2880) | columns Inbox · Prioritized · the holders in crew order · You · Done; the card's step line with a step bar, status line, badges *Question / Accept / No persona / Sent back*; **drag** between columns (§4); empty agent persona columns fold into a *+ n personas* chip (question 11); *Move to ▸* lists holders |
| **Capacity band** (`renderer/team/capacity-view.ts`, `capacity-model.ts`) | persona row, slot chips, tranche row — none by phase | the persona row reads its counts from the same holders (`2 of 2 · 1 waiting`); the band is the board's column header in small; slots and tranche unchanged |
| **Tickets panel** (`renderer/work-groups.ts` 199–321) | fixed groups Needs you · Shaping · Running · Ideas · Done, keyed on stage ids `SHAPING_STATE`, `READY_STATE`; `runningStepOf` hard-codes *Planning/Building/Merging* on phase ids (420) | groups Needs you · Running · Prioritized · Inbox · Done; the row meta `T-0129 · Ralf · Architecture 3/6`; the step word from the catalogue's title, no hard-coded phase ids |
| **Mission Control desk** (`libs/mission-ui/src/work/work.model.ts` 753 `groupsOf`) | Needs you, then one vertical group per non-empty pipeline column | Needs you, then one group per holder (crew order), You's approvals inside Needs you; swipe right = *Accept / next step* only at You |
| **Mission Control iPad / phone** (`phone-rows.ts` 118, hard-coded phase titles 41–45) | rows grouped by matching phase titles (`building` → "Running") | rows grouped by holder; the hard-coded title list goes; meta `id · step n/m · word`. The phone does not change the argument (it is a grouped list either way), so the draft has no phone variant |
| **Flow editor** (`renderer/flow/*`, `libs/mission-ui/src/flow/*`) | edits the delta as steps | edits the list; persona picker filtered by `steps:`; send-back target and `max-returns` shown |
| **Team / Crew** (`libs/mission-ui/src/team/team.ts` 241: the phases each persona serves) | phases per persona | the persona's `steps:` and what it holds now |
| **Persona page, 7k** | "Steps Ben can take" read-only chips | editable `steps:`, `parallel:` in Work |
| **Drey Service window** (`apps/service-window/.../session-list.ts` 50: `T-0121 · build · Ben`) | phase as text | step as text (`T-0121 · Architecture · Ralf`) — wording only |
| **Board 10t, Autopilot** | no columns | none; the early-stop rows name the step instead of the phase (`shared/tranche.ts` 194–229) |
| **Board 10u, MCCards** | rows `T-0119 · build · Ben · red twice` | same with the step; a new card kind *No persona for a step* (assign / do it myself) and *Send-back limit reached* |
| **Settings → Tickets → Pipeline** (`renderer/settings-columns.ts`) | edits the columns and their handover keys | lifecycle columns read-only (they mirror `dricket.toml`, Q-05), the standard flow as a step list, and a new **Steps** page for the catalogue |
| **Legacy remote PWA** (`plugins/tickets/remote/kanban.ts`) | the one side-by-side kanban with WIP | follows the same DTO; it is served only without `dist/mission-control` (`server/client-dir.ts`) — or is retired with E14-9b |

The canvas boards 7e, 7k, 10u and the Mission Control work boards are drawn on
phases today; per the fidelity rule they are redrawn on the canvas from this
draft before any screen is built (first row of §14).

## 12. Migration

**The owner's live board** (snapshot of 2026-11-11, §0): nothing stands in
shaping, prioritized, building or ready, so no ticket needs a holder.

1. Add `active` and `running` to `dricket.toml`'s stages, `claim =
   ["running"]` (by hand, Q-05; R-03 replays old history under the old set).
2. Re-check that `shaping`, `building` and `ready` are empty, then remove them.
   Any ticket that stands there by then: `shaping` → `active` at `shape(paul)`;
   `building` → `active` at `build(ben)` with the standard flow copied from
   `build` on; `ready` → `active` at `acceptance(you)`. (`x-legacy-phase` stays
   untouched.)
3. `pipeline.md`: phases Inbox, Prioritized, Done; `flow: plan(paul);
   build(ben); review(ralf); test(tessa); acceptance(you); commit` — one commit.
   The Building handover keys move per §8; `token-budget: 40000000` stays a
   board key.
4. `_meta/steps/` seeded from the shipped catalogue; the vault's own
   `_meta/prompts/*.md` that differ from the shipped ones become the step text
   (reported, so the owner's edits survive).
5. Seeded crew: `steps:` written (Paul `[shape, plan, research]`, Ben
   `[build]`, Ralf `[review, architecture]`, Tessa `[test]`), the duplicated
   step section removed from `prompt.md` (§5).
6. `build-default` and `commit-default` stay as personas, unpinned (question
   12).
7. Archived and done tickets keep their `x-chain` delta text as history; the
   reader treats a chain that does not parse as a list on a `done` ticket as
   absent.

**A fresh board.** "Initialize board" writes the five-stage `dricket.toml`,
the three lifecycle columns plus `flow:`, the catalogue, and seeds the crew
with `steps:` (req-256's seeding, unchanged otherwise).

**Files backend.** The files backend's folders are the phases; the persona
board is dricket-only. Until E14-9b removes the files backend, a files vault
keeps the phase board.

## 12a. The owner's answers (2026-11-11)

The owner answered questions 3, 4, 9, 12 and 15 and, with them, parts of 6, 8
and 16. In his words where they decide something, then what follows for the
concept.

- **Q3 — Shaping is Paul's step.** "ja das ist bei paul": the `shape` step,
  held by Paul, entered from Inbox (option a).
- **Q4 — A send-back invalidates.** "die müssen alle erneut durchlaufen
  werden, es handelt sich dabei um eine invalidierung eines vorherigen
  schritts und dann müssen alle nachfolgenden invalidierten erneut durchlaufen
  werden": a send-back to step *k* marks step *k* and every later step of the
  chain **invalid**; the chain runs forward from *k* and every invalidated step
  runs again (option a). The ticket's status log records the invalidation with
  its reason; a step's earlier result stays readable as history, it is no
  longer its verdict.
- **Q9 — A big pool and a pool per persona.** "Es soll einen großen Pool geben
  und pro Persona ebenfalls einen Pool. Der Persona-Pool bedient sich aber aus
  dem großen, das heißt es könnte passieren, dass eine Persona Slots hat, aber
  der Gesamtpool keine mehr, dann darf auch nichts bearbeitet werden. Ggf. fügt
  man noch eine Min-Zahl hinzu, bei dem es dann aber eine Überschreitung des
  Max-Kontingents geben könnte." So: each persona has a **maximum** of
  parallel runs (`parallel:` of §9); a run needs a free place in its persona's
  pool **and** in the big pool (ADR-0095's cap and slots); one of the two full
  = it waits, and the card says which (`waits for Ben` / `waits for a B slot`).
  **Optional, to decide when built:** a persona **minimum** — up to that many
  runs of the persona start even when the big pool is full, and then the big
  pool's maximum is exceeded on purpose. The overrun is shown on the Capacity
  band and counts in the ledgers like any run.
- **Q12, Q16 and the end of the chain.** "build ist bei Ben, das Commit ist der
  Sign-off-Schritt, der wird nach Human Review gesetzt und danach wird
  committet, wichtig an der Stelle ist, dass vorher der main reingemerged wird
  damit man die Wahrscheinlichkeit erhöht, dass es keinen Merge-Konflikt mehr
  nach dem Test beim Merge gibt. build-default und commit-default entfallen."
  So:
  - the `build` step belongs to **Ben** in the standard flow;
  - a **machine step `sync-main`** merges `main` into the ticket's branch
    **before the test**, so the test runs on what will be merged and the
    final merge after the human review rarely conflicts; a conflict in
    `sync-main` is a send-back to `build` (it invalidates build and what
    follows, Q4);
  - **acceptance** is the human review at You; the owner's **sign-off** is
    the act that ends it, and the **commit** (the merge into `main`) follows
    as a machine step with no persona and no model (Q16 option a: the
    commit is not a persona step);
  - the standard flow therefore reads
    `shape(paul) → plan(paul) → build(ben) → review(ralf) → sync-main → test(tessa) → acceptance(you) → commit`;
  - **`build-default` and `commit-default` go**: the migration of the live
    board removes both folders (one commit each, req-261's route, with the
    owner's confirmation) and assigns their steps to Ben and to the machine
    commit (Q12 option b, not the recommended a).
- **Q15 and Q8 — The default flow is written into a new ticket at creation.**
  "beim Anlegen eines neuen Tickets soll der Default-Ablauf in das Ticket
  eingetragen werden, dann kann manuell oder durch einen der Planer das noch
  angepasst werden." So: the standard flow is copied into `x-chain` **when the
  ticket is created** (not when it starts, a change against §6's "copy at
  start"); from then on the ticket's chain is its own (Q8 option a); the owner
  edits it by hand, Paul with the plan, Pia as a card. A later change of the
  standard flow does not touch existing tickets.

Still open: questions 1, 2, 5, 6 (where a machine step shows on the board),
7, 10, 11, 13 and 14, and the Q9 minimum.

## 12b. The owner's correction: the chain is a list of personas (2026-11-11)

**This section supersedes §2's *Step*, §5 (the step catalogue and the
composition) and question 13, and changes §3, §4, §6 and §8 where they speak
of steps.** The owner, on the step catalogue: "warum sind wir jetzt wieder bei
den Schritten zurück? Er soll anzeigen, an welche Personas das geht, die haben
eine Rolle, welche über die Prompts definiert sind. Und es kann heißen Pia,
Paul, Ben, Tessa, You oder Pia, You, und das definiert genau die Schritte …
das heißt, es ist mir vollkommen egal, welche Schritte eine Person kriegt, sie
macht das, was in ihrer Rolle steht."

So the model has **no step as a separate thing**:

- **The chain is the ordered list of personas** a ticket goes through:
  `paul; ben; ralf; tessa; you`, or `pia; you`. Each entry *is* a step; what
  happens there is what the persona's `prompt.md` says (R11: the prompt is the
  persona). The same persona may appear twice (`paul; ben; paul; you`), so the
  cursor is the entry's position, not a persona id.
- **The run's instruction is the persona's prompt**, plus skills, memory and
  the ticket context as today. There is no step text to compose with it —
  req-258's "a persona's prompt replaces the step prompt" is therefore the
  intended behaviour, not a defect. What a *mode* needs is added by the
  runner as a mode wrapper, not by a step: the interactive `QUESTION:`
  protocol when Paul shapes in the Shape chat, the closing round's ask
  (milestone 229), the read-only rules of a review checkout (milestone 225).
- **The settings that §5 put on a step move to the persona**: the class floor
  (`min-class`), the model needs, the run ceilings (`max-turns`, `max-work`),
  and whether the ticket's acceptance commands gate the persona's hand-over
  (`gate:`, today the build column's).
- **No step catalogue, no `steps:` field on the persona** (question 13 falls
  away). Paul and Pia propose chains from the crew list (title, summary, the
  prompt's opening lines).
- **Machine actions belong to a persona's responsibility** (owner, Q6: "in der
  Spalte desjenigen, in dessen Verantwortlichkeit die Schritte liegen"): a
  persona record lists what the runner does when the ticket leaves it —
  e.g. the builder's `sync-main` (merge `main` into the branch before the
  ticket goes on to the test), the human persona's `commit` after the
  sign-off. The card shows the action as status in that persona's column
  (`Ben · merging main`, `You · committing`). Where exactly `sync-main` sits
  (on the builder's hand-over, or on the tester's start) is open below.

Answers of this round:

- **Q2 — `running` is shown where the run happens**: in the column of the
  persona that runs it, as the card's status (`running`, `waits for a slot`,
  `waits for Ben`). The store's `running` stage stays the claim's stage (it
  removes the two-commit workaround); the board never draws it as a column.
- **Q5 — One send-back per ticket.** "Das Ticket darf vollständig
  zurücklaufen bis zur Planung, aber nur einmal … wenn es das zweite Mal
  passiert, dann direkt zu mir." A ticket may be sent back once, to any
  earlier persona in its chain (planning included; Q4's invalidation applies);
  a second send-back does not move it back, it goes straight to You with both
  reasons. `max-returns` is 1 and not a setting.
- **Q6 — Machine actions in the responsible persona's column** (above).
- **Q7 — A question inside a running run moves the card to You** ("die Karte
  müsste dann vermutlich zu mir geschoben werden"): the run releases, the
  card stands at You with the question and the persona's name; the answer
  returns it to the same persona, which resumes (option b).
- **Q14 — Shape and Flow chat run as the persona** (option a).

Still open after this round: **Pia in a chain** (the owner's examples start
with Pia, while decision D7 makes Pia Mission Control itself, not a persona —
is Pia a persona that triages a ticket, or the one who sets the chain?);
**where `sync-main` sits**; **questions 10 and 11** (column order, wide
boards); **the Q9 minimum**. Question 1 is settled by the model: the holder
is the chain's entry at the cursor.

## 12c. The owner's answers, third round (2026-11-11)

- **Pia gets a persona.** "Pia kriegt eine Persona, damit ich ihr Infos
  mitgeben kann, wie ich gerne mit ihr interagiere." Pia stays Mission
  Control (decision D7 stands) and gains a persona record `personas/pia/`:
  her `prompt.md` is where the owner writes how he wants to work with her, and
  Mission Control's chat composes it into its system prompt; her model is
  Mission Control's. Being a persona, Pia can also stand in a chain, as in the
  owner's example `pia; you` (e.g. a ticket Pia answers herself). She ships
  with the default crew (milestone 235's seeder gains her) and cannot be
  deleted while Mission Control uses her (req-261's refusals).
- **`sync-main` is the builder's last action.** "sync-main vor dem Test, ist
  der letzte Schritt vom Builder": the builder persona's record names
  `sync-main` as its leaving action; it runs after the builder's run and its
  gate, before the ticket moves on, and shows as `Ben · merging main`. A merge
  conflict there is the builder's: the card stays with Ben with the conflict as
  the reason (it is not a send-back and does not count against Q5's one
  send-back).
- **Column order = the order of the personas in the team, and it can be
  changed.** "Reihenfolge der Spalten richten sich nach der Reihenfolge der
  Personas im Team, Reihenfolge soll geändert werden können." The crew gets an
  explicit order (`order:` in `_meta/crew.md`, the seeder writes the default
  crew's order); the owner changes it by dragging a persona in the Crew tab or
  a column header on the Board. You is placed by the same order (default
  last), Inbox and Prioritized stay left, Done right. **Tickets are dragged
  between columns** (§4: a card dropped on another persona hands the current
  entry of its chain to that persona; refused while it runs — the card then
  offers *Stop and hand to …*).
- **The Q9 minimum is 0 by default.** "Das Pool-Minimum ist auf 0 bei
  Default und kann übersteuert werden in der Konfiguration, aber
  standardmäßig muss alles im Pool bleiben." `min:` per persona, default 0,
  set only in the configuration (no Settings field needed for the first cut);
  with 0 nothing ever exceeds the big pool.

Still open: **question 11** (wide boards). With it answered the concept is
complete for the owner's approval.

## 13. Open questions for the owner

Each with the options and the recommendation (first).

1. **Where does the holder live?** (a) derived from `x-chain` + `x-step`
   **(recommended)**; (b) `x-holder` stored beside them; (c) a native dricket
   `assignee` (a new R-xx). — One truth; (c) can come later as a Nice for foreign
   readers.
2. **How does a step end without R-31?** (a) a `running` claim stage, step end =
   one `commit --release --stage active` **(recommended)**; (b) R-31 raised from
   Nice to Needed in dricket; (c) keep today's two commits with the card
   flickering through Prioritized at every step end.
3. **Shaping.** (a) a `shape` step held by Paul, entered from Inbox, ending in
   *Start* or *Queue* **(recommended)**; (b) Shaping stays a lifecycle column
   before Prioritized; (c) shaping happens in Inbox as a status.
4. **After a send-back, where does the chain continue?** (a) forward from the
   target, every step in between again **(recommended — a fix after Test is
   reviewed again)**; (b) straight back to the sender; (c) the sender chooses
   per send-back.
5. **The send-back limit.** (a) per ticket, crew default 3, a step may lower it
   **(recommended)**; (b) per pair of steps; (c) no limit, the breaker only.
6. **Machine steps on the board.** (a) status in the previous holder's column
   **(recommended)**; (b) a column of their own ("CI"); (c) always at You.
7. **Answered 2026-11-11: (b), the card moves to You, §12b.** **A question inside a running step.** (a) the card stays with its holder,
   badge *Question* + Needs-you card **(recommended)**; (b) the card moves to
   You until answered.
8. **Answered 2026-11-11 with Q15: (a), copied at creation, §12a.** **The standard flow on a ticket.** (a) copied into the ticket at start, then
   the ticket's own **(recommended)**; (b) applied live like today's delta.
9. **Answered 2026-11-11: a persona pool inside the big pool, an optional minimum, §12a.** **Parallel runs of one persona.** (a) `parallel:` per persona, absent = no
   cap **(recommended)**; (b) no persona cap, the pool only.
10. **Answered 2026-11-11: the team's order, changeable by drag, §12c.** **Column order.** (a) the standard flow's order, other personas by title,
    You last **(recommended)**; (b) a manual order in `crew.md`; (c) by role.
11. **Wide boards.** (a) agent persona columns that hold nothing fold into a
    *+ n personas* chip **(recommended)**; (b) always all columns; (c) a per-view
    choice.
12. **Answered 2026-11-11: (b), both go, §12a.** **`build-default` and `commit-default` on the live board.** (a) kept as
    ordinary personas, unpinned, the owner deletes them **(recommended)**;
    (b) their prompts folded into Ben and a commit step, the folders deleted;
    (c) kept and given steps (`build`, `commit`).
13. **Fallen away 2026-11-11: no step catalogue, no `steps:` field, §12b.** **`steps:` on the persona.** (a) a filter and a hint for Paul and Pia,
    never a fallback **(recommended)**; (b) no such field, every persona offered
    everywhere.
14. **Answered 2026-11-11: (a), §12b.** **Shape and Flow chat.** (a) the persona's character over the chat bridge
    now **(recommended)**; (b) wait until Shape is a persona session.
15. **Answered 2026-11-11: copied at creation, §12a.** **A ticket started without steps.** (a) the standard flow is copied
    **(recommended)**; (b) refused until Paul or Pia set steps.
16. **Answered 2026-11-11: (a), the commit is a machine step after the sign-off, with `sync-main` before the test, §12a.** **The machine step's persona slot.** (a) a `ci:` step has no persona and no
    model **(recommended)**; (b) `commit` stays a persona step (today
    `commit-default` is an owner-started agent run).

## 14. Proposed roadmap rows, in build order

Ids are the integrator's. Sizes are rough.

| # | Title | Replaces / touches |
|---|---|---|
| 1 | **Persona board on the canvas** — redraw 7e, the Tickets panel, Mission Control work (desk, iPad, phone), 10u's new cards and 7k's Work block from this draft; owner acceptance (fidelity rule) | boards 7e, 7k, 10u, MPadWork, MPhone* |
| 2 | **Lifecycle stages on the store** — `inbox prioritized active running done`, `claim = ["running"]`; the reader maps stages to lifecycle columns + holders; the run lease's release targets; live and fresh board migration (§12 steps 1–2) | ADR-0090 later change; `core/pipeline-states.ts`, `fleet/dk-target.ts`, `fleet/run-lease.ts` |
| 3 | **The step catalogue and the composition** — `_meta/steps/`, persona + step instruction, the interactive step, version marker and reset, seeded prompts de-duplicated, persona `steps:` | **absorbs req-258 and req-260**; `fleet/request-instruction.ts`, `core/default-crew.ts`, `specs/classifier-spec.md` |
| 4 | **The chain as a step list** — `x-chain` full list + `x-step` + `x-returns`, `flow:` in `pipeline.md`, copy at start, `validateSteps`, the flow editor writes lists, parts' chains, `### Steps` in the plan | `core/chain-delta.ts`, `core/flow-edit.ts`, `core/plan-parts.ts`, `specs/ticket-schema.md` |
| 5 | **The runner on steps** — dispatch by the current step's persona; no persona → stands at You with a reason; step end = one release; send-back with a named target and `max-returns`; machine steps; per-persona `parallel:` and breaker; dispatch order by cursor; retire `default-persona`, the ring run for ticket steps and `migrateLegacyPersonas` | **closes req-257**; `core/persona.ts`, `fleet/orchestrate/board-personas.ts`, `dispatcher.ts`, `breaker.ts`, `services/board-service.ts` |
| 6 | **Board DTO and moves** — holder, step, step n/m, wait reason on the card; start, drag between holders, Accept / Send back with a target, park | `contracts/tickets.ts`, `services/board-service.ts`, `server/router.ts` |
| 7 | **Desktop Board, Tickets panel and Capacity band** per the accepted boards, with drag | `plugins/tickets/renderer/board/**`, `work-groups.ts`, `team/capacity-*` |
| 8 | **Shape and Flow chat as the assigned persona** — prompts composed from the holder and the step, roster from the crew | `services/shape-system-prompt.ts`, `services/chat-llm.ts` |
| 9 | **Mission Control desk, iPad and phone** — groups by holder, Accept / Send back, the new cards, the flow editor, team `steps:` | `libs/mission-ui/src/work/**`, `flow/**`, `team/**` |
| 10 | **Metrics per persona and step** — `step` ledger lines, telemetry step id, report grouping, Cost by persona | `fleet/telemetry.ts`, `fleet/report.ts` |
| 11 | **ADR and specs** — an ADR "the persona board" (later changes of ADR-0088 persona ladder, ADR-0077 chain, ADR-0090 stages), `specs/ticket-schema.md`, `specs/frontmatter-schema.md` where it names stages, the manual | lands with rows 2–5, not after |

Rows 3 and 4 can run in parallel after row 2; row 5 needs both; rows 7–9 need
row 1's accepted boards and row 6.

## 15. What this session did not do

No code under `plugins/`, `packages/`, `libs/` or `apps/` changed; no spec
except the req-257 row's link; no changelog entry (no milestone). The owner's
store, meta vault and `~/.drey-engine` were read, not written. The canvas
boards are not drawn — the draft is a repository file for the decision.
