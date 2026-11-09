# ADR-0096 — Crew runner refactor: run state machine, ports and adapters, one ticket writer, the file-size rule

## Status

Proposed (owner decisions of 2026-11-08, after the review of his Grobkonzept
"Drey crew" against the code). Amends ADR-0075 (the runner's internal
structure), ADR-0077 (the orchestrator) and ADR-0088 (the engine package's
`fleet/` folder). Built as req-176. The alternative the concept weighed, a
new runner in Go as a separate product, is recorded in `specs/decisions.md`.

## Context

The owner found the runner logic hard to follow. The survey of 2026-11-08
named the causes, none of which is the language:

| Place | Finding |
|---|---|
| `RunSupervisor` in `packages/tickets-engine/src/fleet/runs.ts` | 3043 lines, about 79 methods: process supervision, steering, handover, gate, ticket files, dricket leases, git, telemetry, persona memory, persistence |
| Run state machine | none; `RunState` is a union type, about ten scattered assignments, only the terminal states run centrally through `settle` |
| Ticket writers | two beside the board service: the supervisor and the orchestrator both patch tickets themselves |
| `fleet/providers.ts` | 2027 lines: the contract, helpers and two adapters in one file; `kimi.ts` is already apart |
| Ports | `fs` and `child_process` imported directly in about 17 fleet files; `now` injected per module, no `Clock`; the specs of the three big modules are bigger than their code |

Across `packages/` 37 non-spec files exceed 300 lines (`board-service.ts`
4805) and 17 specs exceed 400. ESLint carries import boundaries and the cycle
check, but no size or complexity rule, which is how the files grew.

The adapters (stream-json with hold and re-attach, opencode SSE with question
forms and permissions, Kimi ACP) hold months of edge cases; 13.7k lines of
fleet code, 44k lines of engine and 35k lines of specs would be written again
by a rewrite. The vault MCP (ADR-0094) stands on the pure `shared/`
functions; the tray UI (req-165) needs Electron anyway.

## Decision

**TypeScript, refactored in place; no rewrite.** The runner stays the Crew
runner component of Drey Service (ADR-0092) in `packages/tickets-engine/src/fleet/`,
rebuilt along ports and adapters:

```
packages/tickets-engine/src/fleet/
  run/          RunState, RunEvent (unions), RunRecord, RunStateMachine, RunLimits
  orchestrate/  RunSupervisor (thin), ProcessSupervisor, SteerService, GateRunner,
                RunBookkeeper, RunRepository, Dispatcher, Breaker, TranchePolicy,
                ChainStateStore; HandoverResolver and Telemetry as they are
  routing/      SlotRegistry, QuotaSource (port), SurplusCalculator, ClassRouter, Ledgers
  harness/      HarnessAdapter (port), ClaudeCodeAdapter, OpencodeAdapter, KimiAcpAdapter,
                AcpClient, StreamJsonCodec, NormalizedEvent
  workspace/    WorktreeProvider (port), GitWorktrees, WorktreeCleaner
  store/        TicketStore (port), DkTicketStore, FakeTicketStore
  governor/     ResourceGovernor (port), SeatPool, WindowsProcessPriority
  api/          RunnerHttpApi (one handler class per route group), EventStream (SSE)
  ports/        Clock, FileSystem, ProcessSpawner, EventSink
  runner.ts     the composition root, the only module that knows every adapter
```

**Rules of the structure.**

- Interfaces live at the consumer and stay small; adapters satisfy them
  structurally. Optional capabilities are optional methods on the interface
  (`interrupt?`, `answerQuestion?`), never capability flags.
- **States change only in the state machine**: `RunStateMachine` holds the
  state type and the transition table; every assignment runs through it;
  adapters report events, the orchestrator asks the machine.
- **One ticket writer.** Every write to a ticket, log line, memory or Verlauf
  entry — the supervisor's and the orchestrator's alike — goes through
  `RunBookkeeper` over the `TicketStore` port. The legacy file-based writer
  is dropped with this refactor (E14-9b parts 1 and 2, pulled forward for the
  runner; owner decision 2026-11-08): `TicketStore` has one implementation
  (`DkTicketStore`) and one fake. A run record from before the cut-over is
  read as today and never written (D-42).
- Composition over inheritance; one supervisor per session; events over the
  normalized event stream; cancellation over `AbortSignal`.
- The layering is enforced by the tooling, not by discipline: ESLint
  import-boundary rules between the sub-packages (`run` imports nothing;
  `harness/*` never from `orchestrate`; only `runner.ts` imports all),
  `scripts/check-cycles.mjs`, and an architecture spec in vitest over the
  import graph that runs in the gate.
- Configuration (slots, pools, limits) enters the composition root as data,
  in the three layers of R13 (`service.json`, `_meta/`, the session record).

**The file-size rule (owner, 2026-11-08; the backend OOP rule in
`CLAUDE.md`).** Target 200 lines per file, hard limit 300 (specs 400); a
function at most 60 lines; at most 4 parameters; cyclomatic complexity at
most 12; one class per file. ESLint enforces `max-lines`,
`max-lines-per-function`, `max-params`, `complexity` and
`max-classes-per-file` on `packages/**`; today's offenders are listed in
`eslint.size-baseline.mjs` and the list may only shrink — a file a milestone
touches leaves the list or is split in that milestone. Lines are counted
without blank lines and comments. Specs get the file limit only (400), since
a `describe` block is one long function by nature. Switched on 2026-11-08
with a baseline of 93 of the 299 files under `packages/` (the five rules
together; `max-lines-per-function` and `complexity` account for most of the
files that are under 300 lines).

**Order of the work** (each step a ticket; the gate is the existing specs
staying green): (1) extract the state machine; (2) split `RunSupervisor` by
responsibility and route every ticket write through `RunBookkeeper`; (3)
split `providers.ts` into `harness/contract`, `harness/claude-code`,
`harness/opencode` and give the Kimi adapter an interrupt (ACP
`session/cancel`); (4) `Clock` and `FileSystem` as ports of the core; (5) an
event stream (SSE) on the runner, or the runner's events over the engine's
`/api/events`. One Opus session, sequential, because the three files are
single files. The 12k spec lines stay as characterization tests through every
step; each new class gets unit tests with fakes (`Clock`, `FileSystem`,
`ProcessSpawner`, `FakeTicketStore`); the real adapters and the fakes run
through one contract test suite.

**ACP is the target adapter protocol.** Kimi already speaks it; Copilot CLI,
opencode, Claude Code and Gemini CLI are listed as ACP-capable (third-party
lists of April 2026; verify in the registry). One `AcpClient` serves them;
the stream-json and SSE adapters stay until interrupt, resume, permissions
and questions are proven over ACP per harness (req-182).

## Consequences

- The structural pain is addressed where it is; nothing the adapters learned
  is lost, and the vault MCP, the service and the tray UI keep one runtime.
- The refactor lands before the concept's features (slots, tranches,
  governor): they are built on the new boundaries, not into the monoliths.
- The size baseline makes the rule a ratchet: every milestone that touches a
  listed file leaves `packages/` a little shorter; the first lint run after
  the refactor must show `fleet/` with no file above 300 lines.
- What Go would have done better — a native helper for Windows Job Objects
  and `nice` in the governor — stays possible as a small native piece behind
  the `ResourceGovernor` port, and is not a reason to change the core's
  language. The port exists since milestone 223 (req-180, ADR-0092 later
  change): `fleet/governor/` with `ResourceGovernor`, `SeatGovernor`,
  `SeatTable` (the planned `SeatPool`) and the rules; the priority runs over a
  `ProcessPriority` port with a Node adapter (`os.setPriority`) — no native
  helper was needed for the priority class (a Job Object's CPU cap stays
  req-194).
- Risk: splitting a 3000-line class with 2500 lines of coupled specs takes
  discipline; the step order and the "specs stay green" gate are the
  protection, and a step that needs a spec rewrite says so in its ticket.

## Later change — ACP is the one adapter protocol, Claude Code the exception (req-182, milestone 226, as built 2026-11-09)

The owner ruled on 2026-11-09: every harness that speaks the Agent Client
Protocol natively runs over it, the old adapters go; Claude Code stays on
headless stream-json. As built:

- **One adapter, one client.** `harness/acp-adapter.ts` (`AcpAdapter`) and
  `harness/acp-client.ts` (`AcpClient`) serve **Kimi Code** (`kimi acp`),
  **opencode** (`opencode acp`, replacing the `opencode serve` HTTP/SSE
  adapter) and **Copilot CLI** (`copilot --acp --stdio`, a new
  `WorkerProviderId` `copilot`). What sets a harness apart is a thin
  launch description, `AcpHarness` (`harness/acp-harness.ts`): the command
  and its environment, what `initialize` advertises (`elicitation.form`
  for opencode and Copilot), the resume order (`session/resume` when the
  agent advertises it, else `session/load`), the config options a model
  pin sets (`model`, opencode's `effort` for a `#variant`; none for Copilot,
  whose model rides `--model` at launch), the session mode for a
  permission mode, the usage source, and whether an empty turn is a
  refusal. Composition, not a subclass per harness: the worker's parts
  (`AcpSessionOpener`, `AcpTurns`, `AcpRequests` + `AcpForms`,
  `AcpUpdateFold`, `AcpCost`) are one set, wired in the adapter.
- **The four capabilities per harness**, asserted by the contract suite
  (`harness/contract.spec.ts`, one driver each): interrupt =
  `session/cancel`; resume = `session/resume` / `session/load`;
  permissions = `session/request_permission`; questions = Kimi's
  AskUserQuestion (a permission request in disguise) or an
  `elicitation/create` form (opencode's question tool — opencode sends it
  only to a client that advertises `elicitation.form`; without it the tool
  fails with "the question couldn't be shown"). Usage: opencode's prompt
  reply carries the turn's tokens and its `usage_update` the context window
  and the session's cost; Kimi's tokens stay in its wire log
  (`KimiWireMeter`). opencode was measured live (2.0.32, all four plus
  usage, `harness/acp-live.spec.ts`); Copilot CLI was not installed on the
  build machine and is proven with fakes only (roadmap req-208).
- **Claude Code stays on stream-json — the one documented exception.**
  Claude Code has no native ACP (anthropics/claude-code#6686 is open); the
  only route is the third-party bridge over the Agent SDK, Anthropic forbids
  subscription OAuth in third-party harnesses since February 2026, the
  owner's Claude slots are subscription accounts, and the quota windows the
  slots route by (`rate_limit_event`, req-177) exist only in stream-json.
  Revisit when #6686 ships.
- **The opencode server adapter is removed** (server launch, poller, SSE
  fold, message walk, attach, catalog, ~2.9k lines with specs). What it had
  and ACP does not carry is on the roadmap: re-attaching a worker that
  outlived its runner (the `attach` seam stays in the contract with no
  implementer — every ACP harness is a stdio child of its runner; req-205),
  live text deltas (req-204), a steer queued behind the running turn instead
  of cancelling it (req-206), per-model-call telemetry (req-207). The
  context cap (req-80) still rides opencode's launch as inline config.
- **Copilot's isolation from outside** (Spike 7). Copilot fixes its settings
  at launch; an unattended start allows its tools (`--allow-all-tools`), a
  read-only start allows nothing up front so a permission request — if the
  installed version sends one (github/copilot-cli#845) — reaches the owner.
  No read-only session mode is documented: then read-only is not enforced in
  the session, the run's stream says so once, and the review checkout's
  read-only files (req-183) plus the worktree and the governor are the
  boundary.

Trade-off accepted: one protocol and one set of worker parts against the
features a harness's own richer API offered (opencode's server outliving its
runner, its queued prompt delivery, its per-message usage). The owner chose
one protocol (`specs/decisions.md`, 2026-11-09).
