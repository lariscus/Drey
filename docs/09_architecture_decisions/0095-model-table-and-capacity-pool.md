# 0095 — The model table and the capacity pool: classes, cost factors, a cap, no downgrade

## Status

Proposed (design session 2026-11-08, owner rulings R9 and R10 in
`docs/design/work-panel/crew-internals-concept.md`). Settles req-112 (the
model budget) and absorbs req-63's `fleet.pool.<provider>.size` and
req-113's per-ticket allowance. Amends ADR-0077 (provider pools) and concept
v2 §4.6 (the router policies). Built as req-170.

## Context

The owner runs the agent sessions of this redesign by hand with a fixed pool
of slots per model and gives every task the model its importance and
complexity warrant. req-112 asked for that as an engine function; what a slot
is, who ranks a task and what a waiting session does were open. The ruling,
in his words: *"jedem Modell sollte man eine Kategorie zuordnen können und
eine Capability-Klasse und einen Kostenfaktor; in den Settings soll definiert
werden, wie hoch der gleichzeitige Verbrauch sein darf. Wenn gerade nicht
genügend Kapazität vorhanden ist, dann soll abgelehnt werden und nicht einfach
eine kleinere Stufe verwendet werden. Nur die aktiven Sessions werden gezählt,
dann wartet er auf den Slot."*

## Decision

**Settings → Models is a table.** One row per model: id, provider,
**category**, **capability class**, **cost factor**, and per provider the
number of concurrent sessions it serves. A persona's `models.pool` is chosen
from this table only (strongest first); the router policies of §4.6 are
replaced by the class request below.

**A capacity cap.** Settings define how much may run at once: the sum of the
cost factors of the **active sessions** may not exceed the cap (one per
provider, one global). Only active sessions count — a held 1:1 counts, a
queued task does not.

**A session requests a class.** Every unit of work (ADR-0093: a run, a 1:1,
later Shape) asks the pool for `{persona, class, context size}` before it
starts. The pool grants a model of **exactly that class** from the persona's
pool with capacity left — **never a smaller class** — or the session
**waits**: no process is spawned, the card reads "queued · waits for a
<class> slot", Pia can explain it, the dispatcher takes the next task whose
class has capacity. A quota or rate-limit refusal from the provider shrinks
that provider's capacity for a while (req-63's rule stands).

**Three ledgers.** Ticket allowance (`allowance:` in the frontmatter,
req-113), persona per day (`budget:` in `persona.md`), provider per day
(Settings). A full ledger grants no slot and raises a Needs-you card; the
persona's `allowed:` says whether it may spend above the allowance or must
wait for the owner. Counting happens on the session record only (run
telemetry, ADR-0081): the ticket's cumulative cost, the persona's day, the
provider's day and the report's groups are sums of it.

**Who asks for which class — assumed, to be confirmed.** Paul gives each plan
part a size (S/M/L) that maps to a class; a phase has a floor in
`pipeline.md` (plan and review not below class B); a ticket pin (`model:`)
overrides; the owner can change the class on the card. The decision sits
where the knowledge about the task arises and stays auditable in the run
record (the model that actually ran, as §4.6 demanded).

**The session is a record of the service (owner addendum, R12).** Kind
(`run` | `1:1` | `shape` | `free`), persona, harness + model + class, an
**explicit working directory**, token, state (`queued` | `held` | `running` |
`released`), ledger links, stream file. A *free* session is created by the
owner or proposed by Pia as a card and runs through the same pool and
ledgers; its directory is the owner's choice, the tickets vault itself
allowed. A run keeps the ticket repo's worktree; a 1:1 starts in the tickets
repository read-only.

**Configuration in three layers (R13).** Machine (`service.json`: model
table, cap, providers, keys, paths), vault (`_meta/`: pipeline, personas,
repos, default persona and worker, permission mode, caps) and session (the
record). `chain.json` keeps runtime state only, one per tickets vault.

## Consequences

- `fleet.pool.<provider>.size` becomes a column of the model table; the
  Capacity band and the Crew tab draw slots per persona from the same
  record.
- "Smallest sufficient model" (req-112's wording) is rejected: a task that
  cannot have its class waits. The owner accepts latency over a weaker
  answer.
- The Persona page shows the pool rows with class, factor and busy slots and
  links to Settings → Models for the definitions (req-171).
- Mission Control gains the queue as a reportable state ("why is T-0122
  waiting") and a pin as a proposal card ("take opus for T-0130").
- Open: the class names (A/B/C or words), whether the global cap is in cost
  factors or in sessions, the mapping S/M/L → class, and the Settings →
  Models design pass (described, not drawn).

## Later change (2026-11-08, proposed — req-177, req-178, req-181): slots per account, surplus, burn rate; the Settings → Models design pass

The owner's Grobkonzept "Drey crew" refines the pool. A **slot** is an account, not only a provider: `Claude A` and `Claude B` (two Claude Code logins over their own `CLAUDE_CONFIG_DIR`), `z.ai`, `Kimi`, at work `Copilot`; each with a profile (`private | work` — a repository is bound to one profile and never runs over the other, not even as a fallback), a billing kind and price, and **quota windows** (5 h rolling, 7 d weekly) each with its remaining share, reset time and reliability (`measured | estimated | unknown`; a `QuotaSource` per provider, own counting plus 429 handling where nothing can be read — Spike 4 of 2026-11-08 settled it: all three are measurable — z.ai's quota endpoint (two windows), Kimi's usage endpoint with the CLI's self-refreshed token (5 h and monthly ratios), and Claude Code headless, whose stream-json output carries a `rate_limit_event` with the five-hour and seven-day windows (utilization, reset, status) after each assistant turn; `estimated` remains for Copilot and for a slot without a recent run; an expired login is a slot state `needs login`, never a retry). The **surplus** `q = R / T` (remaining share over remaining time share, minimum over the windows) steers the choice among a class's slots: largest surplus first, same surplus → cheaper; above `q` 1.3 a model step up within the slot; **never a smaller class** (the ruling of this ADR stands — the concept's step down was rejected, `decisions.md`). A reserve share per window and a **burn rate** (at most a configured share of the weekly quota per day over all slots) bound the spend. Every decision is logged with filter reasons, surplus and estimated cost. The Settings → Models design pass this ADR left open is done: board 7l `DeskModels` (model table, capacity cap, slots with windows and `q`, routing, ledgers), accepted by the owner 2026-11-08 — `docs/design/work-panel/crew-concept-boards.md`. Class names A / B / C as on the board.

**As built (req-177, milestone 215, 2026-11-09 — the slots part of this later change):** `fleet/routing/` holds
`Slot`, `QuotaWindow`, the `QuotaSource` port with one source per provider (z.ai's quota endpoint, Kimi's usages
endpoint with the CLI's token, Claude Code's per-run `rate_limit_event` with the account's `.claude.json` cache as the
fallback) and the runner's own counting behind each, `SlotRegistry`, `SurplusCalculator` (`q = R / T`, the minimum
over the windows) and `SlotGate`. The slots live in `service.json` in the service home (R13); a slot references the
harness login and never holds a key; a provider no slot names runs on an implied `private` slot that makes no network
call. A repository's `profile:` in `_meta/repos.md` (default `private`) is enforced at every run start: a free slot
of that profile, or a refusal with the reason. The states are `ready`, `busy`, `exhausted`, `needs-login` (never
retried) and `unknown`; `GET /slots`, the `slot` event and the chain status's `slots` carry them to boards 7l and 7e.
Deviation from the text above: until req-178 the slot is chosen by preference (the resumed session's slot) and then by
`service.json`'s order, not by surplus; `q` is shown, not used. The reserve share, the burn rate (req-181), the model
table, cap, class requests and ledgers (req-170) are not built. Operations: `plugins/tickets/FLEET.md`, "Slots".

## As built (req-170, milestone 217, 2026-11-09 — the Decision above)

**Where it lives.** `fleet/routing/` beside req-177's slots: `ModelTable` (+ `pool-config.ts`, `PoolSettingsRegistry`),
`CapacityCap`, `Ledgers` over `SessionBook`, `PoolGrant` (the one decision), `PoolGate` (every start's
`SlotBinder` — it replaced `SlotGate`, so the slot binding and the grant are one step), `RequestQueue`,
`PoolMigration`; the chain asks through `orchestrate/dispatch-pool.ts` (`ClassRequestBuilder`, `LedgerCards` in
`orchestrate/`); `GET /models` and `POST /models/config` serve the page (board 7l, a later session), the chain
status carries `pool` and `queue`, a `pool` event goes out on `GET /events`. The orchestration and the API never
import `routing/` (ESLint + `architecture.spec.ts`).

**The open points, settled:**

- **Class names:** `A | B | C`, A strongest — board 7l's.
- **Cap unit:** cost factors, globally and per slot. A slot's cap is set in `service.json` (`capacity.perSlot`) or
  **derived** from its rows: its largest row at full sessions (board 7l's numbers: Claude A 5 = opus 5 × 1, z.ai
  1.2 = glm 0.4 × 3). "Per provider" on the page is per slot (account, req-177).
- **Sessions:** two bounds beside the cost cap — a row's `sessions` (concurrent sessions of that model on one
  slot, board 7l's column) and req-177's slot `sessions` (the account in all). Req-63's `fleet.pool.<provider>.size`
  moved into the slots' `sessions` once (`migrations: ["fleet.pool.size"]`); the dispatch plan's per-provider
  bound is the sum of a provider's slots' sessions. Req-63's quota pause and rate-limit shrink stand, as the pool's
  provider throttle.
- **S/M/L → class:** S → C, M → B, L → A. Paul writes `size:` on each part (the shape prompt names it); the release
  copies it onto the part's ticket (`size:`, dricket `x-size`).
- **Who asks which class** (the assumption above, built as stated, with two precisions): a ticket pin `model:` (that
  model, its row's class) or `class:` (exactly that class) beats everything; else the size, or — unsized — the
  class of the persona's `models.default`; raised to the phase's `min-class:`; raised once more, when the persona's
  pool holds no model of that class, to the lightest stronger class it holds — **raised, never lowered**. The
  stock pipeline has one agent column (Building), so it carries no floor; a pipeline with plan or review columns
  sets `min-class: B` there. "The owner changes the class on the card" is the ticket's `class:` key today; the
  card control is UI work (follow-up).
- **Only active sessions count:** a run or a held 1:1 from its start until it settles — a worker waiting for the
  owner keeps its seat (req-63's "a waiting worker takes no slot" no longer holds for the cost cap: R10 counts a held
  session). A queued task holds nothing and spawns nothing.
- **A model the table does not hold** weighs 1 and has no class: it runs on a start that pins it without a class
  (an owner's dialog with an explicit model, a ring dispatch) and on every start while the table is empty (a machine
  not set up yet, so an upgrade runs as before); a class request never takes it.
- **Waiting:** the queue is rebuilt by every dispatch pass in dispatch order (priority class, rightmost column,
  position) and served front to back when capacity frees; the dispatcher takes the next task whose class has room,
  as R10 says — a heavy task can therefore wait behind lighter ones while they keep fitting (no reservation for the
  head of the queue; a follow-up if it bites). A wait has a reason: `capacity` (frees by itself), `ledger`, or
  `config` (no model of the class in the pool, a cost above a cap, no slot of the profile — waiting will not help).
- **Ledgers:** sums over every `run.json` the runner holds (its `SessionBook`, fed by the runner's own events); a day
  is the UTC date a session started; the provider ledger is per slot (`ledgers.providerPerDay`, one figure for every
  slot). A full ledger raises one keyed `blocked:` status comment (`ledger-ticket`, `ledger-persona-<id>`,
  `ledger-provider-<slot>`) — the Needs-you list reads open blockers — kept in `chain.json` (`ledgerCards`) and
  resolved on the next grant. `allowed: spend-above-allowance: true` in `persona.md` lets a persona past the ticket
  allowance (req-142 adds the other permissions).
- **The router policies** (`off | budget | escalate-on-fail`) and `personaModelFor` are removed, with Mission
  Control's router row; an old `router:` line is ignored.

**Deviations and gaps:** the context size rides the request but filters nothing (req-178's hard filter); the card's
`queued · waits for a B slot` line and the class on the card are data on the chain status — the Work panel and board
do not draw them yet; the queue does not survive a runner restart (the next pass rebuilds it). Surplus routing,
reserve and burn rate stay req-178/181.

## As built (req-178, milestone 219, 2026-11-09 — the surplus routing of the later change)

**Where it lives.** `fleet/routing/` beside the pool: `SlotFit` (the hard filter per slot — req-170's checks plus the
capabilities and the reserve), `CapabilityFilter`, `ReserveGuard` over `RunShareTracker`, `SurplusChoice`, `StepUp`,
`RouteRecorder` over `CostEstimate`, `ModelsDevImport`; `PoolGrant` runs them in that order, `fleet/compose-pool.ts`
wires them (split out of `compose-routing.ts`). The decision stages import no port, quota source, registry or network
at runtime (`architecture.spec.ts`).

**As decided above, with these precisions:**

- **Capabilities** are optional columns of the model table — `input` (`text`, `image`), `tools`, `context`, `output`
  (tokens). What a row declares is the local override; `POST /models/import` fills only the columns a row leaves out
  from models.dev's `api.json` (the harness's providers first: `anthropic` for Claude Code, `zai-coding-plan` / `zai` for
  opencode, `kimi-code-plan-global` / `moonshotai` for Kimi; a `provider/model` id looks in its prefix first). Opt-in,
  one call, never automatic.
- **Required capabilities** come from the step: one key, `needs:` (`image`, `tools`, `context-<n>`, `output-<n>`), on a
  ticket, a plan part (released onto its ticket) and a pipeline phase, merged. A need the row does not declare filters
  as `… not declared`, so the owner sees which column to fill. A row with `tools: false` never runs an agent session.
- **Provider rules** in the filter are the ones that exist: the repository's profile, a row bound to one slot, the
  provider's pause and throttle (req-63), the caps and the slot's day ledger. No further per-provider rule was invented.
- **The choice** puts the slot of the ticket's last run first when it passes the filter (a resumed session lives on its
  account — a Claude session cannot continue under another `CLAUDE_CONFIG_DIR`), then the largest `q` (no reading =
  `q` 1, an even pace), then the cheaper cost factor, the slot's price, the pool's order. So surplus decides a ticket's
  first run and every run whose last slot no longer passes.
- **The step up** is one step to the lightest stronger class among the persona's pool's rows on the **same slot**,
  above `routing.upgradeAboveQ` (default 1.3, `null` = off), when that row passes the filter there; never on a
  `model:` / `class:` pin, never onto another slot. R10 stands: nothing of the class passes → the session waits.
- **The reserve** (`routing.reservePerWindow`, a share, default 0.1): a start whose estimated share would take any
  window of the slot below it waits (`capacity`). The estimate is learned per slot and window from the readings around
  each run's end (the drop, shared among the runs the slot carried at once): the median of the ticket's runs, else the
  persona's, else 5 % — kept in memory (a restart starts at 5 % again; a roadmap follow-up).
- **The record**: `RouteRecord` `{slot, model, class, requested, q, estimatedUsd, stepUp, filtered, line}` on
  `RunInfo.grant.route`; the line `route T-0121 → claude-a/sonnet: class B, q 1.4, est $0.40 · filtered: kimi (no
  image input)` once in the runner log (the run start) and in the run's stream. `est` is the median of the most
  similar ended runs (ticket and model, ticket, persona and model, model), `?` without history. The chain's dispatch
  routes; the start's gate keeps the routed slot and class (a step up stays one) and filters the needs again.

**Deviations and gaps:** the burn rate stays req-181; the class request's own `contextTokens` is still null (only a
`needs: context-<n>` filters on context); a step up refused by the cap or the reserve is not logged; the screens
(capability columns, Routing group, the import action, the route on the card) are req-186's.

## As built (req-181, milestone 224, 2026-11-09 — the burn rate, and the Routing group of Settings → Models writable)

**The fourth routing rule.** Beside the hard filter, the surplus choice and the step up, the **burn rate** bounds the
day: at most `routing.burnRate` (a share, default 0.2 = board 7l's `20`; `0` = off) of the **weekly quota per day over
all slots**. Reached, no new run starts until the day turns; running steps finish; the Autopilot stays in its state and
shows the reason.

**Where it lives.** `fleet/routing/`: `BurnRateDayBook` (the day's book, `burn-rate.json` in the service home, writes
one after another), `BurnRateMeter` (today's share), `BurnRateGuard` (the decision, beside `ReserveGuard`),
`BurnRateHoldSource` (the decision as the chain asks it, the runner-log line once each way), `RouteRecorder.burnRateLine`;
wired in `compose-pool.ts` (`Pool.burnMeter`, `burnBook`, `burnRate`), the meter fed by every slot change in
`compose-routing.ts`, the book loaded at the routing's start. The chain asks through a consumer port,
`orchestrate/start-hold.ts` (`StartHold {current(), lift()}`; `PublishedHold` tells the `hold` event), handed over on
the `DispatchPool` (`hold`) — the orchestration still imports no `routing/` class.

**Decisions taken while building (routine, recorded here):**

- **The day is the UTC date**, as the ledgers and the tranche count it — one "today" in the service. The owner's
  local midnight differs by the zone (01:00 in Berlin's winter); every client writes the resume time in the reader's
  zone, so the card says `resumes 01:00` there. A local day for all three is a roadmap follow-up.
- **Measured where a weekly window is read, estimated elsewhere.** A slot with a `7d` window and a remaining share
  counts every drop since the day's first reading (a rise — a rolling window letting old use go — is not spending; a
  window past its reset starts again from its new reading, so a weekly reset mid-day lowers the figure and can clear
  the hold); a slot without one counts its runs started today at `RunShareTracker`'s share of its week (the ticket's
  runs, the persona's, else 5 %). The status says which (`basis: measured | estimated | mixed`).
- **Over all slots = the mean of the counted slots**, each slot's week weighing the same (slots have no common unit;
  prices and sizes are display data). An implied slot counts only once it ran today, so the three stand-in slots of a
  fresh `service.json` do not dilute the figure.
- **Reached = at or above the limit.** The hold's `resumesAt` is the next UTC midnight; its `since` is when it rose
  (the card's meta line; a restart takes the restart's time).
- **Only the chain is held.** The dispatcher asks once per pass, before any start; the owner's own starts (Start on a
  ticket, a 1:1) are not held — the owner decides those.
- **The lift is its own route**, `POST /chain/hold/lift` (paired devices `POST /api/chain/hold/lift`), not a flag on the
  Autopilot write: On releases a tranche (req-179), and allowing the day is not switching the Autopilot. It lifts for
  the rest of the UTC day and is stored in the day's book, so a restart keeps it.
- **The day's book is persisted** (unlike `RunShareTracker`'s samples): a restart mid-day — a Drey update restarts the
  service — would otherwise forget the morning's spend and hand out the day again.
- **The card is a chain-status fact** like the checkpoint (req-179): `ChainStatus.hold`, drawn by every client from
  `shared/burn-rate.ts` with board 10u's chrome laid out like part 4 (the quota stop): peach dot, `Burn rate reached ·
  20 % of the week today`, `Nothing new starts until 00:00. Running steps finish.`, chips `spent 21 %` / `resumes
  00:00` (+ `estimated` / `partly estimated`), *Wait* (primary; dismisses that device's card for the day) and *Allow
  today once*. The chips needed SDK 1.56 (`ConversationCard.chips`).

**The Routing group is writable.** `Upgrade above q`, `Reserve per window` and `Burn rate` on Settings → Tickets →
Models read `GET /models` `routing` (the renderer's `RESERVE_SHARE` / `UPGRADE_Q` left the page; the slot cards' reserve
colour and upgrade mark read the engine's values too), are checked like the engine (q above 0, empty = never; the
shares 0 to below 100 %), saved when the field is left or on Enter through `poolModelsConfig` →
`POST /models/config {routing}` (the whole key, the other two as the engine has them), and a refusal — the field's own
words or the engine's 422 text — shows under the group. The look is board 7l's.

**Deviations and gaps:** the Capacity band's upgrade mark (board 7e) still reads the fixed 1.3 (the chain status carries
no routing); a slot without a weekly window has no weekly samples, so its estimate stays the 5 % default per run (a
monthly window could be scaled instead); the day is UTC.
