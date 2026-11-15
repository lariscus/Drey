# From a concept note to stages — the concept of the design round of 2026-11-15

Status: **accepted by the owner on 2026-11-15** — the boards 7s – 7x on the canvas
*Concept apply flow* (*"Passt"*), after one correction: the concept is written in the
standard editor and the Assistant writes into it directly (live edit), no diff to
confirm. Nothing built; the build items are roadmap rows req-310 – req-313 (§7),
added to **step 5 of the finish line** as the owner's correction before the merge into
`main` (2026-11-15). The boards: [boards/README.md](boards/README.md), rows 7s – 7x.

The owner's finding (2026-11-15, paraphrased): the Crew has no start. Work should begin
in a Drey vault: a chat about a topic, the model writes the concept as a draft into the
vault (the repository's architecture documentation), the two iterate on it until the
owner says *implement*; then tickets are made — for a large change several stages,
reviewed one after another, the rest easy to drop when the direction changes. Apply
cuts only the **delta to the last implemented version**, visible as a diff.

## 0. What exists today

- **Live edit** ([ADR-0049](../../09_architecture_decisions/0049-live-edit-mode.md)): the
  Assistant edits the open note directly through `doc_apply_diff` / `doc_write`, no
  confirmation; the user's input on that document is blocked while the turn runs (an
  advisory lock and a meta-bar hint); each tool call is one Ctrl+Z step; the next turn
  re-reads the live buffer. **Missing:** the model is not told *what the owner changed*
  between turns — it only sees the new text.
- **Mermaid** renders in Live Preview (`libs/markdown-surface/src/live-preview/`).
- **Shape** (architecture concept v2 §5.8) already has the owner's delta for a ticket's
  plan: a shadow copy at the end of the model's turn, only the change shadow → current
  goes along, a chip *n new edits of yours go along*, a card *You edited the plan*.
- **Plan to accept** (v2 §5.9, `packages/tickets-engine/src/core/plan/`,
  `contracts/plan-approval.ts`): parts become child tickets with `parent` and
  `blocked-by`, *Run part 1 only*, parts move or go until released; every ticket ends at
  **You** (req-309), so released parts are reviewed one after another.
- **Projects** (req-282 ff.): `_meta/projects/<id>.md` names the project's repos and its
  vaults with `read | write`; a run reads its project's vaults through the vault MCP.
- The Grobkonzept of 2026-11-08 (*Assistant: Konzepterstellung*) sketched the same flow
  with statement ids, a delta list and *Umsetzen vorbereiten*; the statement ids stayed
  the owner's manual "Stufe 0" (roadmap). This concept takes the flow, not the ids.

## 1. The flow

1. **Write (7s).** In the Notes view the owner opens a note in the project's `write`
   vault (e.g. `docs/concepts/runner-event-stream.md`) and talks to the Assistant with
   live edit on. The Assistant writes directly; a diagram changes in front of him. While
   it writes, his input waits (*Assistant is editing*, Stop).
2. **Edit by hand (7t).** The owner changes the note himself between turns. The editor
   marks his edits; the next message carries them as a diff (chip *n edits of yours go
   along*, removable; a card *You edited the note* in the chat). The concept is the
   truth, the chat is how it is edited, by both.
3. **Apply (7u).** The meta bar reads *Last applied 14 Nov · n sections changed*;
   **Apply** opens the diff of the note against its last applied version, per section
   (M changed, A new, D removed). *Decompose* hands only those sections on.
4. **Decompose (7v).** Apply creates **one parent ticket per apply round** in the note's
   project (`concept:` the note, `concept-rev:` the version applied). The Shape persona
   cuts the delta into stages — the plan's parts, each naming the sections it
   **covers** — and the existing Plan to accept shows them: move, delete, persona,
   *Run stage 1 only* or release all.
5. **Review stage by stage (7w).** Each stage's chain ends at You. Accepting a stage
   marks its sections **applied**; the next stage starts (it was `blocked-by` the one
   before). **Drop remaining stages** cancels every released stage that has not started.
6. **Change direction (7x).** The owner drops the rest, rewrites the concept with the
   Assistant, and Apply shows only what is not applied yet — a dropped stage's sections
   fall back to *not applied*, a section removed before it was ever applied simply goes.

## 2. Sections, the applied version and the delta

- **The unit is a section** — a heading of the note (`##`, `###`). No statement ids, no
  frontmatter the owner must maintain. A section is matched across versions by its
  heading text; a renamed heading reads as removed + new (the diff view shows both).
- **The applied version** is a snapshot of the note that Apply keeps in the tickets
  store: `_meta/concepts/<slug>/applied.md` beside `_meta/projects/` (one commit per
  write, like every `_meta` record). It is not the note's git history: a vault need not
  be a Git vault, and *applied* means more than *committed* (below).
- **A section counts as applied when its stage reaches Done** — the owner accepted it at
  You. Releasing a stage applies nothing. Accepting writes that section's text, as it
  stood at the apply, into the snapshot. A dropped or cancelled stage writes nothing.
- **The delta** = the note now against the snapshot, per section: changed, new,
  removed. The Outline panel shows each section's state: *applied*, *changed*, *new*,
  *building* (a stage holds it), *at you*.

## 3. What a stage's worker gets — the whole concept, the delta marked

Not only the diff: a diff says what changes, not what it fits into — the invariants, the
neighbouring sections a sentence refers to, what already exists. The brief of a stage
gets a `## Concept` section:

- **inline:** the diff of the sections this stage covers (applied version → the version
  at the apply), with the order *implement only this*;
- **by path:** the note at `concept-rev`, read through the vault MCP (the project's read
  vaults) when the worker needs it;
- **a list of every section with its state:** applied (exists in code), this stage,
  a later stage (leave alone), not applied;
- **the rule:** everything outside this stage is context; a mismatch between the code and
  an applied section is a question to the owner, never a silent fix.

Board 7v shows this brief beside stage S2.

## 4. Live edit: the owner's delta

The one piece the Notes Assistant lacks. Per chat session and note, the Assistant keeps
a **shadow copy**: the note as it stood at the end of the model's last turn. On send, the
change shadow → current buffer goes along as a unified diff with the section names, under
the chip *n edits of yours go along* (removable: then only the new text goes, as today).
A card *You edited the note* records it in the chat note. The model's own changes are
never mirrored back. The lock of ADR-0049 stays as it is. This is the Shape mechanism of
v2 §5.8 moved into the Assistant plugin for every live-edited note, not only tickets.

## 5. How Apply reaches the Crew

The Assistant's vault toolset gains nothing; the tickets plugin registers one more MCP
tool beside the fleet tools (`plugins/tickets/main/ipc/mcp-tools.ts`):
`crew_apply_concept { path }`. It is a write, so it is asked (tool approval); it is also
the **Apply** button's action. The plugin reads the note through `ctx.vault` and hands the
text to the engine; the engine never reads a vault itself. A note outside every project's
`write` vault is refused with an `Error: …` the model can read.

## 6. Open questions for the owner

1. **Where the Apply button lives.** The boards put it in the note's meta bar when the
   note is a concept (it has an applied snapshot or sits under a project's write vault).
   Alternative: only through the Assistant (*apply this*). Recommendation: both — the
   button is the visible state *n sections changed*.
2. **What makes a note a concept.** Recommendation: any note in a project's `write`
   vault the owner applies once; from then on it has a snapshot. No folder convention,
   no frontmatter.
3. **Granularity.** Sections by heading, as drawn. A large section changed in one word
   still goes to a stage whole; the inline diff shows the word.

## 7. The build items (roadmap rows, finish line step 5)

In this order; each a milestone with a pause after it:

- **req-310 — Live edit hears the owner's edits** (§4): shadow copy, the diff on send,
  chip and card; Assistant plugin, catalog keys, manual.
- **req-311 — Concept notes: the applied snapshot, the section delta, Apply** (§2, boards
  7s, 7u): engine record `_meta/concepts/`, the section diff (pure, in `shared/markdown/`
  or the engine's `core/plan/`), the Outline's state chips, the meta bar's line and Apply,
  the diff tab.
- **req-312 — Decompose the delta into stages** (§1.4, §3, §5, board 7v): the command
  `applyConcept`, the parent with `concept` / `concept-rev`, the Shape turn on the delta,
  `covers` on a part, the brief's `## Concept`, the MCP tool.
- **req-313 — Stages: applied on accept, drop the rest** (§1.5, §1.6, boards 7w, 7x): a
  section written to the snapshot when its stage reaches Done, `dropRemaining` as a
  `PlanPartsEdit`, the parent closing when every stage is done or dropped (E10-4b's
  *parent leaves needs shaping* folds in here), the Outline's *building* / *at you*.

Specs and docs ride the rows: `specs/ticket-schema.md` (`concept`, `concept-rev`,
`covers`, `_meta/concepts/`, `dropRemaining`), `specs/frontmatter-schema.md` (nothing is
required of a concept note), `specs/classifier-spec.md` (the brief's `## Concept`, the
Decompose prompt, the owner-delta block), an ADR *The concept note starts the work*
(source in the vault, sections not ids, applied = accepted), `docs/05`, `docs/06`, the
manual.
