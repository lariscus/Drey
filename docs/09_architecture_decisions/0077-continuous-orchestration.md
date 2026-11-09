# 0077 — Continuous orchestration: column runners, the dispatcher, and the chain's control model

- Status: accepted (2026-10-18, milestone 85; ticket T-0007)
- Amends: [ADR-0075](0075-ticket-pipeline-and-agent-fleet.md) (the fleet's run model; the "dispatcher/reaper only if
  trial data justifies" reservation is superseded) and M84's "a green gate moves the ticket on its own" rule
- Companion: [ADR-0076](0076-tickets-repository-as-system-of-record.md) (the format; unchanged — the chain's control
  state still never lives in the tickets repo)

## Context

M84 made a run controllable but the board stayed hand-driven: a human picked a ticket, picked a worker, pressed
start. Running the pipeline meant standing at the board. The owner's design rounds of 2026-10-17/18 (ticket T-0007)
specified the missing half: the board becomes a running pipeline — columns with workers drain themselves, the human
keeps checkpoints, and the machine keeps safety nets.

## Decision

**The worker-per-column is the auto/manual switch.** A pipeline phase may carry pool keys in `_meta/pipeline.md`:
`worker:` (the agent CLI; unset column = a manual step — the dispatcher ignores it), `model:` (the model pin),
`workers:` (parallel runs, default 1), `prompt:` (the `_meta/prompts/` ref; the handover's ref is the default, and
setting a worker writes the matching `agent <phase>-default` handover while clearing it writes `manual`). The
handover stays the authority: a column is automatic exactly when its handover mode is `agent`. The settings dialog
(Tickets) edits these keys with one commit per change; the file stays hand-editable and wins on refresh.

**The dispatcher lives in the fleet runner.** It already owns the process table and survives Drey restarting; Drey
only points it at a tickets vault (`chain` config over the loopback API, idempotent, re-sent with every board
snapshot). Per playing automatic column with free slots it serves **the column's own queue** (refinement rounds the
owner moved back) — and nothing else: the machine never pulls from a manual column. `prioritized` is the owner's
queue; he moves a ticket into the worker column himself, the pool runs it where it lies, and a green gate moves it
straight to the working column's next phase. WIP limits warn on the board but never gate dispatch — the pool size is
the parallelism. (Amended 2026-10-18, owner ruling: the original "drain the manual queue before the first automatic
column" pulled tickets out of `prioritized`, a folder the machine must not touch.)

**Checkpoints: a manual column between automatic ones is the owner's.** The dispatcher never pulls — the owner's
forward move is what feeds every pool (plan-review in the live default: refine / implement / park, all human moves).
Backward moves are always human moves — never blocked, always logged; the lane rule binds agents only. (Amended
2026-11-01, req-93: the shipped default has no checkpoint column — build flows into commit; the mechanism stands for
pipelines that add one.)

**Step completion is the agent's call; the gate is the safety net.** Every run brief ends with the completion
discipline: work the step, run the acceptance commands yourself, declare the step done only when they pass and the
work is ready — the agent's finished turn is the declaration. The runner still re-runs the machine gate: agent-done
AND green gate moves the ticket one column right; a red gate parks it (failure logged, run slot freed, ticket stays).
This amends M84's "green gate moves on its own": the gate is not an independent mover.

**Master and column control, persisted runner-side.** The panel header carries An / Aus / Notaus: run, halt gently
(running work finishes, nothing new dispatches), and the red button — abort every live run through the stop ladder
and halt, one click. Per column: pause (no new dispatch, current runs finish), stop (abort this column's runs and
hold), play. Stopping one column never stops the rest. All of it persists in `<userData>/fleet/chain.json` — never
in the tickets repo (ADR-0076). The column states resume when the runner restarts; **the master does not**: every
boot starts halted, because "An" is a per-session decision — a chain must never start moving just because the app
started (owner ruling, 2026-10-18). A running chain keeps the runner alive (no idle self-shutdown): the board drains
while Drey is closed.

**Safety nets.** The lease reaper fails a run whose worker process is provably dead (a lost exit event, a spawn that
never came up) and frees its ticket — a silent-but-alive worker is never touched (ADR-0014: no timeouts on
generation). The circuit breaker counts consecutive red gates per column (`max-red:`, default 3; a green gate
resets): tripping holds the column and parks its next candidate in inbox with `parked-reason`/`parked-at` — the one
machine-sanctioned backward move. A red gate also cools the column down for a minute before it fires again. Daily
token budgets per column (`token-budget:`, off by default) trip the breaker the same way.

**Quality rungs, flagged off.** `audit:` (a fraction) samples green steps and `semantic: true` gates every green
step in a column — both run a second, fresh worker over the same branch before the move (a prefixed brief over the
run's own instruction; one round, its own gate decides). They exist for the owner's live trial to judge; both
default off.

**The ci handover works.** A column with `handover: ci` and a `ci:` command leaves its tickets to the machine: the
runner executes the check in the ticket's work repo; a green check moves the ticket one column right (one commit,
`… -> <phase> (ci)`), a red one backs the ticket off for ten minutes.

**The MCP seam is typed and generic.** SDK 1.29 adds `ctx.mcp.registerTools(provider)`: a plugin's tools appear on
Drey's own MCP server beside the vault tools (listed after them, routed by wire name, first registration wins a
collision). The tickets plugin registers `fleet_status`, `fleet_run`, `fleet_stop`, `fleet_steer`, `fleet_watch` —
the assistant and any connected program can drive runs conversationally.

## Later change — provider pools and column priority (2026-10-30, req-63)

The per-column `workers:` pool is retired. Slots bound to a column blocked
work while the provider had capacity (an idle plan slot could not serve
build), and the left-to-right fill started work before it finished it.
The parallel slots now belong to the **worker providers**
(`fleet.pool.<provider>.size`, plugin config); every live run of a
provider takes one. The dispatcher orders one candidate list across all
playing automatic columns by priority class (`urgent`/`high` before
`normal`/`low`), then the rightmost column first, then column order — and
never preempts a running run. The owner decided against keeping
`workers:` as a per-column cap or reservation.

The capacity cannot generally be read from the provider: only llama.cpp
reports it (`/props` → `total_slots`, an optional probe URL that caps the
pool); hosted APIs report rate limits, not concurrency. A run that fails
on a rate limit shrinks its pool by one slot for five minutes. A run
whose turn the provider refuses for a spent **usage quota** (opencode's
idle marker `outcome: failed`, `provider.quota`) ends failed with the
provider's error and **no gate** — it claimed nothing, so it neither
raises the red streak nor moves the ticket — and the provider's pool
takes no new run for thirty minutes (2026-10-31: the z.ai plan's
five-hour quota ran out mid-chain; empty turns read as agent-done, a
build column tripped its breaker on untouched code and a commit run
moved T-0060 to done without a merge).

## Later change — the Autopilot over the master (2026-11-06, req-95a; concept §6.1)

The owner's switch has three states on every device: **On** (workers pick
up tickets by themselves), **Paused** (the running step finishes, nothing
new starts; an optional resume time) and **Off** (the owner starts every
step). **Stop all running steps now** stays the red button above, not a
fourth state; it ends as Off.

**One record, the master derived.** `chain.json` gains
`autopilot: { state, resumeAt? }` beside `master`; the orchestrator holds
only the record and derives the master from it (On = `run`, Paused and Off =
`halted`), so the dispatcher, the column brakes and the persona pause did not
change. `setMaster` stays as an API: `run` sets On, `halted` sets Off and
ends a pending resume time. `master` stays in the file for tools that read
it. Pure rules: `packages/tickets-engine/src/fleet/autopilot.ts`.

**The engine resumes, never a client.** The orchestrator's existing scan tick
(15 s) compares the wall clock with `resumeAt` and turns Paused into On. We
chose the tick over a one-shot timer: it survives a sleeping machine and has
no delay limit, at the price of up to 15 s of lateness, which a
"resume at 18:00" does not notice. A runner **stays alive while Paused** with
a chain config (no idle shutdown): the respawn would boot as Off and the time
would be lost.

**The boot rule stands (O-5).** Every start ends as Off: also a Paused whose
time has not passed, and one whose time passed while the runner was down — a
chain never starts moving because a process started. A handover to a newer
build remains no start (`handoverAt`, above): the whole record goes on, and a
time that came due meanwhile fires on the successor's tick. An older
`chain.json` without the record reads through its `master`.

**The surface.** `POST /api/chain/autopilot` `{state, resumeAt?}` (a new route
beside `/api/chain/master`, which stays for the existing clients; the runner's
twin is `POST /chain/autopilot`) answers `{ok: true, status}` with the chain
status, or `{ok: false, error, code}` with `bad_state`, `bad_resume_at` (off a
Paused, not a zoned ISO instant, or not in the future) or `runner_down`.
Reading needs no new route: `chain.autopilot` in `GET /api/fleet`, and
`autopilotOf()` reads an older runner or none (none = Off). Every change —
the owner's, or the runner's own resume — reaches the devices as the existing
`fleet` change on the event stream, through the client's snapshot compare; a set
announces at once. A **read-only device** reads all of it; every POST under
`/api/chain/` refuses with 403 and `code: "read_only"`. `fleet_status` reports the
state. The engine speaks codes only; the words are the clients' catalog (req-95b).

## Consequences

- The board runs itself wherever a column has a worker; the owner's leverage concentrates in triage (inbox), the
  checkpoints (plan-review, commit) and the switches. The live default gives workers to plan, build and review.
  (Amended 2026-11-01, req-93: the default's worker columns are build and commit; the owner's leverage sits in triage
  and prioritized, where tickets are clarified and planned.)
- The runner grows from "one run, supervised" to a loop with state (`chain.json`); its dispatch decisions are
  event-driven (config/control changes, run settle) with a 15-second safety-net rescan, so external board moves are
  picked up even with Drey closed.
- Two moves happen without a human: the forward move on a green gate (M84, unchanged) and the breaker's park into
  inbox. Both are logged in the ticket with the actor `agent@<host>`; everything else backward stays human.
- Model pins now reach both adapters: claude-code via `--model`, OpenCode via the v2 message body
  (`providerID/modelID`, split at the first slash).
- The second-opinion mechanism (audit/semantic) shares the run machinery end to end — no new runner concept; a
  failed opinion parks the ticket exactly like a red gate.
- The SDK gains its first program-facing tool seam; plugin tools are full MCP citizens and carry the same trust
  model as the vault tools (the tickets repo's commands were always owner-authored).

## Later change (2026-11-09, as built — req-179): the tranche as the Autopilot's release unit, the checkpoint report, early stop

The owner's Grobkonzept "Drey crew" (2026-11-08) adds **checkpoints in tranches** to the chain; proposed here on 2026-11-08, built on 2026-11-09. Boards 7e (the band's tranche row), 10t (the popovers), 10u parts 1 and 6 (the cards) — `docs/design/work-panel/crew-concept-boards.md`.

**The rule.** The Autopilot's On releases one **tranche**: up to N runs, a share of the day's budget or a time span, whichever ends first. Runs count **at the start** (a tranche never releases more than N), the spend counts the **settled** runs' costs, the span runs on the wall clock from the release. When a limit is reached the runner pauses the Autopilot itself — `{state: 'paused', reason: 'checkpoint'}`: running steps finish, nothing new starts — and the chain status carries the **checkpoint report**. The day's budget is the provider ledger of ADR-0095 over every slot (`providerPerDay × slots`); without a provider ledger the budget limit is not in force and the tranche ends by runs or time. The tranches a day holds (`tranche 1 of 3`) are `round(1 / budgetShare)`; the index restarts each UTC day.

**The report is deterministic.** Four numbers over the tranche's **run facts** (one per settled run the tranche released: ticket, phase, persona, gate verdict, cost, the lines its own commits added and removed): gate rate (green of the gated runs), change size (median `+added −removed`), cost per run (median and max), the ticket that ran most often (twice or more). No model writes any of it. The change size is `git log --since=<run start> --numstat` in the run's worktree — the run's own commits, not the branch's earlier work; a worktree that cannot be read gives no figure, never a guess. The report is recomputed on every read, so a run that settles after the pause still lands in the report of its tranche.

**Early stop.** After each settled run four rules look at the tranche's facts since the last release; the first that fires raises an early checkpoint (the same pause): a falling gate rate (`redGates` red among the last `gateWindow` gates, default 3 of 6), the same ticket red again (`sameTicketRed`, default 2), a change far larger than the tranche's median (`changeFactor`, default 3×) and a run far dearer than the median (`costFactor`, default 3×; both median rules after `minRuns` = 3 runs). Each threshold is config; `0` / `off` switches its rule off.

**Release.** There is no new endpoint: *Release next tranche* and *Release anyway* are the existing Autopilot write `{state: 'on'}`. On after an end checkpoint (or with the tranche spent) opens the next tranche; On after an early stop goes on with the **same** tranche and the rules look past the anomaly (`anomalyFrom`); On after a manual Pause, an Off or a restart continues the same tranche while it has room. A Paused set while a checkpoint waits keeps the reason; a resume time on it releases the next tranche when it comes (the scan tick, as above).

**Counters across restarts.** `chain.json` gains `tranche: {index, day, startedAt, started, pending, facts, anomalyFrom, checkpoint}`. The boot rule stands — every start is Off — so a restarted runner shows the same tranche (and a waiting checkpoint) with the Autopilot Off, and the next On continues it. A run still out when the next tranche opens settles into the open one: a fact belongs to the tranche it finishes in.

**The card is a chain-status fact, not a ticket comment.** The task's concept named the ledger cards' seam (`ledger-cards.ts`: a keyed `blocked:` status comment on a ticket) for the checkpoint card. A checkpoint belongs to no ticket, so a ticket comment would put it on an arbitrary ticket and into the Needs-you list twice. Instead the report rides the chain status (`tranche.checkpoint: 'waiting'`, `tranche.report`), persisted in `chain.json` like the open ledger cards, and every client draws the same card from it (`shared/tranche.ts`, `trancheCardOf`): the desktop Assistant's Mission Control thread and the phone's chat. The card goes away exactly when the checkpoint clears (a release). The Lead (Pia, ADR-0093) does not "write" the card; she can read it like every other client.

**Surface.** `ChainStatus.tranche` (`index`, `of`, `done`, `total`, `spent`, `budget`, `startedAt`, `endsAt`, `checkpoint: 'waiting' | null`, `report`) on `GET /chain` (and so the fleet snapshot, `GET /api/fleet` and Mission Control); a `tranche` event on the runner's `GET /events` stream after every change; one runner log line per tranche event (`tranche 2 released · up to 10 runs or $5.00 or until …`, `tranche 4 of 10 runs · checkpoint in 6 runs`, `checkpoint: tranche 1 of 3 done (runs released) — 10 runs · $4.10 · 130 min · 7 of 8 green — …`, `stopped early: 3 of the last 6 gates were red — the tranche had 6 runs left — …`). The config rides the chain config (`ChainConfig.tranche`), read by the board service from the plugin config keys `autopilot.tranche.{runs,budgetShare,minutes}` and `autopilot.earlyStop.{redGates,gateWindow,sameTicketRed,changeFactor,costFactor,minRuns}` (defaults 10 runs, 0.33, 240 min; all three limits off = no tranches, the behaviour before req-179). Keys and lines: `plugins/tickets/FLEET.md`.

**Structure (ADR-0096).** `fleet/orchestrate/tranche/`: `Tranches` (the coordinator the dispatcher and the orchestrator ask — ADR-0096's planned `TranchePolicy`), `TrancheLedger` (the one writer of `ChainState.tranche`), `TrancheBudget` (is the tranche spent?), `CheckpointReporter` (the numbers), `AnomalyDetector` (the rules), `RunFacts` over the `ChangeSizeReader` port (`GitChangeSize` behind it), `TranchePublisher` (the event), pure `tranche-lines.ts` and `figures.ts`; the record and its restore in `tranche-record.ts`; the contract in `fleet/protocol-tranche.ts`. The dispatcher's release gate is one consumer interface (`TrancheGate`: `mayStart`, `started`, `review`); the orchestrator's another (`TrancheSource`). The circuit breaker of this ADR stays the per-column safety net beneath the tranche.

**Considered and not taken.** A separate `POST /chain/tranche/release` (the Autopilot write already says it); counting runs at their end (a tranche of 10 would release 10 + the pool's width); the change size from the branch's diff against its base (cumulative per ticket, so a repeated ticket would count its earlier work again); a prompt-written summary on the card (the concept asks for deterministic numbers). Recorded in `specs/decisions.md`.
