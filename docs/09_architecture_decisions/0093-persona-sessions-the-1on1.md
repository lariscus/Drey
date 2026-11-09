# 0093 — Persona sessions: the 1:1 is a session of the persona's own harness

## Status

Accepted — the 1:1 half built as milestone 228 (req-168, 2026-11-09;
"As built" below). The memory and journal half (R4/R14: `memory.md` written
by model and owner, `reviews.md`, the closing round) stays Proposed until
req-169. Designed in the session of 2026-11-07/08 (owner rulings R1–R4 in
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
- Open: the exact 1:1 tool list, the line formats of memory and journal,
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
  named seam, `OneOnOneToolSeam`. req-167's harness MCP configuration was
  not on this base, so nothing is attached yet and the brief names no tool
  (follow-up req-217).
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
2. *"The vault read tools over the service's MCP"* — not attached yet
   (req-167's capability was not on this base); the seam is named, the
   brief names nothing (req-217).
3. *"Requested from the pool like any task"* — the class asked is the
   model table's class of the persona's own default model on its harness;
   there is no class pick over the persona's pool and no step up (req-220).
4. A persona with `worker: api` answers over the chat bridge with the 1:1
   brief as its system prompt and a JSON envelope rule (the bridge reads
   one envelope per reply).
5. The idle span is fixed at 15 minutes (`shared/session-lifecycle.ts`);
   its setting is req-219.
