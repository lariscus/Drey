# The persona board — concept for req-257 (2026-11-11)

Status: **Approved by the owner on 2026-11-11** (all questions answered the
same day). Built as roadmap rows req-264 … req-275, req-257 and req-258, in
the order of §15. Nothing is built yet. Roadmap row req-257 asked for *"a concept with a
board draft on the dricket store … then the owner's approval, then rows and
sessions."* This note is the concept in its final form: the first version was
corrected by the owner in three rounds on 2026-11-11, and this rewrite folds
all three into one document. The board draft lives beside it:

| File | What |
|---|---|
| `persona-board/persona-board-mockup.html` | Board 7e redrawn: Inbox · Prioritized · the team in team order · You · Done, the position in the chain on the card; then the same board with the personas named Plan · Build · Review · Test |

Every statement about today's behaviour names the file it comes from. Where I
did not verify something, the text says so. Where the owner's rulings leave a
gap, §14 lists the reading this document uses, for the owner to confirm; it is
not a new decision.

## 0. What exists today (the findings the concept rests on)

Paths are under `packages/tickets-engine/src/` unless they start elsewhere.

**The board is the pipeline.** Every surface's column list is
`BoardSnapshot.columns`, built from `_meta/pipeline.md`'s phases in order plus
unknown directories (`core/ticket-board.ts` 631–655). On the dricket store a
record's `stage` *is* the phase id ("variant A", `store/legacy-bridge.ts`); the
shipped stages are hard-coded as `STATE_IDS` = `inbox shaping prioritized
building ready done` and the claim stage is `building`
(`core/pipeline-states.ts` 12, 19).

**A chain is a list of pipeline phases — the largest gap.** The chain grammar
(`core/chain-delta.ts`, `specs/ticket-schema.md` "The chain delta") only knows
*pipeline phases*: `insert <phase>(<persona>) after <anchor>` is refused for a
phase the pipeline does not contain (`validateChain`), the only exception being
`manual` / `manual-<word>`. The six-stage default has exactly one agent phase,
`building`; `pipeline.md`'s prose says *"plan, build, review and test are
phases of the chain inside it"*, but no code runs them as separate entries: one
run of `build-default` (or of the persona's prompt) does the whole of Building,
and the runner's green end moves the ticket one column right
(`fleet/chain.ts` header comment; agent lane rules in `specs/ticket-schema.md`).
So a per-ticket sequence of personas — `paul; ben; ralf; tessa; you` — does not
exist today in any form; the owner's model needs a chain that is **decoupled
from stages**. This is the point where today's code differs most from the
owner's model.

**Persona resolution is per ticket per column, not per chain entry.**
`resolvePersona` (`core/persona.ts` 268–283) walks ticket pin (`x-persona`) →
column `persona:` → `crew.md` `default-persona` → none; `BoardPersonas.resolve`
(`fleet/orchestrate/board-personas.ts`) runs it once per card with the column's
persona. A per-entry persona exists only inside the chain delta (`insert
…(<persona>)`, `assign <phase> <persona>`). With no persona the run still
starts: the assignment ring picks a worker and the phase prompt runs (the "ring
run" of the dispatch order, `specs/ticket-schema.md`).

**A persona's prompt already replaces the phase prompt** — which the owner's
model wants. `runPrompt` (`fleet/request-instruction.ts` 71–77): the persona's
`prompt.md`, when non-empty, is the instruction base, else the phase prompt.
That is why the seeded crew (milestone 235) carries the role's text inside its
`prompt.md` (`core/default-crew.ts` `seededPromptText`: `## Who <name> is` then
`## The <step> step`). What breaks is only what a *mode* needs: Paul pinned on a
shape-mode plan loses the interactive `QUESTION:` protocol (req-258). The modes
the runner adds today are the interactive part (`fleet/request-instruction.ts`
79, `interactivePart`), the closing round's ask (`fleet/closing-round-prompt.ts`,
milestone 229) and the read-only review checkout (`fleet/instruction-sections.ts`
35–45, `fleet/orchestrate/review-checkout.ts`, milestone 225).

**What a persona record holds today** (`core/persona.ts` 82–105): id, kind
(`agent` | `human`), title, role, worker, models (default + pool), color,
summary, skills, daily budget, `allowed:` (spend above allowance, run commands,
network, write vaults). **No** class floor, model needs, run ceilings,
acceptance gate, parallel cap or leaving action: those sit on the board's
columns today (`core/phase-min-class.ts` for the class floor; `max-turns`,
`max-work`, `needs`, `wip` as pipeline column keys, `core/pipeline-phase.ts`).

**`<step>-default` personas come from the legacy-key migration.**
`BoardService.migrateLegacyPersonas` (`services/board-service.ts` ~4111) turns a
column's old `worker:` / `model:` / `prompt:` keys into a persona named after
the prompt ref or `<phase>-default` (`personaMigrationFor`, `core/persona.ts`
303). The owner's meta vault holds `build-default` and `commit-default` this
way.

**The human persona exists.** `personas/you` with `kind: human`
(`HUMAN_PERSONA_ID`, `core/persona.ts` 80); a gate it works parks the ticket
(`awaiting: you`), never takes a slot, a budget or a capacity figure (E10-6,
"The manual step" in `specs/ticket-schema.md`). The owner's `pipeline.md`
already pins `persona: you` on Inbox, Shaping, Prioritized and Ready.

**Pia is Mission Control, with no persona record.** Decision D7
(`architecture-concept-v2.md`): "Pia" is Mission Control itself, the one contact;
Paul plans. The UI names her (`libs/mission-ui/src/chat/chat.ts` 681), but her
prompt is the constant `MISSION_SYSTEM_PROMPT` (`services/chat-llm.ts` 32) and
she has no `personas/pia/`. R9 (`crew-internals-concept.md`): Pia executes, she
does not work — every unit of work is a session.

**Shape and Flow chat are hard-coded Paul.** `SHAPE_SYSTEM_PROMPT`
(`services/shape-system-prompt.ts`) and `FLOW_SYSTEM_PROMPT`
(`services/chat-llm.ts` 66) open with *"You are Paul, the planner of the
tickets crew"*, and the shape prompt also hard-codes the roster (*"persona:
<id>" (ben builds, ralf reviews, tessa tests, paul plans)*). Both are chat-bridge
calls with the assistant's LLM settings, not the persona's model
(`crew-internals-concept.md` §0).

**There is no `sync-main` and no machine commit.** A grep over the engine finds
neither. The commit is `commit-default`, an owner-started agent run
(`COMMIT_STEP_PROMPT`, `core/pipeline-states.ts` 22; the `ready` stage accepts
`commit`, `sign-off`, `review` as its phase names, line 73). Nothing merges
`main` into a ticket's branch before the test.

**`role:` carries logic in two places.** `inPipelineOrder` sorts personas by
role (`core/persona.ts` 114) and `CREW_STEPS` maps a role to the prompt a
seeded persona gets (`core/default-crew.ts`). The crew has no explicit order;
`crew.md` (`core/crew-file.ts`) holds `default-persona`
(`contracts/crew-config.ts` 21) and the `seeded-crew` marker
(`core/crew-seed-marker.ts`), no `order:`.

**Deleting a persona is refused while it is pinned** (req-261,
`contracts/persona-remove.ts`: the `pinned` code, a pipeline column or the crew's
`default-persona` pins it; `services/persona-pin-reader.ts`).

**What the store offers (dk ≥ 0.6, ADR-0090 and `dricket-requirements.md`).**
`x-<name>` extension fields (R-01, shipped as specified: single-line,
size-capped, never interpreted — the exact byte cap I did not check);
configurable `[stages]` with `claim` stages (R-03; `validate` replays history
with the stage set of each commit); every human edit or move is one `dk put -F
--claim --if-version` commit (R-24; `dk set` / `dk move` were removed again in
v0.6.0); a run claims (`dk claim`, which moves the ticket into the first claim
stage), writes inside its claim (`put -F`), and ends with `release --stage S` or
`commit --release --stage S`; **an agent may not release into the stage it is
in** (R-31, exit 14) — Drey works around it with a release one stage back plus a
`put --claim` (two commits, owner decision 2026-11-05: "R-31 not needed").
Drey's own ticket keys already ride as extension fields: `EXTENSION_KEYS` =
worker, persona, track, form, proof, awaiting, class, model, size, allowance,
needs (`store/extension-keys.ts` 7), plus `x-chain` (entries joined by `;`,
`store/legacy-bridge.ts` 85–86) and `x-rank`.

**WIP is a label.** `wip:` is parsed (`core/pipeline-phase.ts`) but no engine
code reads it; only the legacy remote PWA draws it (`plugins/tickets/remote/kanban.ts`
110). Parallelism is the capacity pool and the slots
(`fleet/orchestrate/dispatcher.ts`, `PoolCapacity`), plus the per-column breaker
(`fleet/orchestrate/breaker.ts`, `max-red`, default 3) and the column's `held`
mode (`fleet/protocol-chain.ts`).

**The owner's live board (read-only, 2026-11-11).** Store
`E:\projects\drey-board`, `dricket.toml` on `main` (re-read for this rewrite):
stages `inbox shaping prioritized building ready done`, `claim = ["building"]`.
The first version counted 92 tickets there — 71 `done` (66 labelled `archived`)
and 21 `inbox`, **nothing in shaping, prioritized, building or ready**; I did
not recount. The meta vault's `pipeline.md` pins `persona: build-default` and
`handover: agent build-default` on Building (`wip: 3`, `token-budget:
40000000`); `crew.md` has no `default-persona` and carries `seeded-crew: [paul,
ben, ralf, tessa]`; the personas are `ben build-default commit-default paul
ralf tessa you`.

## 1. The owner's rulings

Every ruling of 2026-11-10/11, with its date and where the concept uses it. The
first group is recorded in English in `specs/decisions.md` ("A role fallback in
the persona ladder", 2026-11-11), in roadmap row req-257 and in the integrator's
relay; the later groups are the owner's own words, German as given, with the
English meaning after the dash.

### The first group (2026-11-10/11)

1. **No role fallback (2026-11-11).** *"Everything hangs on the personas, not on
   roles — two builders build differently ('Bob the Builder and Rubble from Paw
   Patrol both build, but not alike'), so a role says nothing about who should
   take a step; where the owner wants the same character several times, that is
   one persona running several tickets at once."* Rejected with it:
   `default-persona` set at seeding. *"The `role:` field stays a free label
   without logic."*
2. **No persona, no run (2026-11-11).** *"A step with no persona from the ticket
   or the column does not run: the ticket stands at the human persona as a
   manual step and says why."*
3. **Chains per ticket (2026-11-10/11).** What a ticket goes through is set per
   ticket by **Paul** (with the plan) or **Pia** (Mission Control, as a card).
4. **Send-back anywhere earlier (2026-11-10/11).** *"A step may send a ticket
   back to any earlier step, up and down the chain."*
5. **Columns are holders (2026-11-11).** *"The board's columns are the personas
   that hold a ticket, the step is status on the card."*
6. **The phase board is a special case (2026-11-11, relayed).** *"If I name the
   personas after phases I have my phase board again — we gain flexibility."*

### The first round of answers (2026-11-11)

7. **Shaping is Paul's.** „ja das ist bei paul" — Shape is Paul's entry, entered
   from Inbox.
8. **A send-back invalidates.** „die müssen alle erneut durchlaufen werden, es
   handelt sich dabei um eine invalidierung eines vorherigen schritts und dann
   müssen alle nachfolgenden invalidierten erneut durchlaufen werden" — a
   send-back to entry *k* invalidates *k* and every later entry; all run again.
9. **A big pool and a pool per persona.** „Es soll einen großen Pool geben und pro
   Persona ebenfalls einen Pool. Der Persona-Pool bedient sich aber aus dem
   großen, das heißt es könnte passieren, dass eine Persona Slots hat, aber der
   Gesamtpool keine mehr, dann darf auch nichts bearbeitet werden. Ggf. fügt man
   noch eine Min-Zahl hinzu, bei dem es dann aber eine Überschreitung des
   Max-Kontingents geben könnte." — each persona has a maximum of parallel runs
   inside the big pool; a run needs room in both; an optional minimum may
   overrun the big pool on purpose.
10. **Build, sign-off, commit, `main` first; the two defaults go.** „build ist bei
    Ben, das Commit ist der Sign-off-Schritt, der wird nach Human Review gesetzt
    und danach wird committet, wichtig an der Stelle ist, dass vorher der main
    reingemerged wird damit man die Wahrscheinlichkeit erhöht, dass es keinen
    Merge-Konflikt mehr nach dem Test beim Merge gibt. build-default und
    commit-default entfallen."
11. **The default flow is written into a ticket at creation.** „beim Anlegen eines
    neuen Tickets soll der Default-Ablauf in das Ticket eingetragen werden, dann
    kann manuell oder durch einen der Planer das noch angepasst werden."

### The second round (2026-11-11): the chain is a list of personas

12. **No step catalogue.** „warum sind wir jetzt wieder bei den Schritten zurück?
    Er soll anzeigen, an welche Personas das geht, die haben eine Rolle, welche
    über die Prompts definiert sind. Und es kann heißen Pia, Paul, Ben, Tessa,
    You oder Pia, You, und das definiert genau die Schritte … das heißt, es ist
    mir vollkommen egal, welche Schritte eine Person kriegt, sie macht das, was
    in ihrer Rolle steht."
13. **Machine actions in the responsible persona's column** (Q6). „in der Spalte
    desjenigen, in dessen Verantwortlichkeit die Schritte liegen".
14. **One send-back per ticket** (Q5). „Das Ticket darf vollständig zurücklaufen
    bis zur Planung, aber nur einmal … wenn es das zweite Mal passiert, dann
    direkt zu mir."
15. **A question inside a run moves the card to You** (Q7). „die Karte müsste dann
    vermutlich zu mir geschoben werden".
16. **A running card is shown in the running persona's column** (Q2) — `running`
    is a status on the card, not a column.
17. **Shape and Flow chat run as the persona** (Q14).

### The third round (2026-11-11)

18. **Pia gets a persona.** „Pia kriegt eine Persona, damit ich ihr Infos
    mitgeben kann, wie ich gerne mit ihr interagiere."
19. **`sync-main` is the builder's last action.** „sync-main vor dem Test, ist der
    letzte Schritt vom Builder".
20. **Column order = the team's order, changeable.** „Reihenfolge der Spalten
    richten sich nach der Reihenfolge der Personas im Team, Reihenfolge soll
    geändert werden können."
21. **The pool minimum is 0 by default.** „Das Pool-Minimum ist auf 0 bei Default
    und kann übersteuert werden in der Konfiguration, aber standardmäßig muss
    alles im Pool bleiben."
22. **Wide boards fold** (Q11): agent persona columns that hold no ticket fold
    into a *+ n personas* chip; the chip opens them for a drop.

Earlier rulings this concept keeps: R10 (a session requests a class and gets
exactly it or waits, no downgrade), R11 (the prompt *is* the persona), R12/R13
(sessions as records, three configuration layers) from
`crew-internals-concept.md`; ADR-0090 (gaps in dricket are dricket requirements,
not Drey workarounds; personas, flows and chains stay Drey's).

## 2. The model

Six words carry it.

- **Stage** — where a ticket is in its *life*: `inbox`, `prioritized`, `active`,
  `done` (and dricket's reserved `cancelled`), plus `running`, the claim's own
  stage while a run holds the ticket (§3). A stage says nothing about who works
  it.
- **Chain** — the ticket's ordered **list of personas**: `paul; ben; ralf;
  tessa; you`, or `pia; you`. Each entry is one step of the ticket's way; **what
  happens there is what that persona's `prompt.md` says** (R11: the prompt is the
  persona). The same persona may appear twice (`paul; ben; paul; you`), so the
  position, not the persona id, is what the cursor points at. There is no
  catalogue of steps, no step settings, no `steps:` field on a persona.
- **Cursor** — the position of the current entry (1-based). It exists while the
  ticket is `active` or `running`.
- **Holder** — the persona of the entry at the cursor, **derived** by one rule
  (§3). The board's columns are the holders. A ticket whose entry names no
  readable persona stands at **You** with the reason (*"no persona for position
  4"*); an entry that *is* You is held by You with an action (Accept / Send
  back); a ticket waiting for an answer stands at You too (§4).
- **Leaving action** — machine work the runner does in a persona's column when
  the ticket leaves it, listed on the persona record: the builder's `sync-main`
  (merge `main` into the ticket's branch before the ticket goes on), You's
  `commit` (the merge into `main`) after the owner's sign-off. A leaving action
  takes no model slot and no persona of its own.
- **Mode** — what a run needs beyond the persona's prompt, added by the runner as
  a wrapper: the interactive question protocol when Paul shapes in the Shape
  chat, the closing round's ask, the read-only rules of a review checkout.

Consequences of the model:

- **The phase board is a special case, not a mode.** Name four personas *Plan*,
  *Build*, *Review*, *Test* and give a ticket the chain `plan; build; review;
  test; you`, and the persona board draws exactly the old phase board (state 2
  of the draft). Nothing in the engine knows which of the two the owner has;
  there is no setting.
- **One persona, several tickets at once.** Ben holding three tickets is three
  cards in Ben's column; how many of them run at once is capacity (§9), not a
  copy of Ben.
- **The position is status, not a column.** A card says `Ben · 3 of 6` with the
  chain as small initials (`PA PA BE RA TE YO`) and whether it runs, waits for a
  slot, waits for its persona, or was sent back. The column says who.
- **Lifecycle stays outside the crew.** Inbox, Prioritized and Done are columns
  of their own at the board's edges; a ticket there has no holder.
- **Parallel work is parts, not parallel entries.** A chain is a sequence. A plan
  that splits work keeps today's `### Parts` (each part its own ticket and chain,
  `specs/ticket-schema.md` "Parts").
- **The standard flow** reads, in the owner's words for the shipped crew,
  `shape(paul) → plan(paul) → build(ben) → review(ralf) → test(tessa) →
  acceptance(you)`, i.e. the chain `paul; paul; ben; ralf; tessa; you`, with
  Ben's `sync-main` and You's `commit` as leaving actions. It is written into a
  ticket **at creation** (§6) and is then the ticket's own.

## 3. The data on the dricket store

### The options

| | Shape | For | Against |
|---|---|---|---|
| **A** | `x-holder: ben` stored beside the chain | one read per card; a foreign `dk` reader sees the holder | two truths: the holder can disagree with the chain's entry at the cursor (a drag that writes one, a hand edit, a Paul replan that writes the other); needs a drift check |
| **B** | personas as dricket stages (`[stages] values = [inbox, prioritized, paul, ben, ralf, tessa, you, done]`) | `dk ls --stage ben` works without Drey | the crew is in `dricket.toml` on protected `main`, edited by hand (Q-05); every persona added, renamed or deleted changes the vocabulary and migrates tickets; the claim hangs on stages, so every persona stage is a claim stage and dk moves a claimed ticket into the *first* claim stage (`paul`), which is wrong for Ben's runs; a stage cannot say which position of the chain; a phase board would need a second stage set |
| **C** | the full chain as `x-chain` + the cursor `x-at`; **the holder is derived** | one truth; a drag is one edit of the chain; renaming a persona touches only the tickets that name it, never the store's config; the phase board falls out | a foreign `dk` reader must parse `x-chain` to know the holder |
| **D** | a native dricket `assignee` field (a new R-xx) + a cursor | trackers have assignees; `dk ls --assignee` | the holder is a persona, which ADR-0090 decision 7 keeps Drey's; a field dricket would have to interpret for filtering; one more dricket release before the board can be built; still two truths with the chain |

### Decision: C, with lifecycle stages and a claim stage of its own

```
stage:       inbox | prioritized | active | running | done      (cancelled reserved)
x-chain:     paul:shape; paul; ben; ralf; tessa; you
x-at:        3
x-sent-back: 5>3                      (from position 5 to position 3 — present once the ticket was sent back)
x-awaiting:  you                      (exists today: a question, or a ticket the owner must decide)
```

```toml
[stages]
values    = ["inbox", "prioritized", "active", "running", "done"]
initial   = "inbox"
terminal  = ["done"]
claim     = ["running"]
cancelled = "cancelled"
```

**The holder rule** (one function, used by every surface):

1. The stage is `inbox`, `prioritized` or `done` → no holder; the lifecycle
   column.
2. `x-awaiting: you` → **You**, the card names the persona it came from
   (*Question* badge, §4).
3. The entry at `x-at` names no readable persona (deleted, misspelled, empty) →
   **You**, with *no persona for position n*.
4. Otherwise the persona of the entry (`you` is the human persona).

Why:

1. **One truth.** The chain says who takes which position; the cursor says
   which one is current; the holder follows. A Paul replan that changes the
   current entry moves the card, which is what happened. Nothing can drift.
2. **The crew never touches `dricket.toml`.** Personas come and go with
   `_meta/personas/` (req-261 deletes one); the store's vocabulary is the five
   lifecycle stages and changes only when the lifecycle does.
3. **`running` as its own claim stage removes the R-31 problem without a dricket
   change.** In the persona board *every* run end is a release back into the
   stage the ticket lives in — with today's single claim stage that is the
   refused `building → building`, worked around by two commits that move the
   card a stage back and return it (the E14-5b later change of ADR-0090). With
   `claim = ["running"]`, `dk claim` moves `active → running` by itself, and the
   end of a run is **one** `dk commit --release --stage active` carrying the
   advanced `x-at` (R-24, shipped in v0.6.0). The stage also tells a foreign
   reader that a run holds the lease. (The alternative would have been raising
   **R-31 from Nice to Needed** as a dricket requirement; not taken.) The
   board never draws `running` as a column: the card stays in its persona's
   column with the status `running`.
4. **No new dricket requirement for the board itself.** Extension fields,
   configurable stages, `put --claim`, `commit --release --stage` all exist. The
   board is built from the checkout's files as today (ADR-0090 later change
   E14-4), so derivation costs nothing per card.
5. **D stays open as a Nice** for when someone uses the store without Drey; it
   is not needed now and would add the two-truths problem.

`x-chain` keeps its key (`store/legacy-bridge.ts` 85–86) and its `;` separator,
but its **content changes from a delta to the full list** (§6). An entry is a
persona id, optionally with a mode (`:shape`, §14) and today's `(notify)`
attribute. One line stays well under any sane cap: six entries are about 40
bytes. `x-persona` (the ticket pin) retires: a pin is now an entry of the chain.
`x-sent-back` is the only new field besides the cursor; it carries no counter
and no limit setting — the rule is one send-back (§4).

## 4. The transitions

| Move | Who | What is written (one commit unless said) |
|---|---|---|
| Create a ticket | owner, Pia (card), a capture | the standard flow is copied into `x-chain`, `x-at: 1`, stage `inbox` |
| Inbox → Prioritized | owner (drag, menu), Pia (card) | `put --claim`, stage |
| Inbox / Prioritized → a persona column ("start") | owner (drag), Pia (card) | stage `active`; **the dropped-on persona takes the entry at the cursor** (the rule of any drag between holders) |
| holder → holder (drag) | owner, Pia (card) | the entry at the cursor becomes the target persona; refused while the ticket is `running` — the card offers *Stop and hand to Ralf* |
| holder → You (drag) | owner | the entry becomes `you`: the owner does this position by hand |
| a run ends green | the runner | the persona's leaving actions run first (Ben: `sync-main`), then `commit --release --stage active` with `x-at` + 1; the next entry names no readable persona → the card stands at You with the reason |
| the last entry ends | the runner | the engine's `put --claim` into `done` (an agent may not release into a terminal stage, v0.5 observation #3; today's handback works the same) — for a chain that ends at You, only after the owner's sign-off and the `commit` leaving action |
| a run ends with a send-back | the runner, on the worker's structured verdict | first send-back: `x-at` → the named earlier position, `x-sent-back: from>to`, the invalidation and the reason into the status log (below); **a second send-back does not move the cursor**: `x-awaiting: you`, the card stands at You with both reasons |
| a question inside a run | the worker (`needs-decision:`) | the run releases to `active` with `x-awaiting: you`; the card stands at You with the *Question* badge and the persona's name; the answer clears it and the card returns to the same persona, which resumes (Q-03 as accepted on 2026-11-05) |
| Accept at You | owner (desktop, phone), Pia (card) | `x-at` + 1 — at the last entry: the `commit` leaving action, then `done` |
| Send back at You | owner, Pia | target picker over the earlier positions, a mandatory note, the structured feedback of E11-3 (§14, reading 6) |
| any → Prioritized ("park") | owner | stage `prioritized`, the cursor kept |
| any → Done | owner only | stage `done` |
| claim | the runner only, at a run's start | `dk claim` (`active → running`); humans never claim (their edits are `put --claim`) |

**The claim** stays exactly ADR-0090's: one owner id per run
(`agent-<run>@<host>`), lease by size, epoch fencing, takeover after the lease.
Only the stage names change.

**The send-back.** The worker ends a run with a verdict the runner already
parses as the first line of a comment (`core/status-comment.ts`); a new verb
`send-back: <position> <reason>` names the target. The run's context lists the
chain with its positions. The runner checks that the target is an earlier
position of this ticket's chain (anything else becomes a red gate with that
reason).

**A send-back invalidates.** Sent back to position *k*, the entry *k* and every
later entry are invalid: the chain runs forward from *k* and each of them runs
again — a fix after Test is reviewed again. The ticket's status log records the
invalidation with its reason (`specs/ticket-schema.md` "The ticket status log";
on the store the status comments, `core/status-comment.ts` — I did not check the
exact carrier); an earlier result stays readable as history, it is no longer the
entry's verdict. **The limit is one send-back per ticket, to any earlier
persona, planning included.** The second does not move the ticket back, it goes
straight to You with both reasons. There is no `max-returns` setting. The
circuit breaker stays, counted per persona instead of per column (§9).

**The manual entry.** An entry that is You (acceptance, a hand check) is held
by You as an approval. An entry that names no readable persona also stands at
You, with the reason and the actions *Assign…* (a persona picker over the crew)
and *Do it myself*; the second is not an approval.

**A leaving action** runs inside the claim, after the persona's run and its gate
and before the ticket moves on: the card stays in the persona's column with the
status `merging main` (Ben) or `committing` (You). It takes a governor *heavy*
seat, as tests do today, and no model slot. A merge conflict in `sync-main` is
**the builder's**: the card stays with Ben with the conflict as the reason; it is
not a send-back and does not count against the one send-back.

## 5. The run's instruction

```
the run's instruction =  persona prompt.md              (who Ben is and what he does — R11)
                       + the mode wrapper, when the run has a mode
                       + skills, memory slice, ticket context   (as today)
```

There is no step text to compose with the persona: the persona's prompt **is**
the instruction, so req-258's "a persona's prompt replaces the phase prompt" is
the intended behaviour. What the runner adds is only what a mode needs:

- **interactive** — the `QUESTION:` protocol, when the entry is worked as the
  Shape chat (today `plan-interactive-default`, `fleet/request-instruction.ts` 79);
- **closing round** — the ask after a run that had friction
  (`fleet/closing-round-prompt.ts`);
- **review read-only** — the detached read-only checkout and the rule that the
  session changes no file (`fleet/instruction-sections.ts` 35–45).

A persona with no `prompt.md` runs with no character. The seeded crew's
`prompt.md` keeps its `## The <step> step` section: that text *is* the role now.
`specs/classifier-spec.md` changes with the wrappers (a prompt text moves from a
step prompt into a wrapper).

**The settings that sat on columns move to the persona record** (`persona.md`):

| Today (pipeline column) | On the persona |
|---|---|
| `min-class` (`core/phase-min-class.ts`, req-170) | `min-class:` the class floor of the persona's runs |
| `needs` (req-178) | `needs:` the model capabilities |
| `max-turns`, `max-work` | the run ceilings |
| the acceptance-command gate on the build column | `gate:` whether the ticket's acceptance commands gate the persona's hand-over |
| `wip` (unread today) | `parallel:` a real cap (§9) |
| `max-red` (the column's breaker) | the persona's breaker |
| — | `min:` the pool minimum (§9), config only |
| — | `leaving:` the leaving actions (`sync-main`, `commit`) |
| the phase decides the read-only review checkout | `readonly:` (§14, reading 2) |

`token-budget` stays a board key. `ci`, `audit` and `semantic` have no ruling
(§14, reading 9) and stay as they are.

**Who proposes a chain.** Paul (with the plan) and Pia (as a card) read the crew
list — title, summary, the prompt's opening lines — instead of the hard-coded
roster; the existing `setChain` intent (`core/chat-intents.ts`) carries the
whole list instead of a delta. Paul writes the chain into the plan (`### Chain`,
beside `### Parts`).

## 6. The chain per ticket

**A full list instead of a delta.** The delta made sense when the standard flow
was the pipeline's columns and a ticket only deviated; now the list *is* the
ticket's way. **When a ticket is created, the standard flow is copied into it**
(owner, 2026-11-11, Q8/Q15); from then on the chain is the ticket's own — the
owner edits it by hand, Paul with the plan, Pia as a card — and a later change
of the standard flow never reshuffles existing tickets, so `3 of 6` stays stable.

| Today (`core/chain-delta.ts`) | Persona board |
|---|---|
| `insert <phase>(<persona>, notify) after <anchor>` | an entry `<persona>(notify)` where it stands |
| `skip <phase>` | the entry is removed |
| `move <phase> after <anchor>` | the entry stands elsewhere |
| `assign <phase> <persona>` | the entry's persona |
| `notify <phase>` | `notify` on the entry — survives |
| `manual(you)` / `manual-<word>` | an entry `you` |
| phases must be pipeline phases | entries are persona ids |
| current and past gates locked | survives: only entries after the cursor are editable while active |

The flow editor (`core/flow-edit.ts`, `applyFlowOp`) already edits an
arrangement and only *then* encodes it as a delta; it writes the list directly
and the canonical-delta regeneration goes. `validateChain` validates a list: a
persona that exists when an editor writes it (a persona deleted later is the
*no persona* case of §3, not a validation error on a stored ticket), no edit at
or before the cursor. **Parts** keep their own chain line in the same grammar.

**The standard flow** moves from the pipeline's columns into `pipeline.md` as
one key: `flow: paul:shape; paul; ben; ralf; tessa; you`.

## 7. Shape and Flow chat as the assigned persona

- **Shape** is the interactive entry of the chain, by default Paul's. The chat's
  system prompt becomes *the holder's `prompt.md` + the interactive wrapper +
  the JSON contract*; "You are Paul" and the hard-coded roster go. Renaming Paul
  to Paula, or giving shaping to Ralf, changes who speaks.
- **Flow** (drafting the chain) is the persona of the ticket's plan entry, or the
  shape persona when there is none; without either, the chat asks which persona
  to ask.
- **Still the chat bridge.** Both stay direct calls with the assistant's LLM
  settings (D-1); only the character is the persona's, not its model. Making
  Shape a persona session is the deferred question 3 of
  `crew-internals-concept.md` §2 (req-109's numbers); this concept does not
  decide it.
- **Where a shaped ticket goes.** Shaping is work the owner does now, so a ticket
  enters Paul's column straight from Inbox (*Shape with Paul*); when the shape
  ends, *Start* moves the cursor on and *Queue* parks it in Prioritized with its
  chain set. The Shaping stage goes.

## 8. Defaults, the pipeline and the old keys

| Today | Persona board |
|---|---|
| `pipeline.md` `phases:` = the board's columns | `phases:` = the lifecycle columns only (Inbox, Prioritized, Done; `active` and `running` are drawn as the holder columns), plus `flow:` |
| Building's handover keys: `handover: agent build-default`, `claim`, `wip`, `token-budget`, `max-red`, `min-class`, `needs`, `max-turns`, `max-work`, `audit`, `semantic`, `ci` | to the **persona** (§5 table); `token-budget` stays a board key; `ci`, `audit`, `semantic` unchanged for now |
| column `persona:` (the ladder's middle) | gone — the chain says who |
| `crew.md` `default-persona` (the ladder's floor) | retired: read with a warning, never used; Settings drops the field; req-261's `pinned` refusal for it goes |
| `<step>-default` personas created by `migrateLegacyPersonas` | not created any more; **`build-default` and `commit-default` on the owner's board are deleted by the migration** (§12) |
| the ring run (no persona → assignment ring + phase prompt) | gone for ticket entries: no persona, no run; free sessions and 1:1s keep their own persona choice (R12) |
| `role:` sorts the crew (`inPipelineOrder`) and picks a seeded prompt (`CREW_STEPS`) | free label, no logic; the crew's order is `order:` in `crew.md` (§9); the seeder keeps writing each shipped persona's prompt |
| `x-persona` ticket pin | retired into the chain; a plan part's `persona:` becomes the persona of its build entry |

## 9. Capacity, the pool and the governor

- **A big pool and a pool per persona** (owner, 2026-11-11). The pool of R10 and
  ADR-0095 is the big one: a run asks for a class — the ticket's `class:` /
  `size:`, raised to the persona's `min-class` — and gets exactly that class or
  waits (`queued · waits for a B slot`); the routing within the class (req-178),
  the slots, the ledgers and the tranche stay. **Each persona also has a pool**,
  `parallel:` on `persona.md` — its maximum of parallel runs (absent = no cap).
  A run needs room in **both**: a persona with free places but a full big pool
  runs nothing. The card says which one it waits for: `waits for Ben` (persona at
  its cap) or `queued · waits for a B slot` (big pool full). Column header: `Ben
  · 2/2 · 1 waiting` (the count emphasized at the cap; You shows none). Unlike
  today's column `wip:`, which nothing reads (§0), the cap is enforced.
- **No Capacity band** (owner, 2026-11-11: "die Capacity-Anzeige passt für mich
  nicht mehr, entweder wir mergen mit dem Kanban oder entfernen" — merged). The
  persona columns already carry the per-persona load, so the band's persona rows
  go to the column headers and the big pool becomes **one chip in the board's
  header row**, `4/5 · 1 queued`; its popover holds what the band's lower rows
  held (slots per class with the upgrade mark, the tranche, the queue's head, a
  minimum overrun) and links to the Service window. The bottom-dock band and
  its Work-view arrangement go.
- **The minimum.** `min:` per persona, **default 0**, set only in the
  configuration (no Settings field for the first cut). With 0 nothing ever
  exceeds the big pool. A persona with `min: 1` starts one run even when the big
  pool is full, which overruns its maximum on purpose; the overrun is shown in the
  pool chip's popover and counts in the ledgers like any run.
- **The breaker** counts red gates per persona instead of per column; a tripped
  persona is *held* the way a column is today (`ColumnMode` → a persona mode),
  shown on its column header and as today's chain alert.
- **Dispatch order:** priority class first (unchanged), then *finishing beats
  starting* by the cursor's position in the chain (later positions first)
  instead of the rightmost column, then the board's rank.
- **The governor** is unchanged (light seats for model runs, heavy seats for
  tests, builds and leaving actions).
- **The human persona** never takes a slot, a seat or a budget (unchanged).
- **Column order = the team's order.** The crew gets an explicit order,
  `order:` in `_meta/crew.md` (a list of persona ids; the seeder writes the
  default crew's). The owner changes it by dragging a persona in the Crew tab or
  a column header on the Board; both write the same key. You is placed by the
  same order (default last); Inbox and Prioritized stay left, Done right.

## 10. Metrics

- **Per persona:** runs, cost (exists: the persona's daily budget figure), red
  gates, send-backs it issued and received, time held (from the cursor's moves),
  the journal grouped by model (R14, exists).
- **Per chain position:** duration (busy time of its runs, from run telemetry,
  which gains the position) and waiting time (from the cursor's moves). The
  cursor's moves are written as `hold` lines into the meta vault's ledger
  (`tickets/_meta/ledger.jsonl`; ADR-0090 E14-6 keeps the ledger there and writes
  no `phase` lines on a store), so no per-ticket reading of the store's git
  history is needed (`dk log`, R-07, is not shipped as far as I could tell).
- **Board:** "Cost by column" becomes **Cost by persona**.

## 11. Every surface and what changes

| Surface | Today (where the columns come from) | Persona board |
|---|---|---|
| **Desktop Board, 7e** (`plugins/tickets/renderer/board/board-model.ts` 98–194, `board-view.ts`) | one column per pipeline phase; the card's persona is the live run's, else `x-persona`, else the column's (139–142); the last phase is "Done this week"; no drag (the context menu's *Move to ▸*, `renderer/index.ts` 2845–2880) | columns Inbox · Prioritized · the personas in team order (You included) · Done; the card's position (`Ben · 3 of 6`) with the chain as initials, status line, badges *Question / Accept / No persona / Sent back*; **drag** between columns and of column headers (§4, §9); empty agent persona columns fold into a *+ n personas* chip; *Move to ▸* lists holders |
| **Capacity band** (`renderer/team/capacity-view.ts`, `capacity-model.ts`) | persona row, slot chips, tranche row — none by phase | **goes** (owner 2026-11-11, §9): the persona row becomes the column headers' load (`Ben · 2/2 · 1 waiting`); slots, tranche, queue head and a minimum overrun move into the popover of the board's pool chip (`4/5 · 1 queued`); `capacity-model.ts` stays as the chip's and popover's model |
| **Tickets panel** (`renderer/work-groups.ts` 199–321) | fixed groups Needs you · Shaping · Running · Ideas · Done, keyed on stage ids `SHAPING_STATE`, `READY_STATE` (232, 282); `runningStepOf` hard-codes *Planning/Building/Merging* on phase ids (420) | groups Needs you · Running · Prioritized · Inbox · Done; the row meta `T-0129 · Ralf · 3/6`; no hard-coded phase ids |
| **Mission Control desk** (`libs/mission-ui/src/work/work.model.ts` 753 `groupsOf`) | Needs you, then one vertical group per non-empty pipeline column | Needs you, then one group per holder (team order), You's approvals inside Needs you; swipe right = *Accept* only at You |
| **Mission Control iPad / phone** (`libs/mission-ui/src/work/phone-rows.ts` 118, hard-coded phase titles 41–45) | rows grouped by matching phase titles (`building` → "Running") | rows grouped by holder; the hard-coded title list goes; meta `id · n/m · word`. The phone does not change the argument (a grouped list either way), so the draft has no phone variant |
| **Flow editor** (`renderer/flow/*`, `libs/mission-ui/src/flow/*`) | edits the delta as gates | edits the persona list; the persona picker lists the crew; the send-back rule is shown |
| **Team / Crew** (`libs/mission-ui/src/team/team.ts` 241: the phases each persona serves; desktop `renderer/team/`) | phases per persona | what the persona holds now; the crew in `order:` with drag |
| **Persona page, 7k** | "Steps Ben can take" read-only chips | those chips go; the Work block gains `parallel`, `min-class`, `needs`, run ceilings, `gate`, `leaving` |
| **Drey Service window** (`apps/service-window/src/app/present/session-list.ts` 50: `T-0121 · build · Ben`) | phase as text | position as text (`T-0121 · 3 of 6 · Ben`) — wording only |
| **Board 10t, Autopilot** | no columns | none; the early-stop rows name the persona and position instead of the phase (`shared/tranche.ts` 194–229) |
| **Board 10u, MCCards** | rows `T-0119 · build · Ben · red twice` | same with the position; a new card kind *No persona for a position* (assign / do it myself) and *Second send-back* (the ticket stands at You with both reasons) |
| **Settings → Tickets → Pipeline** (`renderer/settings-columns.ts`) | edits the columns and their handover keys | lifecycle columns read-only (they mirror `dricket.toml`, Q-05) and the standard flow as a persona list |
| **Legacy remote PWA** (`plugins/tickets/remote/kanban.ts`) | the one side-by-side kanban with WIP | follows the same DTO; it is served only without `dist/mission-control` (`server/client-dir.ts`) — or is retired with E14-9b |

The canvas boards 7e, 7k, 10u and the Mission Control work boards are drawn on
phases today; per the fidelity rule they are redrawn on the canvas from this
draft before any screen is built (first row of §15).

## 12. Migration

**The owner's live board** (snapshot of 2026-11-11, §0): nothing stands in
shaping, prioritized, building or ready, so no ticket needs a holder.

1. Add `active` and `running` to `dricket.toml`'s stages, `claim = ["running"]`
   (R-03 replays old history under the old set). *As built (milestone 239):* steps 1–2
   are the owner's **Migrate** in the Tickets panel — the engine commits the config on a
   local store's `main` (Q-05's exception), a remote store is edited by hand; until
   req-266 the column of an `active` ticket is kept in the interim pin `x-phase`.
2. Re-check that `shaping`, `building` and `ready` are empty, then remove them.
   Any ticket that stands there by then: `shaping` → `active` at the interactive
   Paul entry; `building` → `active` at the entry of Ben with the standard flow
   copied; `ready` → `active` at the You entry. (`x-legacy-phase` stays
   untouched.)
3. `pipeline.md`: phases Inbox, Prioritized, Done; `flow:` as in §6 — one commit.
   The Building handover keys move per §5; `token-budget: 40000000` stays a board
   key. **This unpins `build-default`** (`pipeline.md` Building names it twice).
4. `crew.md`: `order:` written (Paul, Ben, Ralf, Tessa and You in team order; Pia
   first); the persona records get the settings that sat on Building
   (`min-class`, `needs`, run ceilings, `gate`) on **Ben**; Ben's `leaving:
   [sync-main]`, You's `leaving: [commit]`.
5. **`build-default` and `commit-default` are deleted** — one commit each by
   req-261's route, with the owner's confirmation, after step 3 (the route
   refuses a pinned persona). Where either prompt differs from Ben's own
   `prompt.md` (build) the difference is reported to the owner, not merged.
6. **Pia's persona** is created (§13, row 8) and joins the default crew's order.
7. Archived and done tickets keep their `x-chain` delta text as history; the
   reader treats a chain that does not parse as a list on a `done` ticket as
   absent.

**A fresh board.** "Initialize board" writes the five-stage `dricket.toml`, the
three lifecycle columns plus `flow:`, `order:`, and seeds the crew — Pia, Paul,
Ben, Ralf, Tessa and You, with the leaving actions (req-256's seeding, plus
Pia).

**Files backend.** The files backend's folders are the phases; the persona board
is dricket-only. Until E14-9b removes the files backend, a files vault keeps the
phase board.

## 13. Decisions

Every question the first version asked, the owner's answer and what follows from
it. Questions 17 and 18 were raised by the owner's second round.

| # | Question | Answer (2026-11-11) | Consequence |
|---|---|---|---|
| 1 | Where does the holder live? | Settled by the model: the chain's entry at the cursor | Derived from `x-chain` + `x-at`, never stored (§3) |
| 2 | How does a run end without R-31, and where is `running` shown? | Shown in the column of the persona that runs; `running` stays the store's claim stage | `claim = ["running"]`; a run end is one release; never drawn as a column (§3) |
| 3 | Shaping | Paul's entry, entered from Inbox | Shape is the interactive entry of the chain; the Shaping stage goes (§7) |
| 4 | After a send-back, where does the chain continue? | Forward from the target; all later entries invalid and run again | The cursor moves back, the invalidation goes in the status log (§4) |
| 5 | The send-back limit | One per ticket, to any earlier persona, planning included; the second goes to You | `x-sent-back` marks the use; no `max-returns` (§4) |
| 6 | Machine work on the board | In the column of the persona responsible | Leaving actions on the persona record; shown as status (§4) |
| 7 | A question inside a running run | The card moves to You until answered | `x-awaiting: you`; the answer returns it to the same persona (§4) |
| 8 | The standard flow on a ticket | Copied at creation, then the ticket's own | `x-chain` is written at creation (§6) |
| 9 | Parallel runs of one persona | A pool per persona inside the big pool; an optional minimum, default 0 | `parallel:` and `min:` on the persona; both pools need room (§9) |
| 10 | Column order | The team's order, changeable by drag | `order:` in `crew.md`; Crew tab and column header write it (§9) |
| 11 | Wide boards | Empty agent persona columns fold into a *+ n personas* chip | The chip opens them for a drop (§11) |
| 12 | `build-default` and `commit-default` | Both go | The migration deletes both after unpinning (§12) |
| 13 | A `steps:` field on the persona | Fell away: no step catalogue | The persona's prompt is its role (§5) |
| 14 | Shape and Flow chat | The persona's character over the chat bridge now | Prompts built from the holder (§7) |
| 15 | A ticket started without a chain | Moot: the flow is copied at creation | A ticket always has a chain; an empty entry stands at You (§3) |
| 16 | A machine step's persona slot | The commit is a machine action after the sign-off, no persona, no model | `commit` is You's leaving action (§4) |
| 17 | Pia in a chain | Pia gets a persona and may stand in a chain | `personas/pia/`; Mission Control composes her prompt (§15 row 8) |
| 18 | Where `sync-main` sits | The builder's last action, before the ticket goes on | Ben's `leaving:`; shown as `Ben · merging main` (§4) |

## 14. Readings to confirm

Where the rulings are silent or touch each other, this document reads them as
follows. None is a new decision; each is a place the owner may correct.

1. **Which of two Paul entries is the interactive one.** The standard flow has
   `shape(paul)` and `plan(paul)` — two entries of one persona with one
   `prompt.md`. The reading: the list marks the interactive entry with a mode,
   `paul:shape; paul; …`; every other entry runs as an ordinary run. Alternative:
   the mode follows the ticket (the first entry of an Inbox ticket, opened by
   *Shape with Paul*).
2. **Where the read-only review mode comes from.** Today the phase decides
   (`fleet/orchestrate/review-checkout.ts`). The reading: a persona setting
   (`readonly: true` on Ralf) — Q12's "the role is in the prompt" does not say.
3. **Confirmed by the owner 2026-11-11 ("Nach Ben, vor Review").** **`sync-main`'s position.** §12a's flow put it between review and test; the
   third round (later) makes it the builder's last action, so it runs when the
   ticket leaves Ben, before review. The later ruling is used. Consequence: `main`
   can move during review and test; the `commit` leaving action then meets any
   remaining conflict and the card stands at You.
4. **A merge conflict in `sync-main`.** §12a made it a send-back to build; the
   third round says the card stays with Ben with the conflict as the reason. The
   later ruling is used. Who resolves it — a further Ben run with the conflict as
   its task, or the owner — is not said; the card's reason carries the git output.
5. **When You's `commit` runs.** The reading: when the owner signs off at the
   chain's **last** entry. An Accept at an earlier You entry is a plain hand-over;
   a chain that does not end at You ends without a commit.
6. **Does the owner's own send-back count?** The reading: the one-send-back rule
   counts send-backs issued by personas; the owner's *Send back* at You is never
   refused and does not use it.
7. **Pia in a chain against R9** ("Pia executes, she does not work; every piece
   of work is a session"). The reading: an entry held by Pia is a Mission Control
   turn on the ticket — a direct call with her intents, no session, no slot —
   until the owner says otherwise.
8. **"No persona at the cursor"** means an entry that names no readable persona
   (deleted, misspelled, empty); the card says *no persona for position n*.
9. **`ci:`, `audit:`, `semantic:`** (Building's other handover keys) have no
   ruling; they stay where they are until the owner says where they belong.
10. **Dropping a card from Inbox / Prioritized onto a persona column** starts the
    ticket and hands the entry at the cursor to that persona (the rule of any
    drag between holders, carried over from the first version).

## 15. Proposed roadmap rows, in build order

Ids are the integrator's. Sizes are rough.

| # | Title | Replaces / touches |
|---|---|---|
| 1 | **Persona board on the canvas** — redraw 7e, the Tickets panel, Mission Control work (desk, iPad, phone), 10u's new cards and 7k's Work block from this draft; owner acceptance (fidelity rule) | boards 7e, 7k, 10u, MPadWork, MPhone* |
| 2 | **Lifecycle stages on the store** — `inbox prioritized active running done`, `claim = ["running"]`; the reader maps stages to lifecycle columns and holders; the run lease's release targets; migration steps 1–2 | ADR-0090 later change; `core/pipeline-states.ts`, `fleet/dk-target.ts`, `fleet/run-lease.ts` |
| 3 | **The chain as a persona list** — `x-chain` full list, `x-at`, `x-sent-back`, `flow:` in `pipeline.md`, copy at creation, `validateChain` over personas, the flow editor writes lists, parts' chains, `### Chain` in the plan | `core/chain-delta.ts`, `core/flow-edit.ts`, `core/plan-parts.ts`, `specs/ticket-schema.md` |
| 4 | **Persona settings, the run's instruction and the crew order** — `min-class`, `needs`, run ceilings, `gate`, `parallel`, `min`, `leaving` on `persona.md`; the mode wrappers (interactive, closing round, review read-only); `order:` in `crew.md` with drag | **closes req-258**; `core/persona.ts`, `fleet/request-instruction.ts`, `core/crew-file.ts`, `specs/classifier-spec.md` |
| 5 | **Persona leaving actions: `sync-main` and commit** — machine runs inside the claim, the status on the card, the conflict case, the engine's `done` after the commit | new `fleet/orchestrate/` classes over a git port; `core/pipeline-states.ts` (`COMMIT_STEP_PROMPT` goes) |
| 6 | **The runner on chains** — dispatch by the holder; no persona → stands at You with a reason; one release per run end; send-back with a named position, invalidation and the one-send-back rule; a question moves the card to You and back; per-persona pool and breaker; dispatch order by cursor; retire `default-persona`, the ring run for ticket entries, `x-persona` and `migrateLegacyPersonas` | **closes req-257**; `core/persona.ts`, `fleet/orchestrate/board-personas.ts`, `dispatcher.ts`, `breaker.ts`, `services/board-service.ts` |
| 7 | **Live board migration** — migration steps 3–5: `pipeline.md`, `crew.md` order and persona settings, deleting `build-default` and `commit-default` (owner confirms each) | owner's `E:\projects\drey-tickets\tickets\_meta\`; req-261's route |
| 8 | **Pia's persona and Mission Control's prompt** — `personas/pia/`, her `prompt.md` composed into the Mission Control system prompt, the seeder, the delete refusal while Mission Control uses her, Pia as a chain entry (a Mission Control turn) | `services/chat-llm.ts` (`MISSION_SYSTEM_PROMPT`), `core/default-crew.ts`, `contracts/persona-remove.ts`, `libs/mission-ui/src/chat/**` |
| 9 | **Board DTO and moves** — holder, position n/m, the chain initials, wait reason on the card; start, drag between holders and of headers, Accept / Send back with a target, park | `contracts/tickets.ts`, `services/board-service.ts`, `server/router.ts` |
| 10 | **Desktop Board and Tickets panel** per the accepted boards, with drag, the fold chip, the column headers' load and the pool chip with its popover (the Capacity band goes) | `plugins/tickets/renderer/board/**`, `work-groups.ts`, `team/capacity-*` |
| 11 | **Shape and Flow chat as the assigned persona** — prompts composed from the holder and the wrapper, the roster from the crew | `services/shape-system-prompt.ts`, `services/chat-llm.ts` |
| 12 | **Mission Control desk, iPad and phone** — groups by holder, Accept / Send back, the new cards, the flow editor, the team's order | `libs/mission-ui/src/work/**`, `flow/**`, `team/**` |
| 13 | **Metrics per persona and position** — `hold` ledger lines, telemetry position, report grouping, Cost by persona | `fleet/telemetry.ts`, `fleet/report.ts` |
| 14 | **ADR and specs** — an ADR "the persona board" (later changes of ADR-0088's persona ladder, ADR-0077's chain, ADR-0090's stages), `specs/ticket-schema.md`, `specs/frontmatter-schema.md` where it names stages, the manual | lands with rows 2–6, not after |

Rows 3 and 4 can run in parallel after row 2; row 5 needs row 4 (the `leaving:`
key); row 6 needs 3, 4 and 5; row 7 follows 6; row 8 needs 4 and can run beside
5–6; rows 10–12 need row 1's accepted boards and row 9. req-260 (the seeded
prompt text following a new shipped version) stays its own item: the persona's
prompt is now the whole instruction, so the question grows, it is not absorbed.

## 16. What this session did not do

No production code under `plugins/`, `packages/`, `libs/` or `apps/` changed; no
spec except the req-257 row's pointer; no changelog entry (no milestone). The
owner's store and meta vault were read, not written. The canvas boards are not
drawn — the draft is a repository file for the decision.

## 17. Later changes — the design round of 2026-11-13

From [project-handling-draft.md](project-handling-draft.md) (accepted 2026-11-13; rows req-282 – req-291):

- **Projects on the board.** One board holds every project (option A). A global
  project filter in the title bar hides the cards of other projects; under *All
  projects* a card carries a project chip. **The persona columns, their load
  (`Ben · 2/2 · 1 waiting`) and the pool chip stay whole** — capacity is
  cross-project (§9 unchanged). Board 7n.
- **The persona record (§0, §5, §9).** `worker:` and `models:` (default + pool)
  give way to `class:` and an optional pinned `model:`; the harness follows from
  the model; `min-class` folds into `class`. The per-persona pool and breaker of
  §9 (`parallel`, `min`) are unchanged. `allowed: write-vaults` gives way to
  `allowed: write-notes` plus the project's vault grants. Board 7k v3.
