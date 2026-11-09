# The fleet runner (Crew runner) — operations guide

The tool-neutral guide to operating and diagnosing Drey's fleet runner —
the agent runner behind the tickets board (ADR-0075), since req-164 the
**Crew runner component of Drey Service** ([SERVICE.md](SERVICE.md): the
process, its discovery, its lifecycle).
It is aimed at any coding agent (referenced from `AGENTS.md`) and at the
owner working from a terminal. Skill-capable harnesses may carry a thin
shim pointing here; this file is the single source of truth.

The fleet runner (ADR-0075, M84) runs inside Drey Service (req-164,
ADR-0092), the one background process that outlives the app; before
milestone 209 it was a detached process of its own. It owns the worker process table (OpenCode / Claude
Code CLIs), the per-run stream files, the ticket worktrees and the
machine gate. Drey talks to it over a loopback HTTP endpoint with a
bearer token — and so can a terminal, which the owner explicitly wanted.

Newer checkouts (the chain work, M85 / ADR-0077) run a **daemon** on top:
auto-dispatch across board columns, a master switch (run/halted),
per-column play/hold, red-streak cooldowns and a token budget. Which
flavour is alive cannot be read off `/health` alone (older daemon builds
predate the `build` stamp) — probe `GET /chain` or `GET /log`: a 404
means a pre-chain M84 runner, a hit means the daemon. The running build
may be newer than the checkout you are standing in — worktrees carry work
in progress, and a spawned daemon can even lag its own source until
rebuilt.

## Where everything lives

The fleet root is `~/.drey-engine/fleet` (the service home's `fleet/`).
The runner's port and token are in the service home's `service.lock`, under
`components.runner` (SERVICE.md) — there is no `runner.json` any more.

```
<fleet root>/                 (machine state; runner owned)
├── runner.log      the daemon log (every dispatch decision; ring-capped ~512 KB)
├── chain.json      persisted chain state (only on daemon builds)
├── runs/<run-id>/
│   ├── run.json    the full record: {request, info}
│   └── stream.jsonl the run's output events (ndjson)
└── worktrees/      LEGACY (pre-T-0044): emptied by the boot migration
                    and the Clean up worktrees control, never written again

<tickets repo root>/_worktrees/<ticket-id>/   the agent's checkout since
                    T-0044 (ADR-0080), branch t/<ticket-id> — visible,
                    gitignored, skipped by the vault's tree/index/watcher;
                    a repo's `worktrees:` key in _meta/repos.md overrides
                    the base
```

`components.runner.state` `sleeping` means the runner is **down** (it goes
to sleep when the Autopilot is switched Off with nothing live, when Drey
quits with nothing live and no On/Paused Autopilot, and after ~15 min
without a write — req-110, "Lifecycle gotchas"; it wakes on demand, in the
service's process). `failed` names why it could not start.

### Cleanup surfaces (T-0044, ADR-0080)

All removal goes through **real git** (`git worktree remove` /
`git worktree prune`), never a bare rmdir; the **branch always stays**
(it carries the work). The repo's `link:` junctions are unlinked first
(the top level is swept, named or not) on every removal path — git's
removal does not pass through a reparse point cleanly, and a leftover
folder at the path would poison the next prepare.

- **Per ticket:** the card menu's "Remove worktree…" — refuses a dirty
  tree unless the owner confirms the armed second click; refuses a live
  run; appends the ticket's Log line (one commit).
- **Global:** "Clean up worktrees" in the panel header — removes every
  worktree whose ticket has no live run (dirty ones kept and reported),
  then prunes every mapped repo; finally an unregistered folder under a
  base that holds nothing but links (the junctions an older removal left
  behind) loses its links and is rmdir'd — never recursively, so a folder
  with real content stays (req-68; the boot migration does the same for
  the legacy base). Liveness = the ticket's `run:` stamp ∪
  non-terminal fleet records — never fleet status alone.
- **Boot sweep:** every plugin boot migrates the legacy root (clean
  leftovers removed automatically, dirty ones kept and reported; a live
  run's tree waits for its settle) and **lists** orphan folders under
  the new base as cleanable — listed, never auto-deleted.
- **Re-run healing:** a leftover *registered checkout* of `t/<id>`
  anywhere (the re-run trap) is removed by the runner before
  `worktree add` when provably clean and not live — refused
  descriptively otherwise.

## Talking to the runner

Every route needs `Authorization: Bearer <token>` from `service.lock`'s
`components.runner` (present while the runner is awake; wake it with
`POST /components/runner/start` on the service's control port, SERVICE.md).
PowerShell:

```powershell
$root = "$env:USERPROFILE\.drey-engine\fleet"
$l = Get-Content "$env:USERPROFILE\.drey-engine\service.lock" -Raw | ConvertFrom-Json
$d = $l.components.runner
$h = @{ Authorization = "Bearer $($d.token)" }
Invoke-RestMethod "http://127.0.0.1:$($d.port)/health" -Headers $h
```

(or `curl.exe -s -H "Authorization: Bearer $($d.token)" http://127.0.0.1:$($d.port)/status`)

| Route | What it gives |
|---|---|
| `GET /health` | alive check: `{ok, version, live}` — `live` = live run count; newer builds add a `build` stamp — `<builtAt>#<hash>`, a content hash of the compiled fleet code (req-51; older builds: runner.js mtime) |
| `GET /status` | all runs (newest info per run) |
| `GET /status/<runId>` | one run: `{run, streamPath}` |
| `GET /stream/<runId>` | the run's stream.jsonl tail (last ~200 KB, ndjson) |
| `GET /events` | the runner's events as server-sent events (req-176): `event: run` with a run's record each time it is persisted, `event: line` with `{runId, event}` for each line of a run's stream, `event: slot` with a slot's view when its state, windows or busy count changed (req-177), `event: pool` with the pool's live load when it changed (req-170); a `: ping` comment every 15 s, `retry: 3000` at the start. A read: it never keeps the runner awake, and it ends when the runner goes to sleep — reconnect then. `curl.exe -N -H "Authorization: Bearer …" http://127.0.0.1:<port>/events` |
| `GET /log?tail=N` | daemon log tail, plain text (default 300 lines, max 2000; daemon builds) |
| `GET /chain` | chain state + config (daemon builds); `slots` carries the 7e summary per slot (req-177); `pool` the live load (`{used, global, slots: [{id, label, used, cap, derived}]}`) and `queue` the tasks waiting for the pool (req-170) |
| `GET /slots` | every slot (req-177): `{ok, slots: [{id, label, provider, profile, billing, quota, state, busy, total, windows: [{name, spanMs, remaining, resetsAt, reliability, fetchedAt, used?, limit?, unit?, rejected?}], q, reason, lastFetch, lastFetchError, implied}], configPath}` — see "Slots" below |
| `POST /slots/refresh` `{id?}` | read the quotas now (one slot, or all), the config reloaded first |
| `POST /slots/login-done` `{id}` | the owner signed the slot's account in again: `needs-login` clears, its quota is read |
| `POST /slots/config` `{slots: [...]}` | write the `slots` of `service.json` (every other key kept) and reload; a broken entry refuses the whole list (422), a file that does not parse refuses the write (409) |
| `GET /models` | the capacity pool (req-170): `{ok, models: [{model, slot, provider, category, class, cost, sessions, input?, tools?, context?, output?}], capacity: {global, perSlot}, ledgers: {ticketAllowance, personaPerDay, providerPerDay}, routing: {upgradeAboveQ, reservePerWindow}, now: <the live load>, queue: [...], providerDay: [{id, spent, limit}], errors, configPath}` — see "The capacity pool" below |
| `POST /models/config` `{models?, capacity?, ledgers?, routing?}` | replace the pool keys it sends in `service.json` (the others, and every other key, kept) and reload; a broken row refuses the whole write (422), a file that does not parse refuses it (409) |
| `POST /models/import` | req-178: fill the model table's **undeclared** capability columns from `https://models.dev/api.json` — the one network call of the routes, only when the owner asks; what a row declares stays (the local override). The `GET /models` reply plus `imported: {filled: [{model, where, fields}], unmatched: [model]}`; 502 when the registry does not answer (nothing written) |
| `GET /report` | token telemetry grouped by ticket, phase and model, sorted by total desc: `{ok, groups: [{ticket, phase, model, runs, total, input, cacheRead, cacheCreation, output, beforeFirstWrite, beforeFirstWriteShare}]}` — a counter the provider never reports counts 0 into the sums; pre-T-0048 records fall back to their cumulative `tokensIn`+`tokensOut` (T-0048) |
| `POST /stop` `{runId, reason}` | stop one run |
| `POST /send` `{runId, text}` | steer a live run (rung: inject/resume/refused); while the run waits on a question it is the answer, not a takeover. To an ended run (done/stopped/failed) with a session it reopens that session under a new held run, the text as its first prompt — the reply carries the new `runId` |
| `POST /permission` `{runId, decision: "once"\|"always"\|"reject"}` | answer the worker's pending approval (req-64; OpenCode) |
| `POST /answer` `{runId, answers: {q0: "label", …}}` | answer the worker's question form — a choice, free text, or a list for a multiple choice per question key (req-64; OpenCode's `question` tool) |
| `POST /chain/master` `{mode: "run"\|"halted"}` | master switch (daemon builds): `run` sets the Autopilot On, `halted` sets it Off |
| `POST /chain/autopilot` `{state: "on"\|"paused"\|"off", resumeAt?}` | the Autopilot (req-95a): `resumeAt` a zoned ISO instant in the future, only on `paused`; answers the chain status, or 422 `{ok: false, error, code}`. Paired devices reach it as `POST /api/chain/autopilot` (a refusal there is a 200; a read-only device gets 403 with `code: "read_only"`, on every `/api/chain/` write) |
| `POST /chain/column` `{phase, mode: "playing"\|"held"}` or `{phase, stop: true}` | column control |
| `POST /chain/abort` | stop every live run |
| `POST /shutdown` | graceful retire: stops live runs (bounded), the runner goes to sleep. With `{handover: true}` (what the service passes on when a newer build asks it, req-51) no run ends: live runs are left to the successor (OpenCode re-attached; a worker it cannot bind to is stopped and its session resumed in place under the same run id); 409 while a run is gating/starting/stopping |
| `POST /retire-if-idle` | sleep if nothing needs the runner (req-110; what the engine sends once Drey is gone): `{ok, exiting: true}` and the runner goes to sleep, or `{ok, exiting: false, reason: "live runs" \| "autopilot"}` and it stays — the decision is the runner's, so no run that starts in between dies. No body. A runner from before req-110 answers 404 |
| `POST /start` | starts a run — **do not hand-craft**: the `RunRequest` (see `packages/tickets-engine/src/fleet/protocol.ts`) carries the composed instruction, worktree, gate commands, phase plumbing; runs are started by the board's "Run agent" or the chain dispatcher. A start without an `origin` is refused (D-41) |

Writes change real state (worker processes, the board, the tickets repo).
Diagnose read-only first; only stop/steer/switch on the owner's ask.

## Checking status — the usual recipe

1. Descriptor: `service.lock`'s `components.runner` (`sleeping` = down; note
   `pid` — the service's — and `build`), or `service-main.js --status`.
2. `GET /health` — alive, how many live runs, which build.
3. `GET /status` — the runs: id, ticketId, provider, **state**, pid,
   tokensIn/Out (`tokensIn` counts cache reads; `cacheReadTokens` is
   that cached part, req-53 — and a resumed session counts only this
   run, its earlier spend is `usageBase` in `run.json`), costUsd,
   sessionRef, worktreePath, gateFailure. A run id
   can appear **twice**: at boot every provider supervisor adopts every
   stored record from `runs/`, so boot-adopted runs land in both lists —
   dedupe by id when summarizing.
4. `GET /log?tail=50` — what the daemon last decided and why
   (e.g. `dispatch skips T-0041: T-0041 has no runnable acceptance criteria: ...`).
   Who asked for a run: `run <id> (<ticket>): asked by <origin>` (D-41): `chain`,
   `accept`, `mcp`, `drey:run-dialog`, `drey:plan-dialog`, `handoff of <run>`,
   `resume of <run>`, `device <name> (<id>)`; `engine.log` has `run start: <ticket>
   asked by <origin>` as well, also for a start the runner never heard of. It is on the
   run's record too (`origin` in `run.json`'s info).
5. `GET /chain` — master/columns/cooldowns/token budget (daemon builds).
6. `GET /report` — token cost per ticket/phase/model (T-0048): what the
   columns spend, sorted by total.
7. For a specific run: `GET /status/<id>` then tail `stream.jsonl` directly
   from disk (`Get-Content "$root\runs\<id>\stream.jsonl" -Tail 20`) — that
   works even after the run ended.

### Run states

| state | meaning |
|---|---|
| `starting` / `running` | live worker |
| `stopping` | stop requested, worker ending |
| `done` | worker finished its turn (gate ran after; check `gateFailure`). A turn that ended `BLOCKED:` is also done, but no gate ran and nothing moved — the reason sits in `blocked` and the ticket waits for the owner |
| `stopped` | stopped by request |
| `failed` | worker died or errored (see stream `error` events) |
| `detached` | the runner restarted while the worker lived on — unwatchable, treat as busy. The reaper settles it as `failed` once the worker is provably gone (no recorded pid runs, or the process is younger than the run's last sign of life: a reused number, D-34); with no runner up the board reads such a record as `stopped` |

A live run may carry `waiting` (req-64): `{kind: "question", text, since}`
when the worker ended its turn with a `QUESTION:` message — the marker
may sit at the message start or at any line start, the last one wins,
one in prose does not count (the run stands,
its session kept, until the owner answers via `/send`); the same kind with
`requestId` and `questions` (each `{key, header?, question, options,
multiple}`) while OpenCode's `question` tool waits on its form (answer via
`/answer`, or `/send` — one line per question, a choice by number or
label); or `{kind: "permission", text, since, requestId}` while OpenCode
holds a tool call for approval (answer via `/permission`). A waiting run is not stalled,
however long it waits; the ticket's Log carries the question, and Drey
shows a Windows notification.

A "red gate" shows as `gateFailure` on the run plus `note` events in the
stream; on daemon builds it also feeds `redStreak` and `cooldownUntil` in
`chain.json` for the working column.

### Where a run may start (D-29)

Only out of an agent column (`handover: agent …`): the owner's columns give no run, whoever asks,
the refusal is `composeRunRequest`'s, the one place every start passes. Two runs work in a manual
column all the same, and neither takes a ticket for the fleet: the owner's dialog (below) and Accept's
commit step on Ready to try.

### A worker's ticket on a store (D-30)

A store ticket has no file: a card's path is virtual. So the brief names a working copy,
`<vault>/_worktrees/<id>.ticket.md`, written after the claim; the text it started from is
`ticket-given.md` in the run's folder. When the turn ends, before a structural gate, a wait for the owner or
any release, the runner `put`s what the worker changed back inside its claim: a changed or new chapter
replaces the ticket's own, new Log lines are appended, frontmatter and `## Verlauf` do not count, a chapter
the owner edited meanwhile stands unless the worker changed the same one. The copy goes when the run ends.
A failed `put` is a log line and the next take-back tries again.

The store is the runner's one ticket backend (req-176, ADR-0096): every ticket write — a run's and the chain's —
goes through the one `RunBookkeeper` over the claim (release, comments, the in-claim `put`); a start whose
request names no `dk` is refused, and the chain drives no board without a store (one line in the log says so).
A run record from before the cut-over, which has no `dk`, is read and never writes a stamp, Log, move or park
(D-42); the `--store-backed` flag is still accepted and changes nothing.

### Interactive dialog runs (req-65)

A run whose request carries `interactive: "plan"` (a `"refine"` mode existed until
E13-9 removed it) is the
**owner's dialog, and it starts quiet** (req-75): held at spawn with
**no first prompt delivered** — the worker stands, its session live,
nothing runs until the owner's first `/send`, which wraps the composed
brief around the text once (a plain steer afterwards; the record
carries `quietStart: true` until that send). The thread's composer
comes pre-filled with the step and its meaning, and its status shows
the pending hint until the first message. Claude Code has no hold at
spawn — its dialogs keep today's first posted turn. At the run's end
**neither the gate nor a move runs**, however the worker
exits — the owner moves the ticket on the board themselves (the takeover
tab's end moves are owner moves). The brief's completion discipline is
replaced by a dialog discipline; the asking protocol (`QUESTION:`) is
the interview loop. While the run lives its claim marks the ticket (on a store the
claim is the stamp); a ticket marked `interactive: true` keeps the
dispatcher off between dialogs, and a board move drops the field. Reopening such a run's session ("Resume session") works as for
any run — the reopened session is held and belongs to the owner.

### Scout runs (E8, concept §5.6)

A ticket with `form: scout` dispatches a **scout run**, not a build:
the `scout-default` prompt, and none of the build machinery — no
worktree is prepared, no branch is cut, no gate runs and nothing
moves. The run is a read-only exploration (repo, history, data)
whose one write is its own ticket's `## Report` section, in the
worker's copy; the runner `put`s it back inside the claim, as on every run. The
acceptance-criteria hold (the most common dispatch skip) is a
ship-form requirement — a scout run has no gate to feed, and a
scout ticket carries no plan.

The endpoint is the report, not a proof: the engine raises the
parsed section as a card in "Needs you" (`kind: report`), and the
owner promotes the ticket to ship from there — the chat's `promote`
command, a proposal card executed only on confirm. A promoted
ticket is an ordinary ship ticket from its next normal run
(worktree, gate, move); the `## Report` section stays as history.
Diagnose a scout run like any other (`/status`, the stream tail);
a `gateFailure` never applies to it, and the ticket never moves on
its own.

### run.json and stream events

`run.json` = `{request, info}`: the request carries `ticketId`, `repoPath`,
`worktreePath` (since T-0044 — computed plugin-side, the runner never
derives paths), `branch`, `phase`/`column`, `instruction`, `acceptance`
(the gate commands), `model`, `permissionMode`; the info is the same
object `/status` reports.
Since T-0041 the request also carries `nextPhaseDir` and `pushRemote`
(pipeline.md `push:`); since req-176 the runner moves a ticket by its
release into the next stage, so neither a phase folder nor a push of its
own applies — the fields stay for older records. Ticket
paths may be numbered (`tickets/30-plan/…`) or unprefixed — the stripped
id is the identity everywhere. `stream.jsonl` lines are
`{ts, kind, text, ...}` with kinds `note`
(runner notices: gate lines, run bookkeeping), `text` (worker output),
`usage` (token/cost updates), `result` (the worker's final answer) and
`error`.

Since T-0048 the info also carries the run's **token telemetry** (all
optional — adopted pre-T-0048 records lack them, and every reader
treats absent as unknown):

- `usage`: `{input, cacheRead, cacheCreation, output}` summed over the
  run's model calls — a counter the provider never reports stays `null`,
  never 0 (the pinned plan provider may report no cache fields);
- `lastTurnContext`: input+cacheRead+cacheCreation of the LAST assistant
  turn — the real context size (the providers' `tokensIn` and the result
  events are cumulative aggregates, not context);
- `turns` (model calls that reported usage), `readCalls`
  (read/grep/glob tool calls), `tokensBeforeFirstWrite` (input-side
  tokens over the turns before the first write/edit — the exploration
  cost; the full input side when no write came);
- `gateResult` (`green`/`red` once the gate ran), `model`, `phase`,
  `handoverMode` (`fresh` | `resume` | `resume-compact` — T-0049) and
  `resumedFrom` (the candidate's session a resumed run continued; null
  on fresh and on a resume that fell back fresh). A run whose worker
  ended its turn with `BLOCKED: <reason>` carries `blocked` (the
  reason) instead: no gate ran, no move was performed, and the chain
  holds the ticket until the owner moves or starts it.

`GET /report` groups these by ticket, phase and model (see the route
table); the board's lanes show `ctx`/`turns`/`reads` chips per run (a
resumed run appends `resumed`).

### Session handover (T-0049)

How a run's context reaches its worker. `RunRequest.handover` rides the
start: the dialog sends the owner's explicit choice, the dispatcher
sends `auto`, an older sender's absence means `fresh`. One resolver —
`packages/tickets-engine/src/fleet/handover.ts`, pure — decides:

- The **review phase always resolves fresh** (an independent worker
  judges the step).
- The candidate is the **newest terminal run** (`done`/`stopped`/
  `failed`) of the same ticket, provider and model in that supervisor —
  `detached` never qualifies (its worker may still live). No candidate,
  no session, another phase's session, a recreated/moved-aside worktree
  (T-0047's `sessionInvalidated`) or a session another non-terminal run
  holds → fresh.
- A **warm pause** (within the TTL) or a **known context below the
  compact threshold** → `resume`; a cold pause with a context at/above
  the threshold → `resume-compact` when the provider compacts natively
  (opencode: measured; claude-code: not yet), else fresh. An unknown
  context (pre-T-0048 records) never auto-compacts.
- An explicit dialog choice is honoured when structurally legal; the
  dialog disables the options that are not (same rules, client-side).

The decision lands on the record (`handoverMode`, `resumedFrom`), the
stream (`handover: <mode> — <why>`) and the ticket's start line.

**Fallback:** a resume the adapter cannot establish — opencode pre-flights
the session with a GET before prompting; claude-code treats an exit
before any init event as one — never fails the run. The supervisor stops
that worker and respawns **fresh under the same run id** with the same
instruction (`handoverMode: 'fresh'`, `resumedFrom: null`, one stream
note). A failure after a successful resume fails the run normally.

**Held runs resume silent (req-75):** a held run whose session a runner
restart takes over — resumed in place, or respawned fresh by the
fallback above — receives **no continuation prompt** (it spawns held;
the pre-req-75 internal resume prompt caused the observed no-op "I'm
back" turns and is deleted). Non-held resumes still deliver
`HANDOVER_CONTINUE`.

**Config** (`Settings → Tickets → Fleet`): `fleet.compactAboveTokens`
(default 60000, provisional) and `fleet.resumePauseTtlMin` (default 15).
Per-provider/model overrides are flat keys the plugin reads and pushes
with the chain config — `fleet.compactAboveTokens.opencode`,
`fleet.compactAboveTokens.opencode/<model-pin>` — most specific wins. The
per-provider key is written by Settings → Tickets → Workers (req-71); the
per-model keys have no UI.

### Token economy (req-80)

- **Context cap.** `fleet.contextCapTokens` (default 160000, 0 = off;
  per provider/model `fleet.contextCapTokens.<key>` like the compact
  threshold) rides the chain config. An OpenCode worker's server starts
  with `OPENCODE_CONFIG_CONTENT` setting the pinned model's
  `limit.context` (and `output`, since an override naming `context` alone
  is dropped), so OpenCode's own auto-compaction fires there. The stream
  opens with `context cap: <n> tokens`, and the run's `contextWindow`
  reports the cap. A pin without `provider/` is not capped.
- **Continuation brief.** A `resume`/`resume-compact` start prompts with
  `RunRequest.continuationInstruction` (who/where, diff stat, gate
  failure, gate, discipline) instead of the full pack, but only while
  `briefDigest` (sha256 of the stable parts) equals the digest of the run
  whose session resumes. The stream says `brief: continuation …`. The
  fresh fallback still sends the full instruction.
- **No replay on resume.** A session resumed in a fresh adapter marks every
  message settled before its first prompt as seen, as re-attach does.
  Its old turns no longer land in this run's `turnUsage`, so `/report`
  and the chips stay honest. Before req-80, T-0061 showed 400 turns
  where 240 were real.
- **Held and idle handover.** A held worker that stood idle when the
  runner retired is resumed without a prompt (`handover.turnIdle`, on
  adapters with `promptless`: OpenCode). Without this, an "I'm back" turn
  re-read the whole context.
- **Empty answer = refusal.** An idle marker after the newest prompt with
  no assistant message in between fails the run with an `error` and no
  gate, the same as `outcome: 'failed'`.

### The instruction (T-0048: the context pack)

Every phase's instruction is composed in one stable order — repo agent
instructions (verbatim: the file `repos.md`'s `instructions:` names,
req-79 — Drey's is `docs/agents/fleet-worker.md`; unset, missing or
blank falls back to `CLAUDE.md`, then `AGENTS.md`) → phase
template (a persona's prompt, then its `## Skills`, D-46: the names in `persona.skills`,
nearest first `personas/<id>/skills/<name>.md` or `<name>/SKILL.md`, then `_meta/skills/`; a name with no text is
a log line) → the ticket's `## Plan` verbatim → the variable parts
(who/where, description, the worktree's diff stat (commits since the branch left the base — `base...HEAD`, then `git status --short`) head-capped, the earlier step's `## Handover` section,
and on a retry the previous run's gate failure tail-capped). The prefix
up to the plan is byte-identical across runs of the same repo and
phase, so a warm prompt cache survives. A red-gate retry is a fresh run
whose instruction carries the ticket's most recent `gateFailure`
section — the worker continues the branch instead of starting over.
A persona run names its persona right after the ticket line (milestone
212, D-60: `Your persona: <id> (<role>) — its folder is
tickets/_meta/personas/<id>/ …`, ship and scout brief alike), which is
what lets the step prompts' Friction paragraph run; the persona's
`## Memory` slice rides the variable parts, its `thread.md` does not
(D-61 — nothing is adopted unreviewed; req-168/169).

**Which model a persona run gets (milestone 212, D-62).** The dispatch
pass resolves the model through `personaModelFor(persona, context)`:
router `off` walks `models.default` then `models.pool` in order, `budget`
the pool in order, `escalate-on-fail` the default then one pool step per
failed run of the ticket in this phase; a pool entry whose provider pool
(`fleet.pool.<provider>.size` minus the live runs, as the planner counts
them at that point of the pass) has no free slot is skipped, and an entry
may name its own provider (`kimi/k2`). The `dispatched …` log line ends
with `— model <id>: <why>`, e.g. `— model k2: sonnet: the claude-code pool
is full — pool fallback`. req-170 replaces this with class requests.

The caps are the plugin config keys `fleet.cap.gateFailureLines` /
`fleet.cap.gateFailureBytes` / `fleet.cap.diffStatLines` /
`fleet.cap.diffStatBytes` (Settings → Tickets → Fleet; defaults 40/4096
tail and 50/4096 head). Each application is logged:
`instruction: <ticket> gateFailure truncated: true, originalSize 9821`.

### chain.json fields (daemon builds)

`config` (tickets vault path, git, defaultWorker, permissionMode, caps,
handover thresholds) · `autopilot` (`{state: on | paused | off, resumeAt?}`,
the owner's switch; the runner resumes a Paused at its time) · `master`
(`run` / `halted`, derived from it: On runs, Paused and Off halt) · `columns`
(per-phase `playing` / `held`) · `redStreak` · `cooldownUntil` (per
column ISO instant) · `tokensDay` + `tokensUsed` (the per-column token
budget) · `ciBackoff` · `tripped` (per column `{reason, at}` while the
breaker holds it; playing the column clears it and resets the
column's `redStreak`) · `ownerHold` (per ticket the phase whose run the
owner stopped; the ticket holds until it moves or a newer run starts) ·
`pausedPersonas` (the personas the owner paused from the Crew view; their
tickets hold until the persona is played again — U4) · `ledgerCards`
(per ticket the keys of the ledger cards the pool raised and has not
resolved yet — req-170) · `handoverAt`
(written by a runner retiring for a newer build; a successor booting
within five minutes keeps the Autopilot as it stood — any other boot
ends as Off, also a Paused whose resume time has not passed).

`GET /chain` reports the same plus `quotaPausedUntil` (per provider,
the ISO instant its quota pause ends — not persisted) and `slots` (per
slot: busy/total, the longest window's remaining share, its reliability,
`q` and reset — req-177), `pool` (the live load) and `queue` (the tasks
waiting for the pool — req-170). The Work panel
draws both as alerts with a Resume button (chain alerts fix); a runner
that predates them omits the fields and the panel reads a hold with a
full red streak as a trip.

## Slots — accounts and their quota windows (req-177)

A **slot** is an account a worker runs on (ADR-0095 later change):
`Claude A` and `Claude B` as two Claude Code logins, `z.ai`, `Kimi`, at
work `Copilot`. Every run is bound to one slot when it starts; the
binding is on the run record (`slot: {id, label}`) and in the stream's
opening lines (`slot: Claude A`). Code: `packages/tickets-engine/src/fleet/routing/`,
wired in `fleet/compose-routing.ts`.

### `service.json` — where the slots are configured

`~/.drey-engine/service.json` (the service home; a standalone runner
takes `--home`, else the parent of a `<home>/fleet` root). Machine
scope (ADR-0092 R13): the file is created as `{ "slots": [] }` when the
runner first wakes, read again on every refresh round (an edit applies
without a restart), and a write through `POST /slots/config` replaces
only `slots` — every other key (req-173's model table, cap, providers)
is kept. A file that does not parse is never overwritten; the runner
then works with the implied slots and logs why.

```json
{
  "slots": [
    { "id": "claude-a", "label": "Claude A", "provider": "claude-code", "profile": "private", "sessions": 2,
      "billing": { "kind": "subscription", "pricePerMonth": 90, "currency": "EUR" },
      "login": { "claudeConfigDir": "C:/Users/me/.claude-a" } },
    { "id": "claude-b", "label": "Claude B", "provider": "claude-code",
      "login": { "claudeConfigDir": "C:/Users/me/.claude-b" } },
    { "id": "zai", "label": "z.ai", "provider": "opencode",
      "billing": { "kind": "subscription", "pricePerMonth": 30 },
      "login": { "opencodeAuthEntry": "zai-coding-plan" } },
    { "id": "kimi", "label": "Kimi", "provider": "kimi" },
    { "id": "copilot", "label": "Copilot", "provider": "opencode", "profile": "work",
      "billing": { "kind": "credits", "pricePerCredit": 0.04 },
      "limits": [{ "window": "month", "budget": 1000, "unit": "runs" }] }
  ],
  "quota": { "refreshMinutes": 10 }
}
```

| Key | Meaning |
|---|---|
| `id` | letters, digits, `.`, `_`, `-`; unique |
| `label` | what the boards show; default the id |
| `provider` | `claude-code`, `opencode` or `kimi` — the harness the slot's runs use |
| `profile` | `private` (default) or `work`: a repository runs only on slots of its own `profile:` (`_meta/repos.md`) |
| `sessions` | concurrent runs the account serves; absent = no cap of its own. Req-63's `fleet.pool.<provider>.size` moved here once (req-170): see "The capacity pool" |
| `billing` | `{kind: "subscription", pricePerMonth}` or `{kind: "credits", pricePerCredit}`, optional `currency` — display data |
| `login` | the harness login, **never a key**: `claudeConfigDir` (spawned as `CLAUDE_CONFIG_DIR`; absent = the default login), `opencodeAuthEntry` / `opencodeAuthFile` (the entry of opencode's `auth.json` the z.ai quota is read with), `kimiCredentials` / `kimiHome` (the Kimi CLI's credentials file; `kimiHome` is spawned as `KIMI_HOME`) |
| `quota` | where the windows come from — `claude-code`, `zai`, `kimi` or `counting`; absent = by provider (`opencode` with a `zai…` auth entry → `zai`, other `opencode` → `counting`) |
| `limits` | budgets the counting measures against: `{window: "5h" \| "7d" \| "month", budget, unit: "tokens" \| "runs"}` |
| `quota.refreshMinutes` | the refresh round (default 10); a remote quota is read at most once a minute per slot, whatever asks |

A provider no slot names runs on an **implied** `private` slot on its
default login (ids `claude-code`, `opencode`, `kimi`; `implied: true`) —
a machine without slots runs as before. An implied slot makes no network
call: Claude Code's windows come from its runs and cache, Kimi and
OpenCode are counted. The z.ai and Kimi endpoints are read only for a
slot `service.json` names.

### Where the windows come from

| Source | Windows | Reliability |
|---|---|---|
| Claude Code | the `rate_limit_event` after every assistant turn of a run on the slot (5 h, 7 d; `rejected` spends the window); between runs `cachedUsageUtilization` in the account's `.claude.json` | `measured`; the cache `estimated` |
| z.ai | `GET https://api.z.ai/api/monitor/usage/quota/limit` with the key of the opencode auth entry (5 h, weekly; the tool-call `TIME_LIMIT` is left out) | `measured` |
| Kimi | `GET https://api.kimi.ai/coding/v1/usages` with the CLI login's access token (5 h, the two monthly ratios); an expired token is skipped — the CLI refreshes it on its next run | `measured` |
| counting | every finished run on the slot (input without cache reads, plus output; or one per run) against `limits:`; behind every other source as the fallback | `estimated` after the first run, `unknown` before or without a budget |

`q = R / T` per window — the remaining share over the remaining time
share — and the slot's `q` is the minimum over its windows: above 1 the
account has more left than an even pace would use. A display value; no
run is routed by it yet (req-178).

### Slot states

| State | When | A start on it |
|---|---|---|
| `ready` | a readout or a counted run, nothing holds it | takes the run |
| `busy` | runs hold it (`busy` of `total`) | takes the run while `busy < total` |
| `exhausted` | a window at 0 left, or the provider's `rejected`; a window past its reset counts as full again (`estimated`) | refused with the window and its reset |
| `needs-login` | a run ended on `authentication_failed` / 401 / "Please run /login", or a quota read got 401 | refused, **never retried** — sign the account in (`claude` with that `CLAUDE_CONFIG_DIR`, `/login`), then `POST /slots/login-done`; a remote read that succeeds clears it too |
| `unknown` | no readout and no counted run | takes the run |

A start binds a free slot of the request's provider and profile — the
slot the resumed session lives on first, else the first in
`service.json`'s order — or is refused with each candidate's reason
(`no work slot serves claude-code: the repository is work and never runs
on a private slot — …`). A failed start frees its slot; a restarted
runner re-reserves the slots of the runs it adopts. The run's own
`failed` card is the Needs-you card of an expired login.

## The capacity pool — model table, cap, class requests, ledgers (req-170)

Every start asks the pool before a worker spawns (ADR-0095, R10). The
pool grants a model of **exactly the class the start asked for**, on a
free slot of the repository's profile, while the caps and the ledgers
have room — or the start waits: no process, no slot. **Never a smaller
class.** Code: `fleet/routing/` (`ModelTable`, `CapacityCap`, `Ledgers`,
`PoolGrant`, `PoolGate`, `RequestQueue`, `PoolMigration`; req-178's
`SlotFit`, `CapabilityFilter`, `ReserveGuard`, `SurplusChoice`, `StepUp`,
`RouteRecorder`, `CostEstimate`, `RunShareTracker`, `ModelsDevImport`),
wired in `fleet/compose-routing.ts` and `fleet/compose-pool.ts`; the chain asks it through
`orchestrate/dispatch-pool.ts`, every start through `slot-binder.ts`.

### `service.json` — the pool keys

```json
{
  "slots": [ … ],
  "models": [
    { "model": "claude-opus-4-1",   "slot": "claude-a", "category": "frontier", "class": "A", "cost": 5,   "sessions": 1,
      "input": ["text", "image"], "tools": true, "context": 200000, "output": 32000 },
    { "model": "claude-sonnet-4-5", "slot": "claude-a", "category": "everyday", "class": "B", "cost": 1,   "sessions": 2 },
    { "model": "glm-5.3",           "slot": "zai",      "category": "everyday", "class": "B", "cost": 0.4, "sessions": 3 },
    { "model": "kimi-k2.5",     "provider": "kimi",     "category": "bulk",     "class": "C", "cost": 0.3, "sessions": 2 }
  ],
  "capacity": { "global": 6, "perSlot": {} },
  "ledgers": { "ticketAllowance": 2.5, "personaPerDay": 5, "providerPerDay": 15 },
  "routing": { "upgradeAboveQ": 1.3, "reservePerWindow": 0.1 },
  "migrations": ["fleet.pool.size"]
}
```

| Key | Meaning |
|---|---|
| `models[].model` | the model id the harness is started with |
| `models[].slot` / `.provider` | the slot (account) that serves it, or a harness provider — then every slot of that provider serves it |
| `models[].category` | free text (`frontier`, `everyday`, `bulk`) — display |
| `models[].class` | `A`, `B` or `C`, A strongest |
| `models[].cost` | the cost factor: what one active session weighs against the caps (default 1) |
| `models[].sessions` | concurrent sessions of this model one slot serves (default 1) |
| `models[].input` / `.tools` / `.context` / `.output` | req-178, optional: the declared capabilities — inputs (`text`, `image`; others are dropped), tool calls (`false` keeps every agent session off the model), the context window and the output limit in tokens. Absent = not declared: a step that needs it does not take the model. `POST /models/import` fills what is absent from models.dev |
| `capacity.global` | the summed cost factors of every active session may not exceed it; `null` = no global cap |
| `capacity.perSlot` | a slot's cap by id; a slot not named takes its **derived cap** — its largest row at full sessions (board 7l: Claude A 5 = opus 5 × 1) |
| `ledgers.*` | USD defaults: a ticket's allowance when its frontmatter sets none, a persona's day when its `persona.md` sets no `budget:`, every slot's day |
| `routing.upgradeAboveQ` | req-178, board 7l's `Upgrade above q` (default `1.3`): above this surplus the chosen slot runs the next stronger model of the persona's pool it serves; `null` = never step up |
| `routing.reservePerWindow` | req-178, board 7l's `Reserve per window` as a share (default `0.1` = 10 %): a start whose estimated share would take any window of the slot below it waits; `0` = no reserve |
| `migrations` | `fleet.pool.size` once req-63's sizes moved into the slots (below) |

Only **active sessions** count: runs and held 1:1 sessions from their
start until they settle (a worker waiting for the owner still holds its
seat); a queued task holds nothing. A model the table does not hold is
*untabled*: it weighs 1 and has no class — it runs on a start that pins
it without a class (an owner's dialog with an explicit model, a ring
dispatch), or on every start while the table is empty (a machine not set
up yet); a class request never takes it.

### Who asks for which class

The chain's dispatch builds the request (`ClassRequestBuilder`) for every
ticket with a persona:

1. a ticket pin `model:` asks for that model (its row's class), `class:`
   for exactly that class — a pin beats everything below;
2. else the plan part's `size:` — **S → C, M → B, L → A** — or, unsized,
   the class of the persona's `models.default`;
3. raised to the phase's floor `min-class:` (`pipeline.md`);
4. raised, if the persona's `models.pool` holds no model of that class, to
   the lightest stronger class it does hold — raised, never lowered.

The request also carries the step's `needs:` (the phase's and the
ticket's, merged — `specs/ticket-schema.md`), the slot of the ticket's
last run (`prefer`) and whether the choice may step up (not on a pin).
The pool then routes within the class (next section). The decision rides
the run: `RunRequest.poolClass`, `poolWhy`, `ledger`, `poolNeeds`,
`poolRoute`; `RunInfo.grant` `{requested, class, model, cost, reason,
route}`; the stream's opening notes `pool: claude-sonnet-4-5, class B,
cost 1 on Claude A — size M → B` and the route line; the dispatch log
line.

### Routing within the class (req-178)

Two stages, then a possible step up, over every row of the class in the
persona's pool on every slot that serves it:

1. **The filter** (hard; `SlotFit`): the repository's profile; the
   step's needs against the row's declared capabilities (`no image input`,
   `image input not declared`, `context 128k < 200k`, `no tool calls`); the
   slot's state (`needs-login`, `exhausted`, `busy n/n`); the row's
   sessions; the provider's pause or throttle (req-63); the slot's and the
   global cap; the slot's day ledger; **the reserve per window** — a start
   whose estimated share would take any window below
   `routing.reservePerWindow` waits. The share is learned per slot and
   window from the readings around each run's end (the drop, shared among
   the runs the slot carried at once): the median of the ticket's runs
   there, else the persona's, else 5 %; in memory, so a restart starts at
   5 % again.
2. **The choice** (soft; `SurplusChoice`) among what passed: the slot of
   the ticket's last run first (its session can only resume there), then
   the **largest surplus `q`** (a slot without a reading ranks as `q` 1),
   then the cheaper cost factor, then the cheaper slot price, then the
   pool's order.
3. **The step up** (`StepUp`): when the chosen slot's `q` is above
   `routing.upgradeAboveQ`, it runs the next stronger model of the
   persona's pool that **the same slot** serves (the lightest class above
   the granted one), if that model passes the filter there too. One step,
   only upwards, never onto another slot, never on a `model:` / `class:`
   pin. **Never a smaller class** — nothing of the class passed → the
   start waits.

Every decision is one line in the runner log and the run's stream:

```
route T-0121 → claude-a/sonnet: class B, q 1.4, est $0.40 · filtered: kimi (no image input)
route T-0130 → claude-a/opus: class A (step up from sonnet, B), q 1.6, est $1.80
```

`est` is the median cost of the most similar ended runs (the ticket on
the model, the ticket, the persona on the model, the model; `?` without
history); `filtered` names each other slot once with its reasons (the
chosen slot's own refusals stay on the record only). The record is
`RunInfo.grant.route` `{slot, model, class, requested, q, estimatedUsd,
stepUp, filtered: [{slot, model, reason}], line}` — on `GET /status`
and `GET /status/<run>`. The chain's dispatch routes first; the start's gate
(`PoolGate`) keeps that slot and class (a step up stays one), filters the
needs again and records the dispatch's route when the start landed where
it routed.

### Waiting

No grant → the task **queues**: the chain status's `queue` lists it
(`{ticket, persona, class, reason: capacity | ledger | config, line,
detail, position, since}` — `line` is the card's `waits for a B slot`),
the log says it once (`dispatch waits T-0122: queued · waits for a B slot
— Claude A: 2 of 2 claude-sonnet-4-5 sessions busy (asked B: size M →
B)`), and the dispatcher goes on with the next task whose class has room.
Every pass rebuilds the queue in dispatch order (priority class, the
rightmost column, position), so when a run settles the next pass serves
it front to back. `reason: config` means waiting will not help: the
persona's pool holds no model of the class, a row's cost is above a cap,
no slot of the profile serves it — fix `service.json` or the persona.

### The three ledgers

Sums over the session records (every `run.json` the runner holds — run
telemetry, ADR-0081), never counters of their own; a day is the UTC date
a session started:

| Ledger | Limit | Full → |
|---|---|---|
| ticket | the ticket's `allowance:`, else `ledgers.ticketAllowance` | waits — unless the persona's `allowed: spend-above-allowance: true` |
| persona per day | the persona's `budget:`, else `ledgers.personaPerDay` | waits until tomorrow (or a higher budget) |
| provider per day | `ledgers.providerPerDay`, per slot | that slot grants nothing today; another slot of the class may |

A full ledger raises **one Needs-you card**: a keyed status comment on the
ticket (`blocked: [ledger-ticket] T-0122 has spent $2.61 of its $2.50
allowance — raise the ticket's allowance: …`; keys `ledger-ticket`,
`ledger-persona-<id>`, `ledger-provider-<slot>`), written once, kept in
`chain.json`'s `ledgerCards`, and closed with `resolved: <key>` when the
pool grants the ticket again.

### The old pool sizes (req-63)

`fleet.pool.<provider>.size` (Settings → Runners) moved once, on the first
chain config after this build: the size became the `sessions` of that
provider's slots that named none, a provider without a slot got its
implied slot written out with it, and `migrations: ["fleet.pool.size"]`
marks it done — a later size in the plugin config changes nothing. The
dispatch plan's per-provider bound is now the sum of the provider's slots'
`sessions` (unbounded when one slot names none); the probe of a local
server (`fleet.pool.opencode.probe`) and the rate-limit shrink still lower
it. The router policies of `models.router` (`off | budget |
escalate-on-fail`) are gone; an old `router:` key in `persona.md` is
ignored and dropped on the next rewrite.

## The tickets remote is not the runner

The phone/tablet remote (req-66, ADR-0086) is a separate server in the
tickets plugin itself (Settings → Tickets → Remote access, default port
47811). It reaches the runner only through the plugin's `FleetClient`;
the runner's port and token stay on loopback and are never handed to a
device. Its own log lines start with `remote:` in the plugin log.

## What the Autopilot governs (req-154)

The Autopilot decides one thing: whether tickets are **moved on or started
by themselves** (On), only finish what runs (Paused), or wait for the owner
(Off). It does not decide whether anyone may talk to an agent:

- **Chats need the chat bridge, not the chain.** Mission Control (desktop
  Assistant target, iPad, phone), Shape with Paul and a Crew 1:1 run
  through the engine's `ChatService` and the `chat.*` config (the LLM over
  HTTP) or write the persona thread file — none of them reads the
  Autopilot, the chain status or whether the runner is up.
- **What genuinely needs the runner starts it on demand, Autopilot or not.**
  A run start (`FleetClient.start`), a message to a run (`send` — a
  reopenable ended run resumes under a fresh runner) and the Autopilot
  switch itself go through `ensureRunner`. Reads (`runs`, `chainStatus`)
  never spawn; answering a permission or question only makes sense for a
  live run and uses `withRunner`.
- **The runner's own lifecycle stays (req-110).** A runner started for a
  chat-run boots with the Autopilot Off (the boot rule); every POST resets
  its idle clock and a live run keeps it, so it never sleeps mid-run, and
  once the run settles it sleeps after the idle span. Only an explicit Off
  puts it to sleep at once. Since req-164 "start" is a wake of the Crew
  runner component inside Drey Service, and "leave" is its sleep; the
  service process itself has a second, outer sleep (SERVICE.md). With the
  background service **off** (the default) the runner's runs end with Drey:
  closing Drey with a live run asks *Stop the runs and quit* / *Keep running
  (enable the service)* / *Cancel*, and the service follows Drey out.
- **A down runner reads as Off (D-51).** No runner means `chain: null` in
  the fleet snapshot; every client shows that as Off and the switch turns
  it On from there. A start that fails is refused with its cause
  (`runner_down` + the error), never a bare "not running".
- The 1:1 that routes into a runner session (the coaching thread) is
  req-152's design and not covered here yet.

## Lifecycle gotchas

- **Which checkout runs it**: the runner lives in the Drey Service some Drey
  instance started. `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"`
  shows the command line — `electron.exe <checkout>\dist-electron\packages\tickets-engine\src\service\service-main.js --home <home> --vault <vault>`.
  A worktree checkout (e.g. `Drey-t0007` on its ticket branch) may run
  newer fleet code than `main` — feature parity questions go there first.
- **Restart**: `POST /components/runner/stop` on the service (graceful,
  stops live runs) — the next run start wakes it again. The whole service
  is retired when a Drey start finds an older build running (a different
  content hash in `service.lock`'s build stamp — a rebuild of unchanged
  code keeps it); that retirement is a handover, so live workers carry on
  under the new service's runner (`handover` in a `run.json` marks a run in
  transit; the new service wakes its runner at boot to take them back).
- **Single instance**: one service per home (SERVICE.md); the runner inside
  it writes no descriptor of its own. `runner.js --root` by hand still runs
  a standalone runner with `runner.json` — a debugging tool only; never
  beside a running service on the same root.
- **Sleep when deactivated or when Drey quits (req-110)**: the Autopilot
  switched **Off** (the popover, Settings → Tickets, the Notaus) puts the
  runner to sleep at once when nothing is live — a live run keeps it, and the idle
  span takes over once the run ends. When **Drey quits** the engine, which
  outlives Drey, notices its last Drey event stream closing (5 s grace, so
  a reconnect is not a quit; a second `DREY_MULTI_INSTANCE` Drey still
  subscribed holds it) and sends `POST /retire-if-idle`; the plugin's
  deactivate asks the same, best-effort. The runner leaves only with no
  live run and no On/Paused Autopilot — a running chain keeps draining
  the board with Drey closed (ADR-0075/0077), and the phone's runs are
  untouched. The next start wakes the runner again.
- **Idle sleep**: no live runs, no On/Paused Autopilot and ~15 min
  without a **write** (a POST) → the runner goes to sleep. Not a
  malfunction. Reads (`/health`, `/status`, `/chain`, …) do not count:
  before req-110 they did, and the engine's 2.5 s poll kept the runner
  alive for as long as the engine lived — the leftover processes the
  owner found.
- **No global Node**: the service is Electron-as-Node. To start it by hand
  (rarely needed), use the checkout's electron binary with
  `ELECTRON_RUN_AS_NODE=1`, or the repo's vendored Node (`. .\env.ps1`, then
  `.tools\node\node.exe service-main.js --vault <vault>`; SERVICE.md).

## Diagnosing common symptoms

- **Runner unreachable** → `service-main.js --status`: is the service up,
  and the runner row `sleeping` (wakes on demand), `running` or `failed`
  (the reason)? Then the tail of `runner.log` and `service.log`.
- **Ticket not being dispatched** (daemon) → `GET /chain` + `/log`:
  master `halted`? column `held`? cooldown active? token budget exhausted
  (`tokensUsed` vs day)? ticket claimed, carries a `run` stamp, has
  validation errors, or — most common — **no backticked acceptance criteria**,
  which the machine gate refuses to run (the refusal says what it found: prose, an empty section, none). Since T-0050 also: the ticket
  is **blocked** — `blocked-by:` names ids that have not reached the
  last phase, and the dispatcher skips it by design; the log says
  `dispatch holds <id>: blocked by <ids> — the blockers must reach the
  terminal phase first` (an id missing from the board blocks too, and
  warns on the card). It dispatches by itself once every blocker
  reaches the last phase. A candidate queued behind
  something says so (`dispatch waits … no free <column> worker slot yet`,
  or `… <column>'s dispatch of <id> was refused — the queue cannot
  advance` when a refused start parks the queue; the refusal itself is
  logged once, deduped).
- **`worktree … is on main, expected t/<id>`** (an old refusal) → a
  removal leftover at the path (junctions, no `.git` of its own) whose
  rev-parse walked up into the tickets vault — a repo — and reported the
  vault's branch. The toplevel guard now reads that as "no longer answers
  to git": the leftover is moved aside (`.stale-<stamp>`) and a fresh
  checkout takes its place, logged as `moved-aside`.
- **Run stuck** → `/status` state + stream tail; `stopping` for long means
  the worker ignores the stop — the supervisor tree-kills, give it a moment,
  then check the pid.
- **Where did the agent work?** → since T-0044:
  `<tickets repo>/_worktrees/<ticket-id>/` on branch `t/<id>` (a repo's
  `worktrees:` override moves the base); pre-T-0044 runs:
  `<fleet root>/worktrees/<repo>-<ticket>`, until the boot migration
  collects them. Inspect with `git -C <worktree> ...`. Folders listed under
  the repo's `link:` in `repos.md` (req-56) are junctions into the
  owner's checkout — the stream's `worktree links:` line says which were
  linked or left out and why. Before removing a worktree by hand, remove
  its junctions (`cmd /c rmdir <worktree>\node_modules` removes the link,
  not the target) — never a recursive delete through them. The runner's
  own recreate does that itself. The runner writes no
  ticket file: its bookkeeping is the claim's release, comments and the in-claim `put` (req-176).
- **`worktree add` says the branch is "already checked out"** (a settled
  ticket's leftover checkout somewhere — the re-run trap) → the runner
  heals this itself when the conflicting tree is clean and not live; if
  it refuses (dirty or live), clean or stop that tree, or use the board's
  card menu / "Clean up worktrees".
- **A worker's npm or Electron behaves oddly** → the runner drops the
  `npm_*`, `INIT_CWD` and `ELECTRON_RUN_AS_NODE` variables it inherits
  at boot (req-56; `runner.log` names them); a runner started before that
  build still hands them on.
- **A transition did not reach the remote** → a run's move is a `dk`
  release (req-176): the store's own sync carries it; pipeline.md's `push:`
  applies to the board's file-backend moves only.
  Archived tickets (`tickets/archive/`, T-0041) never dispatch and never
  count toward the board — the owner archives and deletes them by hand.

## Pointers

- Code: `packages/tickets-engine/src/service/runner-component.ts` (the runner
  as a service component, req-164), `packages/tickets-engine/src/fleet/`
  (`runner.ts` — the composition root, `runner-lifecycle.ts` — when the runner may sleep, req-110;
  `run/` — the run state machine; `orchestrate/` — the supervisor's and the chain's parts, the one
  ticket writer `RunBookkeeper`; `api/` — the HTTP routes; `store/` — the ticket store port;
  `harness/` — the adapter contract and the Claude Code, OpenCode and Kimi adapters; `orchestrator.ts`, `chain.ts`, `protocol.ts`; ADR-0096), client side
  `packages/tickets-engine/src/services/fleet-client.ts`; the Drey-gone
  signal `packages/tickets-engine/src/server/drey-presence.ts`
- Specs: `specs/ticket-schema.md` (tickets, gates, agent lane rules),
  ADR-0075/0076 (+0077 for the chain), `specs/changelog.md` M84+,
  manual §13 "Running agents on tickets"

## Prompt versions (milestone 96)

Every shipped prompt in `packages/tickets-engine/prompts/` opens with
`<!-- drey-prompt-version: N -->`. Vault copies are snapshots seeded from
it, so a copy with a lower number — or none — is older than the shipped
default: the runner logs that once per prompt (`prompt "build-default" in
the vault is older than the shipped default (v0 < v2)`) and Settings →
Tickets → Prompts › *Reset to the shipped version* brings the fixes in.
The marker line never reaches the model. Bump the number when a shipped
prompt changes in substance.

## Kimi Code (E10-8)

`kimi` is the third adapter (`packages/tickets-engine/src/fleet/harness/kimi.ts`): `kimi acp` over stdio, approvals and questions held for the owner, `/compact` native, resume by `session/load`. Tokens come from Kimi's wire log, cost from the price table. See `docs/design/kimi-worker.md`.
