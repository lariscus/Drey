# ADR-0098 — The persona board: personas hold tickets, the chain is a persona list, stages are the lifecycle

## Status

Accepted — built (owner-approved concept 2026-11-11; milestones 237, 239,
243 – 248, 254 – 256, 260, 261, 274; the documentation row req-275 is milestone
262). Later change of three ADRs, each of which carries a pointer back to
this one:

- [ADR-0088](0088-tickets-engine-package-cut.md) E3 — the **persona ladder**
  (ticket pin > phase `persona:` > engine default) is gone.
- [ADR-0077](0077-continuous-orchestration.md) — the **chain's control
  model**: columns as runners, the breaker per column, dispatch by the
  rightmost column become holders, the breaker per persona, dispatch by the
  cursor's position.
- [ADR-0090](0090-tickets-on-dricket.md) — the **stages**: six phase stages
  (`inbox shaping prioritized building ready done`) give way to five
  lifecycle stages (`inbox prioritized active running done`).

The concept this records is
[persona-board-concept.md](../design/work-panel/persona-board-concept.md); the
lasting structure is here, the file formats are in
[specs/ticket-schema.md](../../specs/ticket-schema.md), the prompts in
[specs/classifier-spec.md](../../specs/classifier-spec.md). Where the concept
and the code differ, **the code wins** — "As built" below lists each place.

## Context

The tickets board was the pipeline: `_meta/pipeline.md`'s phases were the
columns and, on the dricket store, a ticket's `stage` was the phase id. One
agent column (Building) ran the whole of plan, build, review and test as
"phases of the chain inside it", but no code ran them as separate entries;
who worked a ticket was a three-level ladder (ticket pin, column key,
`default-persona`) ending in an assignment ring that ran a persona-less
ticket anyway. A chain was a *delta* against the pipeline (`insert` /
`skip` / `move` / `assign`), so a per-ticket sequence of personas could not
be said at all. Four owner rulings (2026-11-10/11) changed the model:

1. **Everything hangs on personas, not roles.** Two builders do not build
   alike; a role says nothing about who takes a step. `role:` is a free
   label. No persona, no run.
2. **What a ticket goes through is set per ticket** — by Paul with the plan,
   by Pia as a card, by hand — as a list of personas; the prompt *is* the
   persona (R11), so the list defines the steps.
3. **A step may send a ticket back to any earlier step**; a send-back
   invalidates everything from the target on.
4. **The board's columns are the personas that hold a ticket**; the step is
   status on the card. Name four personas Plan · Build · Review · Test and
   the old phase board is a special case, not a mode.

## Decision

### The six words

- **Stage** — where a ticket is in its *life*: `inbox`, `prioritized`,
  `active`, `done` (dricket's `cancelled` reserved), and `running`, the
  claim's own stage while a run holds the ticket. A stage never says who.
- **Chain** — the ticket's whole way, an ordered list of personas
  (`paul:shape; paul; ben; ralf(notify); tessa; you`). A position (1-based),
  not a persona id, is what the cursor and a send-back name. No step
  catalogue, no `steps:` field.
- **Cursor** — the position of the current entry (`at:` / `x-at`).
- **Holder** — the persona of the entry at the cursor, **derived**, never
  stored (the holder rule below).
- **Leaving action** — machine work the runner does inside the claim when a
  ticket leaves a persona (`sync-main`, `commit`); no model, no slot.
- **Mode** — what a run needs beyond the persona's prompt, added by the
  runner as a wrapper (the interactive Shape dialog, the closing round, the
  read-only rules).

### The data (option C: chain + cursor, holder derived)

On the store: `stage`, `x-chain` (entries joined by `;`), `x-at`,
`x-sent-back` (`5>3`), `x-awaiting: you`. `[stages]` is
`inbox prioritized active running done` with `claim = ["running"]`.
`core/chain-holder.ts` `holderOf` is the one rule every surface and the
runner uses:

1. A lifecycle edge stage (`inbox`, `prioritized`, `done`, `cancelled`) has
   no holder.
2. `awaiting: you` puts the ticket at You; the card names the persona it
   came from.
3. An entry at the cursor that names no readable persona (or a ticket with
   no chain) puts it at You with *no persona for position n*.
4. Otherwise the entry's persona holds it. What happens there is
   `entryWorkOf(persona)`: an agent's entry is a **run**, a mission
   persona's (Pia) a **Mission Control turn**, the human's a step **for the
   owner**.

*Rejected:* a stored `x-holder` (two truths: a drag, a hand edit or a replan
writes one and not the other); personas as dricket stages (the crew would
live in `dricket.toml` on protected `main`, every claim would land in the
first claim stage, a stage cannot say which position); a native dricket
`assignee` (the holder is a persona, which ADR-0090 keeps Drey's). The
holder column is therefore never in `dricket.toml`: personas come and go
with `_meta/personas/`, the store's vocabulary changes only when the
lifecycle does.

`running` as a claim stage of its own removes the R-31 workaround: `dk
claim` moves `active -> running`, a run ends with **one** `release --stage
active` that carries the advanced `x-at`. The board never draws `running` as
a column — the card stays in its persona's column with the status *running*.

### The chain per ticket

`flow:` in `_meta/pipeline.md` is the standard flow; it is **copied into
every new ticket** (capture, createTicket, a released part without its own
chain) and then belongs to the ticket — a later change of `flow:` never
reshuffles existing tickets. The grammar is `<persona>[:shape][(notify)]`,
strict per entry and whole per chain (one unreadable entry reads the chain
as absent). `validateChain` guards writes, not reads: not empty, at most 24
entries, every persona exists (`you` always), nothing changed at or before
the cursor except the current entry's notify. A persona deleted later is the
runner's *no persona* case, not a read error. `x-persona` (the old ticket
pin) is retired into the chain; it is still read and shown, used by nothing.

### The cursor walks

- **A green run end** writes `x-at` + 1 inside the claim and releases once
  into `active`; the persona's leaving actions run first. Past the last
  entry the engine moves the ticket to `done` with `put --claim` (an agent
  may not release into a terminal stage).
- **Send-back.** A run ends with `SEND-BACK: <position> <reason>` (the brief
  lists the positions, `prompts/disciplines/chain.md`); no gate runs. The
  **first** send-back of a ticket moves the cursor to the earlier position,
  writes `x-sent-back`, and records the invalidation in the release's
  comment — the target and every later entry run again. A **second** one
  does not move the cursor: `x-awaiting: you` and `needs-decision
  [second-send-back]` with both reasons. A target that is no earlier
  position ends the run red. **The owner's own Send back never uses the one
  send-back** and is never refused; it takes any earlier position
  (a picker; without it, the nearest earlier agent position).
- **A question** in a run writes `awaiting: you` before the claim is given
  up; the card stands at You with the asking persona named; the answer's
  reclaim clears it and the same persona goes on.
- **Accept** at You moves the cursor on; at the last entry of a repository
  ticket a You entry is the sign-off (You's `commit` machine run, then
  `done`), any other last entry goes to `done`.
- **Pia's entry** is one ticket-scoped Mission Control turn per ticket (a
  chat session titled `<title> — T-0123, position 2 of 4`; her prompt +
  `mission.md` + the ticket in the digest's place; no session, slot, class
  or budget — R9). The ticket then waits at You; **confirming one of her
  cards ends her entry**, the owner's Accept moves on without one.
- **A plan run's `### Chain`** becomes the ticket's chain at the run's green
  end, in the same in-claim write as the cursor, when `validateChain`
  holds; otherwise the hand-on says why.

### The owner's moves (one `put` each, `personaBoardMove`)

`start` (Inbox / Prioritized → a persona: stage `active`, the dropped-on
persona takes the entry at the cursor **with its mode**), `hand` (the entry
at the cursor becomes the target persona; refused while a run holds the
claim and while the ticket waits for the owner's answer), `park` (back to
Prioritized or Inbox, chain and cursor kept). Accept, a drop on Done and the
column head's order keep their existing calls.

### Persona settings, instruction and order

What sat on pipeline columns moves to the persona record (`persona.md`):
`min-class`, `needs`, `max-turns`, `max-work`, `gate` (`commands |
structural`; absent = structural for a planner), `parallel`, `min` (default
0), `leaving`, `readonly` (absent = read-only for the reviewer and tester
roles). **`readonly` is an instruction in the brief, not a lock** (a lock
needs a harness change). The run's instruction is the persona's `prompt.md`
plus a mode wrapper — only the Shape dialog appends the interactive prompt;
the persona's prompt *is* the instruction otherwise. `order:` in `crew.md`
is the crew's order and the board's column order; the Crew tab, the board's
column head and Mission Control write it through one service.
`default-persona` is retired (read with a warning, never used). Shape and
Flow chat speak as the persona the chain names (the `:shape` entry; the
plan entry by *gate*, not by role), composed from its `prompt.md`, the mode
wrapper and the crew roster — still bridge calls with the assistant's LLM
settings.

### Leaving actions

Run inside the claim, after the gate and the closing round, before the
hand-on; a heavy governor seat, no model, no slot. **`sync-main`** (Ben's)
merges the integration branch's git upstream (fetched first) into the
ticket's branch; a conflict is aborted and ends the run **red** with the
conflicting files as the gate failure, so the next run of the same persona
gets the conflict as its task — it is no send-back. **`commit`** (You's) is
the sign-off's merge, a machine run on the target repository in a scratch
worktree, pushed to the upstream and proven from a fresh fetch; the machine
resolves no conflict; a protected branch (`policy:`) pushes the work branch
and waits for the owner; a You without `commit` refuses the sign-off. The
`commit-default` agent step and `COMMIT_STEP_PROMPT` are gone.

### Capacity

One big pool (ADR-0095) and, per persona, `parallel:` its maximum of
parallel runs inside it; a run needs room in **both** (`waits for Ben` vs
`queued · waits for a B slot`). `min:` (default 0) lets a persona start a
run while the big pool is full — overrun on purpose, shown in the pool
popover. The breaker counts red gates **per persona** (default
3 — a `max-red` of the column the run stood in overrides it while the
pipeline still has one; a tripped persona is held until the owner plays it). Dispatch order:
priority class, then the **later cursor position first**, then rank. The
Capacity band is merged into the board: persona load in the column head
(`Ben · 2/2 · 1 waiting`), the big pool as one chip `4/5 · 1 queued` whose
popover holds the slots, the tranche, the queue head and a minimum overrun.

### Metrics

The cursor's moves are `hold` lines in the meta vault's ledger
(`{"event":"hold","ticket","persona","position","length"}`; a `hold` without
a persona closes it). A `HoldRecorder` **observes** the derived holders on
every dispatch pass instead of hooking the writers of `x-at`, so a run's
hand-on, a send-back, an owner's drag and a hand edit all land the same way.
A chain run's `run_settled` line carries `position` / `length`. The report
(`GET /report`) groups by persona (runs, cost, red gates, held time) and by
position (runs, cost, busy, held, waiting time).

### Surfaces and migration

The snapshot carries `lanes` (the crew in `order:`, You included) exactly on
a persona board, and a `hold` on every active card
(`contracts/persona-board.ts`); the desktop Board and Tickets panel, Mission
Control's desk, iPad and phone, and the four persona-board cards in the chat
read it. A store becomes a persona board in the owner's hands, one
confirmation per step: **Migrate** (stages, tickets' old column becomes their
cursor), then three board steps — `pipeline.md` (lifecycle columns + `flow:`;
the working column's keys move to the builder), `crew.md` (`order:`, the
leaving actions), the deletion of `build-default` and `commit-default`.
Nothing runs on its own. The files backend and a store not migrated keep the
phase board (column dispatch, the ring) until E14-9b.

## As built — where the code differs from the concept

The concept was approved with open readings; the code decided them.

- **A third persona kind.** The concept gave Pia "a persona". The code adds
  `kind: mission` beside `agent` and `human`: no `worker:` / `models:`, never
  a run, a 1:1 over the chat bridge, no Delete, a `model:` of her own for her
  Mission Control turns; "is a worker" is `kind === 'agent'` everywhere.
- **`readonly` instructs, it does not lock** (concept §14 reading 2 said "a
  persona setting"; nobody had said how).
- **A `sync-main` conflict ends the builder's run red** (concept reading 4
  left who resolves it open): the next run of the same persona gets it as
  its task; the autopilot retries, the breaker caps it.
- **A drop hands the entry over with its mode**: an Inbox ticket dropped on
  Ben becomes `ben:shape` at position 1, not Ben's build — the drop reassigns
  the step, Accept moves it on (reading 10 taken literally).
- **A ticket waiting for the owner's answer cannot be dragged off You**
  (the concept was silent).
- **The owner's send-back is never counted** (reading 6) and its default
  target is the nearest earlier *agent* position.
- **`wip` did not become `parallel`** on migration: step 3 moves only the
  class floor, needs and the run ceilings; `ci` / `audit` / `semantic`
  (no ruling) are named and go with the column.
- **"Initialize board" still writes the phase pipeline.** The concept's
  §12 "fresh board" (a five-stage `dricket.toml`, three lifecycle columns)
  is not built: `DEFAULT_PIPELINE_TEXT` still writes the six phases plus
  `flow:`, and the crew seeder writes Pia, Paul, Ben, Ralf, Tessa, You with
  `order:` and the leaving actions. A store reaches the persona board
  through Migrate; creating a store with the lifecycle stages is E14-9b.
- **Active tickets stay in `columns`** too (in the stage's own column once
  the pipeline holds only lifecycle phases), so every reader of the columns
  keeps working; `lanes` and `hold` are additive.
- **Not built:** the board's *Filter: all personas* and *Cost by persona*
  buttons; *Stop and hand to Ralf* on a running card; send-backs issued and
  received per persona in the report; the runner's reading of the
  board-level `token-budget` on a chain board (it read the working column's
  only through the breaker); a persona board for the files backend.
- **The persona record changes of the 2026-11-13 design round** (concept
  §17: `class:` and a pinned `model:` instead of `worker:` and `models:`,
  `allowed: write-notes`) are other rows (req-282 – req-291), not this
  ADR's.

## Later change — a red gate sends back, Start on the card, the queue in the report (milestone 274, 2026-11-14)

Three rows the owner added to finish line step 5 before the merge into
`main` (req-78, req-120, req-148).

**A red gate sends the ticket back (req-78).** The row was written for the
phase board (`on-red: <phase>` in `pipeline.md`); on the persona board the
key is a chain option, so the standard `flow:` and every ticket can carry it:
`tessa(on-red paul)` — the persona of the nearest earlier position that names
it — or `tessa(on-red 2)`. A red machine gate there is milestone 248's
send-back with the gate's failure as its reason: inside the claim the cursor
goes to the target, `x-return-to` records the red position, `x-red-backs`
counts the loop, one release into `active` with the red-gate line. The
target's brief carries the failure and tells it to ask (`QUESTION:` →
`awaiting: you`, milestone 248) when it needs the owner's decisions; its
green end — or the owner's Accept at You, or the card that ends Pia's entry —
moves the cursor straight back to `x-return-to`. The open questions of the
row, as decided:

- *Where the return is recorded:* a store field, `x-return-to`, written
  inside the same claim as the cursor. *Rejected:* deriving it from the Log
  (a reader would parse prose; a hand edit of the Log would move the cursor).
- *Checkpoints on the way back:* the return skips **every** position
  between, a You entry included — the owner's words were "straight back into
  the phase whose gate went red, not through the queue again". Who wants the
  build to run again points `on-red` at the builder instead.
- *The bound:* `x-red-backs` against the persona breaker's threshold (the
  column's `max-red`, else 3): the red gate that would reach it stays with its
  persona as before, and the per-persona breaker of milestone 247 takes it.
  The breaker alone does not bound the loop — any green run of that persona
  on another ticket resets its streak.
- *The one send-back:* a red gate does not use it — the target is configured
  and the loop has its own bound; a persona's `SEND-BACK:` and every owner
  write of the cursor drop a pending return.
- *W7's gates and routing (req-75):* nothing to add — the target runs as any
  run of its persona, its class from the persona.

The red run settles failed (the breaker counts it) but the ticket backs off
nowhere (`RunInfo.redBackTo`): it moved on to another persona. A chain run's
retry now reads the last failure **at its own position**
(`lastGateFailureAt`), since two personas share one `active` column. Not
built: `on-red` on the phase board (files backend, unmigrated store), where a
red gate keeps backing off; a card badge for a ticket on a red gate's way (the
running line names the position that went red: *running · from Tessa*).

**Start on the card (req-120).** Board 9a's primary button on a Prioritized
ticket of a persona board is the `start` move with the persona of the entry
at the cursor — the drop on that column, no other call. It shows only where
the board would accept that drop (a chain whose entry names a persona of the
crew, no claim). The row asked for confirmation "per the `tools` write
policy"; no write policy covers ticket moves (the `tools` slice governs the
assistant's tools), so the button always asks in place
(`Start T-0017 with Paul?` · Cancel · Start).

**The queue in the fleet report (req-148).** The chain status's `queued` is
the dispatcher's queue of the last pass in dispatch order: the capacity
pool's queue (`slot`) and, on a persona board, the holders the plan found no
place for (`slot` — the big pool full; `persona` — the persona at its
`parallel:`); a ticket that waited before for the same reason keeps its
`since`; empty unless the Autopilot is On. The desktop Crew tab, Mission
Control's iPad and phone Crew draw a persona's queued tickets as rows
(*queued · waits for a slot*), a persona with only queued tickets as
*waiting*, and the head line's *· 1 queued*. On the phase board only the
pool's queue reaches it.

## Consequences

- One truth per ticket: chain and cursor; the holder, the column and the
  hold ledger are derived. Renaming or deleting a persona touches only the
  tickets that name it, never the store's configuration.
- The crew's shape lives in files the owner edits (personas, `order:`,
  `flow:`); nothing in the engine knows whether the board looks like a
  phase board.
- Every run end is one release into `active`; the R-31 two-commit
  workaround, the ring run for chain entries, `migrateLegacyPersonas`, the
  chain delta and the Capacity band are removed.
- The phase board (files backend, a store not yet migrated) is kept whole
  beside the persona board until E14-9b; two dispatch paths exist until
  then.
- A foreign `dk` reader must parse `x-chain` and `x-at` to know the holder.
- The board is only as good as the owner's migration: the owner runs the
  steps on the live board himself.

## Alternatives rejected

Recorded in the concept §3 and `specs/decisions.md`: options A, B and D for
the holder; a role fallback; an interim bridge that places a holder in a
phase column (milestone 243); holder columns in the snapshot before the
runner walks the cursor (milestone 247); a step catalogue / `steps:` field.
