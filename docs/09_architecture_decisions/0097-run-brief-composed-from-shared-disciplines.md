# ADR-0097 — The run brief composed from shared disciplines; persona prompt changes as edits

## Status

Accepted (owner decisions A–F of 2026-11-12, "take all recommendations";
req-280). Amends ADR-0077 (what the orchestrator's brief ends with) and the
improvement loop of E6/R14 (req-169). The verification record is
[docs/prompt-revision.md](../prompt-revision.md).

## Context

A review of the ticket pipeline's prompts found that most defects were about
how the prompts fit together, not about one file:

- Every step prompt carried its own copy of the working style, the FRICTION
  line, the status log and the handover — about a quarter of the 45 KB set,
  each copy slightly different.
- The copies contradicted the engine: agents were told to write status-log
  lines (the runner writes every persisted verb itself; an agent's line
  reaches nothing), to commit the ticket file "on the branch" (the ticket is a
  working copy the runner merges back), and the reviewer to fix and commit (its
  session and checkout are read-only, and a fix commit fails its own gate).
- Three plan schemas existed, and only one shape of acceptance criterion
  (backticked commands at line start) is what the gate runs.
- The aggregator's drafts never reached the service (an array through an
  object-only envelope reader), and an accepted prompt draft replaced the
  whole `prompt.md` although the aggregator never saw it.

## Decision

1. **A step prompt carries its role only**: inputs, outputs, role-specific
   guardrails and one "Done when". Everything several steps share is a
   discipline file in `packages/tickets-engine/prompts/disciplines/`, one
   meaning in one file.
2. **The composer picks the disciplines by run kind** (`fleet/instruction.ts`
   `ruleParts` / `closingParts`, `scout-instruction.ts`): `working` for every
   run; `read-only` for a review or a tester's run (`isReadOnlyRun`), else
   `writing`, `ticket-file` and — outside a dialog — `handover`; `language`
   and `precedence` for every run; the closing (repeated on a resume) is the
   gate commands, `completion` or `interactive`, and `signals` — the one table
   of the markers the runner reads (`BLOCKED:`, `QUESTION:`, `FRICTION:`).
   The shared rules sit in the stable part of the brief, so a resume does not
   repeat them.
3. **Fragments by placeholder**: the plan format and the chain grammar live
   once in `prompts/fragments/`, pulled in by `{{plan-format}}` /
   `{{chain-grammar}}` — expanded at composition for step prompts (whatever
   their source: column template, vault copy or persona prompt), for the
   persona prompt of a 1:1 or a free session, and at load for the crew chat
   prompts. Vault copies keep the placeholder, so a fragment fix reaches every
   board at once.
4. **One reader for prompt files** (`core/prompt-file.ts`): CRLF folded, the
   `drey-prompt-version` marker stripped, one trailing newline dropped — so
   disciplines, fragments and crew prompts carry versions too, and the marker
   never reaches a model.
5. **Persona prompt changes are edits**: the aggregator (which now receives
   the current `prompt.md`) and the closing round propose `prompt.md` changes
   as exact `{old, new}` replacements (`core/prompt-edits.ts`; each `old` must
   match exactly once). The engine applies them when the proposal is written
   and stores the resulting text, so the owner's diff and the accept path read
   a whole text as before. Guardrails live in the disciplines and the step
   prompts, which the improvement loop cannot change.

## Consequences

- One edit changes a shared rule everywhere; the shipped set shrank from
  45.0 KB to 33.1 KB. A composed brief of a writing step grows by the shared
  rules it had not carried before (signals, precedence, language, the full
  plan format) — plan +22 %, build +16 %; read-only briefs shrink (review
  −13 %, scout −20 %).
- Every discipline edit changes every brief's bytes (digest, prompt cache) —
  as before.
- A `qa-default` column template run without a tester persona composes as a
  writing run; the read-only rule then comes only from the prompt itself
  (req-258's `readonly` persona key is the place to make it general).
- Seeded persona prompts and vault prompt copies are snapshots: the owner's
  board picks up the new step texts through Settings → Tickets → Prompts ›
  Reset to the shipped version (the drift note says so) and a re-seed of the
  crew.
- Rejected: a Markdown include syntax inside vault copies resolved at seed
  time (a fragment fix would never reach a seeded copy); keeping shared rules
  in the step prompts with a lint for drift (duplicates stay, and the
  contradictions with the engine were in the copies).

## Later change — req-258 (milestone 244): read-only by the persona's record

`isReadOnlyRun` no longer reads the `tester` role: a run's brief carries the
read-only rules for a review (its checkout) or when the resolved persona is
**instructed read-only** — `readonly:` on `persona.md`, else the role's
default (`reviewer`, `tester`). The owner's ruling (2026-11-12): read-only
is an instruction in the brief, not a technical lock — a lock needs a harness
change (`specs/decisions.md`). The consequence above ("a `qa-default` column
run without a tester persona composes as a writing run") is answered: any
persona can be set read-only. Two mode wrappers join the composition: a
dialog run appends the column's interactive prompt after the persona's
prompt, and a persona whose `gate:` is `structural` gets no gate commands
in its brief.
