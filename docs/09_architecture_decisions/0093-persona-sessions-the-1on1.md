# 0093 — Persona sessions: the 1:1 is a session of the persona's own harness

## Status

Accepted — the 1:1 half built as milestone 228 (req-168, 2026-11-09), the
memory and journal half (R4/R14: `memory.md` written by model and owner,
`reviews.md`, the closing round) as milestone 229 (req-169, 2026-11-09);
both "As built" below. Designed in the session of 2026-11-07/08 (owner rulings R1–R4 in
`docs/design/work-panel/crew-internals-concept.md`). Amends ADR-0088's E3
(the coaching thread) and concept v2 §4.5/§4.7 (the persona chat as a direct
call). Resolves D-52.

## Context

The Crew tab's 1:1 appends the owner's line to `thread.md`; the persona reads
it at its next run; nothing answers. The owner expects a conversation with
the persona that reads its memory and may write it. The Mission Control chat
and Shape with Paul run over the engine's chat bridge, a direct HTTP call
with the Drey assistant's model; a persona on a CLI worker (Claude Code,
Kimi) has no endpoint that bridge can speak, so over the bridge the
assistant's model would answer, not the persona. The owner also wants the
persona to reach the board and the vault *without* being handed everything:
*"dem Modell nicht alles geben, ihm aber den Zugriff geben"* — a tool call.

## Decision

**A 1:1 is a session of the persona's own harness and model** (worker and
model from its pool), started quiet (req-75's hold) with no ticket and no
worktree, **requested from the pool like any task** (ADR-0095), held while
the conversation continues and released after the idle span (req-157).
A persona with `worker: api` talks over the chat bridge instead — the worker
key decides the way, as today.

**A lean toolset.** The 1:1 session gets read access only: the board and the
tickets (the `fleet_*` and ticket tools), the vault read tools over the
service's MCP (ADR-0094, R5's default), the persona's own memory and journal.
Never the build set, never a shell in a worktree.

**Its context.** `persona.md`, `prompt.md`, the skills, `memory.md`, the
conversation so far, and a short list of the persona's latest runs (ticket,
outcome, cost, gate failure). The board is not embedded; it is asked for.

**Where it lives.** A chat session file under `tickets/_meta/chat/` with a
`persona:` key, in the Mission Control session format: one commit per round,
proposal cards the owner accepts or dismisses. `thread.md` is retired; its
lines migrate once into the persona's first 1:1 session. The context pack's
"Coaching" section goes with it: what the owner wants a run to know lands in
memory or in an accepted proposal, nothing else rides along.

**Memory.** The persona writes `memory.md` directly, so does the owner; every
line carries its author and evidence (date, ticket, persona/model or `you`)
and is removable one by one on the Memory tab; a run writes only when
something was out of the ordinary. Prompt, skill and model changes stay
proposal cards (nothing adopted before a 1:1). A run's *finding* is kept
apart from its *lesson* (R14): the finding goes to `reviews.md` in the
persona folder (one entry per run — model, ticket, gate, cost, `friction:`;
`friction.md` goes up in it and the prompt-proposal aggregation reads the
journal), the lesson to `memory.md`. Both are written in **one closing
round** of the session after the gate verdict, and only **on a signal** (red
gate, retry, an owner steer, cost far above the typical run, self-reported
friction; configurable) — a smooth run costs no round. The report groups
the journal by model, which is what answers "would another model do
better".

## Consequences

- The Crew tab's 1:1 tab becomes a conversation with a live session: the
  composer sends to the session, the answer streams, cards appear for what
  the persona proposes. Mission Control's "Talk to <name> 1:1" (E13-19)
  opens the same session file.
- A 1:1 costs a slot while held and nothing while idle; the pool shows it as
  a session like a run; the service's Sessions area shows it raw.
- Concept §4.7's table row "persona chat → direct" is superseded; the
  reasoning (cheap single shot) loses to identity and tools.
- The context pack loses `personaCoachingSection`; `thread.md` reading goes
  with the migration.
- Open: the exact 1:1 tool list, the line formats of memory and journal (fixed by milestone 229),
  and whether Shape with Paul follows into a session once the numbers of
  req-109 are in. A `memory_write` tool during the run is a later item.

## As built (milestone 228, req-168, 2026-11-09)

- **The session.** A 1:1 is a run record of the Crew runner with
  `kind: '1:1'` (R12's kinds typed as `run | 1:1 | shape | free`;
  `shape` and `free` are req-173's), the persona, an explicit
  `workingDirectory` (the tickets repository) and the `chatFile`
  (`fleet/protocol-session.ts`). `OneOnOneStarter`
  (`fleet/orchestrate/one-on-one-starter.ts`) starts it: the pool's grant
  through the same `SlotBinder` as a run (the persona's and the provider's
  ledgers; the ticket allowance does not apply — `RunLedgerInput.noTicket`),
  no claim, no worktree, the worker spawned **quiet and held** with
  `PermissionMode 'read-only'`; one live 1:1 per persona. The owner's first
  line wraps the brief once (the steer path of req-75), later lines go
  alone. `IdleRelease` (`orchestrate/idle-release.ts`, the reaper's first
  look at a live run) lets a held 1:1 go after 15 minutes without a turn —
  never mid-turn, never while it waits on the owner — and it settles
  `done`, its slot freed. The worker's own end ends the session (the exit
  verdict `session`), an ended 1:1 never reopens in place, and a 1:1
  writes no memory line.
- **The request.** `OneOnOneRequestBuilder` (`fleet/one-on-one-request.ts`):
  the persona's harness (`worker:`) and its default model (else its pool's
  first entry of that harness), the model table's class of that model as
  `poolClass`, the persona's budget on the ledger input.
- **The context.** `composeOneOnOneBrief` (`fleet/one-on-one-brief.ts`,
  the text in `specs/classifier-spec.md`), read by
  `services/persona-session-context.ts`.
- **The toolset.** The harness's own read tools in the tickets repository
  under its read-only mode; of the MCP tools exactly the read-only cut
  (`fleet_status`, `fleet_watch`, `vault_list`, `vault_search`,
  `vault_read` — `fleet/one-on-one-toolset.ts`), attached through one
  named seam, `OneOnOneToolSeam`. **Later change (milestone 234, req-217):**
  the seam is implemented by Drey Service's vault MCP component
  (`OneOnOneVaultTools`): a 1:1 gets the vault MCP with a read-only token
  (the grant refuses every change; the token also carries a tool cut, so
  only `vault_list`, `vault_search`, `vault_read` are offered or
  callable) and the brief's `## Tools` names exactly those three — none
  for an `api` persona or while the endpoint does not listen.
  `fleet_status` / `fleet_watch` are Drey's own server's tools and not
  served by the service, so they stay unattached (req-252). A free session
  shares the starter but keeps its persona's rights, not this cut (R12:
  a free session is not read-only).
- **Where it lives.** The chat session file with `persona:`, multi-line
  messages, the `migrated` line and persona proposal cards (`prompt` |
  `skill`, adopted on Accept through the persona patch) —
  `core/persona-session-file.ts`, `core/persona-session-parse.ts`, format
  in `specs/ticket-schema.md`. `PersonaSessionService`
  (`services/persona-session-service.ts`) writes the owner's line (one
  commit), starts or reuses the held session, waits for the turn's end on
  the fleet's change push (`PersonaTurnWatcher`) and lands the answer with
  its cards (one commit); `thread.md` migrates once into the first session
  (`PersonaSessionFiles`). The routes stay `personaThread` /
  `personaThreadAppend` (`GET|POST /api/personas/<id>/thread`) with a
  richer reply (cards, session state, release time, cost, failure), plus
  `personaProposalDecide` (`POST /api/personas/<id>/thread/proposals/<p>/
  <confirm|dismiss>`).
- **The clients.** The Crew tab's 1:1 pane and the Assistant's 1:1 target
  over one mapping (`plugins/tickets/renderer/conversation/persona-map.ts`);
  Mission Control's *Talk to <name> 1:1*; the service window's Sessions
  tab (`1:1 · Ben` — `held · releases in 11 min`, the Directory row).

**Built differently from the decision above:**

1. *"The answer streams"* — the answer lands when the turn ends: the turn
   watcher reads the run's stream on the fleet's change push and the
   clients re-read the session file. Live deltas over ACP are req-204;
   for the 1:1 they are req-218.
2. *"The vault read tools over the service's MCP"* — not attached when the
   1:1 shipped (req-167's capability was not on this base); attached since
   milestone 234 (req-217), the fleet's two read tools excepted (req-252).
3. *"Requested from the pool like any task"* — the class asked is the
   model table's class of the persona's own default model on its harness;
   there is no class pick over the persona's pool and no step up (req-220).
4. A persona with `worker: api` answers over the chat bridge with the 1:1
   brief as its system prompt and a JSON envelope rule (the bridge reads
   one envelope per reply).
5. The idle span is fixed at 15 minutes (`shared/session-lifecycle.ts`);
   its setting is req-219.

## As built (milestone 229, req-169, 2026-11-09) — the memory half

- **The journal** — `reviews.md` in the persona folder, one entry per
  noteworthy run: the runner's facts (ticket, harness/model, gate, cost,
  the signals) plus `friction:` and the closing round's
  `finding (<model|prompt|task|environment>):` (`core/persona-journal.ts`,
  `core/persona-journal-file.ts`; format in `specs/ticket-schema.md`).
  `friction.md` goes up in it: migrated once (one logged commit, the file
  removed — `services/persona-records.ts`), and the improvement loop reads
  the journal's `friction:` fields after its last aggregation stamp.
- **The lesson** — at most one line per closing round, written directly
  into `memory.md` as `- <date> · <ticket> · <persona>/<model> · <lesson>`;
  the owner's lines `- <date> · you · <lesson>` (`core/memory-line.ts`).
  Older lines stay readable with no author. The context pack takes the
  owner's and pinned lines first, the persona's after, under one cap.
- **The trigger** — `ClosingSignalRule` (`fleet/orchestrate/closing-signal-rule.ts`):
  red gate, retry, owner steer (`steerCount`), cost outlier (> 3 × the
  median of the persona's last 20 settled ticket runs with a cost, from at
  least 5), the worker's `FRICTION:` line; the list is `_meta/pipeline.md`
  `closing-signals:` (default all five), carried on the request.
- **The write path** — `ClosingRound` (`fleet/orchestrate/closing-round.ts`),
  called by `RunCompletion` on the gate path: the prompt
  (`fleet/closing-round-prompt.ts`, in `specs/classifier-spec.md`) into
  the run's own session, resumed read-only by `ResumeRoundAsker`; one
  JSON answer, capped; a prompt or model change only as an open
  `improvements.md` proposal (R11).
- **The Memory tab** — Memory and Journal listed apart, every line and
  entry removable (`POST /api/personas/<id>/memory/remove`,
  `GET /api/personas/<id>/journal`, `POST …/journal/remove`), pin as
  before, the owner's line added directly; on the Crew tab
  (`plugins/tickets/renderer/team/memory-pane.ts`) and in Mission
  Control's team detail.
- **The report** — `GET /report`'s `byModel` groups every persona's
  journal by harness/model (`core/journal-report.ts`).

**Built differently from the decision above:**

1. *"One closing round of the session"* — a run's worker has exited by the
   time its gate decides, so the round **resumes the same session by its
   ref** in a fresh process of the same harness, read-only. A harness that
   cannot resume it, or a run without a session ref, gets **no round**:
   the entry is written from the runner's facts with a note (a fresh
   request of the same model was rejected — it never saw the session).
2. The round is **bounded at 10 minutes** (it holds the run's ticket and
   slot); the run's own work stays unbounded (ADR-0014).
3. The round runs only on the gate path; a blocked, scout or no-result
   run has no gate verdict and gets none.
4. *"Self-reported friction"* — a `FRICTION:` line of the worker's final
   message (the step prompts ask for it), not a file.
5. The runner's journal, lesson and proposal writes are plain file writes
   in the tickets repository, as the E3 memory line was — the runner does
   not commit them (req-225).
6. *"The persona's own memory and journal"* in the 1:1's toolset — the
   1:1 brief keeps reading `memory.md`; the journal never enters its
   context (R14: the finding is evidence, not instruction).

## Later change (2026-11-09 — milestone 230, req-173): the 1:1 is one kind of held session

`OneOnOneStarter` became `HeldSessionStarter` with a kind per held session — `OneOnOneKind` (one live 1:1 per persona, the tickets repository, read-only, its chat file) and req-173's `FreeSessionKind`; the 1:1's behaviour is unchanged. Its record is a session record (ADR-0092 later change): kind `1:1`, the tickets repository as its working directory, state `held` while it waits for the owner's next line. The idle span is one constant for every held session (`HELD_SESSION_IDLE_MS` = `ONE_ON_ONE_IDLE_MS`, req-219).
