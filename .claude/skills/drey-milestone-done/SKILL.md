---
name: drey-milestone-done
description: Closing a Drey milestone, req, defect or fix — the Definition of Done in the same change as the code. Use when work on a roadmap item is code-complete and its changelog entry, roadmap row, specs, docs/05/06, ADR or manual are due; when the owner verifies a milestone and its marker should fall; or when asked whether the specs are consistent ("is the changelog right", "check the roadmap").
---

# Closing a Drey milestone

The binding list is `CLAUDE.md` § "Definition of done" and the table under
§ "The spec files and who they belong to" — read both now; they are the
single source of truth for *what* must change. This skill is the *how*:
the order, the shapes the files already use, and a check that proves it.

Done means: every row of the DoD list is either changed in this branch or
consciously checked and named as untouched, and `check-specs.mjs` exits 0.

## Steps

1. **Ids.** Run the check (step 7) once first; its `next free ids` line
   gives the milestone number. A req or D id comes from the roadmap row
   you worked; work outside the order got its row *before* the code
   (CLAUDE.md § "Working the roadmap", rule 2).

2. **Changelog entry** at the top of `specs/changelog.md`, in the shape
   of the entries below it:
   - Heading: `### Milestone <n> — <req-/D-ids>: <the behaviour in one line> (<origin>)`
     — origin is e.g. `owner request, outside the list, <date>` or the
     finish-line step / concept row.
   - First line: `**Not yet manually verified by the owner.**` plus one
     or two sentences on what changed for the user.
   - Bullets, each opening with a bold label: the behaviour (files in
     backticks), **Specs:** the spec files added or changed and what they
     pin, **Docs:** every doc touched — and the DoD rows that did *not*
     change, named ("`specs/decisions.md`, `frontmatter-schema.md` and
     `CLAUDE.md` unchanged"), **Left out:** while the roadmap has a
     finish line, the parts not built, one sentence each instead of a
     new row.
   - **Gate:** last bullet — date, branch and tip commit, the commands
     run and their exact counts (`npm run test:all` exit 0, or each part:
     lint, typechecks, `check-cycles`, the Angular suites, vitest), and
     whether e2e ran and why not. Copy numbers from the output; a part
     not run is written as not run.

3. **Roadmap.** Delete the row (a row that only partly shipped keeps the
   rest and says what shipped). Add follow-ups under
   "Follow-ups of shipped milestones" — unless a finish line stands; then
   only what is broken or blocks a finish-line item gets a row. Update
   the `**Status (<date>):**` line: today's date and the milestone added
   to its list.

4. **The other specs**, each checked against the change:
   `specs/decisions.md` (an alternative rejected in this work — date,
   reason, milestone, in the shape of its neighbours),
   `specs/classifier-spec.md` (any prompt, builder, parser or provider
   call), `specs/frontmatter-schema.md` (formats, folders, grammar),
   `specs/ticket-schema.md` (anything the tickets repo or fleet ledger
   stores).

5. **Architecture docs.** `docs/05_building_block_view.md` §5.0 when a
   component or boundary changed (a component row, and the
   Feature → files index). `docs/06_runtime_view.md`: a new
   `## 6.<next> <flow> (<ids>, milestone <n>)` section with a Mermaid
   diagram for a new or changed flow. An ADR under
   `docs/09_architecture_decisions/` (next number, MADR) only for a
   lasting structural decision — when unsure, ask the owner; an existing
   ADR gets a "later change" section instead of a new file. Index in
   `docs/09_architecture_decisions.md`.

6. **Manual.** `docs/manual/manual.md` whenever behaviour the user sees
   changed — English, the shipped manual. `CLAUDE.md` only when a rule
   or architecture statement changed, never for status.

7. **Check.** From the repo root, with the portable Node on PATH:

   ```bash
   node .claude/skills/drey-milestone-done/check-specs.mjs
   ```

   It checks: changelog milestone numbers unique and the newest on top,
   the top entry's verification marker, no open roadmap row whose id a
   changelog heading names, no duplicate roadmap rows, the Status line
   covering the newest milestone, every relative link in the spec files
   resolving; and it prints the next free ids. `ERROR` lines are fixed
   before the work is done. A `WARN` is judged and, if it stands, said
   to the owner (e.g. a req that shipped only in part).

8. **Pause.** Show the owner what works and stop — one milestone at a
   time (CLAUDE.md § "Definition of done", last paragraph).

## When the owner verifies

Verification only removes the `**Not yet manually verified by the owner.**`
line from that entry (and moves the milestone into the roadmap Status
line's owner-verified range). Nothing else in the entry changes.
