# Prompt revision — the ticket-pipeline prompt set (req-280)

Working record of the owner-requested revision of the step prompts
(`packages/tickets-engine/prompts/*-default.md`), the run-brief disciplines
(`prompts/disciplines/*.md`) and the crew chat prompts (`prompts/crew/*.md`).
The engine code is the ground truth: a finding the code refutes is dropped.
Paths below are relative to `packages/tickets-engine/` unless they start
with `plugins/` or `specs/`.

## 1. How the engine uses the prompts (Q1–Q8)

### Q1 Composition

- **The step prompt is the column's template, or the persona's prompt instead.**
  `src/fleet/orchestrate/prompt-source.ts` `PromptSource.promptFor`: a resolved
  persona with a non-empty `prompt.md` is the brief's base; otherwise the
  column's ref (`src/fleet/chain.ts` `columnPromptRef`) is read from the
  vault copy `tickets/_meta/prompts/<ref>.md` (version line stripped).
  `src/fleet/request-instruction.ts` `runPrompt`: `personaPrompt ?? promptText`.
  The persona prompt is **not prepended — it replaces** the step prompt.
- **Seeded personas carry a copy of the step prompt.** `src/core/default-crew.ts`
  `seededPromptText`: `## Who <X> is` … `## What done means` from
  `personas/<id>/prompt.md`, then `## The <step> step` + the step prompt body
  (planner→plan-default, builder→build-default, reviewer→review-default,
  tester→qa-default). The copy is a snapshot: a later shipped fix reaches a
  seeded persona only on re-seed. The owner's board today runs the
  `build-default` persona with an empty `prompt.md`, so the vault copy of
  `build-default.md` is the base.
- **Brief order** (`src/fleet/instruction.ts` `composeInstruction`,
  `instruction-parts.ts` `headParts`, `instruction-sections.ts`): repo
  instructions → step/persona prompt → skills → `## Plan` (quoted) →
  who-and-where (ticket id, persona line, checkout line, phase, ticket-file
  line, description) → memory → earlier handover (capped at 2 000 chars,
  `HANDOVER_CAP`) → diff stat → gate failure → gate commands lead-in →
  disciplines → asking.
- **Disciplines per run kind** (`instruction.ts` `closingParts`,
  `scout-instruction.ts` `composeScoutInstruction`): non-interactive ship
  run (plan, build, review, qa, commit) → `completion` + `handover`;
  interactive dialog → `interactive`; scout → `scout` (or `interactive`).
  `asking` closes every brief. No other fragment exists; the five are
  loaded by name (`src/fleet/discipline-texts.ts` `DISCIPLINE_FILES`).
- **Placeholders:** `{{question}}` → `QUESTION:`, `{{blocked}}` → `BLOCKED:`
  (`discipline-texts.ts` `readDiscipline`, `src/fleet/protocol.ts`
  `QUESTION_MARKER`/`BLOCKED_MARKER`). Only the discipline loader
  substitutes them; step and crew prompts spell the markers literally.
- **Code-side prompt text** also rides every brief: the checkout line (the
  review variant says "read-only … you change no file — the ticket file
  included … end it with `BLOCKED: <why>` to send the step back"), the
  ticket-file line ("the one file besides the worktree you may edit"), the
  scout report shape (`scoutReportShape`), the gate lead-in ("keep them
  green, and commit your work on the branch before you end").

### Q2 Ticket location and commits

- **Agents run only on the dricket store.** `src/fleet/orchestrate/request-validation.ts`
  `validateRequest` refuses a request without `dk` (req-176);
  `run-bookkeeper.ts` notes "the legacy file writer is gone".
- **The agent edits a working copy outside the worktree.**
  `src/fleet/worktree-home.ts` `ticketCopyPathFor` →
  `<vault>/_workcopy/<id>.ticket.md`; the code worktree is
  `<vault>/_worktrees/<id>`. `ticket-copy.ts` `TicketCopy.sync` merges the
  copy back inside the claim with `src/core/ticket-chapters.ts`
  `mergeWorkerChapters`: a changed or new `## ` chapter replaces the
  store's, `## Log` takes only new lines, frontmatter and `## Verlauf` are
  ignored, a removed chapter stays.
- **Nobody commits a ticket file into git, and no step may.** The ticket is
  never on the code branch. "Commit the ticket-file change on the branch"
  (plan-interactive, review) can never apply. Review runs cannot even write
  the copy (read-only session, `request-assemble.ts` `permissionMode: 'read-only'`).

### Q3 Plan parsing

- `src/core/ticket-files.ts` `acceptanceCommands`: heading
  `/^###\s+Acceptance criteria\s*$/` anywhere outside a fence; a criterion
  counts only as `/^-\s+\[.]\s+`([^`]+)`/` at column 0. Prose lines are
  dropped silently. Zero commands → `src/fleet/request-refusals.ts`
  `acceptanceRefusal` refuses the dispatch, except scout, dialogs and the
  first auto column, where `gate-runner.ts` `structural()` fails red unless
  the run itself wrote at least one command line.
- `src/core/plan-parts.ts` `parsePlanParts`: `### Parts`, part lines
  `- [ ] <title>`, detail lines indented ≥ 2 spaces with keys `persona`,
  `size` (`S|M|L`), `reason`, `needs`, `chain` (`;`-separated). Fewer than
  two parts removes the chapter. `size` maps to the pool class
  (`protocol-pool.ts` `PART_SIZE_CLASS`: S→C, M→B, L→A).
- Goal, Decisions, Constraints, Out of scope, file maps: **not parsed**
  (the review tab reads `### Goal` for its header, `plugins/tickets/renderer/review/model.ts`
  `goalOfText`). There is no "cannot leave plan-review" guard.

### Q4 Status log

- **The runner writes every status verb itself, as store comments**
  (`src/core/status-comment.ts` `renderStatusComment`):
  `claim-release.ts` (`failed:`, `done: handed over on <phase>`),
  `run-bookkeeper.ts` (`done:`, `blocked: [run-<id>]`, `paused:`,
  `blocked:`/`resolved:` for a full ledger), `wait-claim.ts`
  (`needs-decision: [run-<id>-waits]` on a `QUESTION:`, `resolved:` with the
  answer). `working:` is never persisted.
- **An agent's `.status.log` write reaches nothing.** On a store the
  Needs-you list reads comments (`src/store/store-board.ts`,
  `board-service.ts` `statusOf`); the file is read only on a files board,
  where no agent runs. Written relative to the worker's folder, the
  prompt's `tickets/<phase>/<id>.status.log` lands in the code worktree as
  a stray file. So T3 is already true in the engine — the prompts are what
  is stale.

### Q5 Review verdict

- **No parser reads PASS / PASS WITH NOTES / FAIL** (nothing in `src/` or
  `plugins/tickets`).
- A finished review turn without `BLOCKED:` goes to the gate
  (`run-completion.ts` `gate`). `gate-runner.ts` `reviewMoved` fails it red
  if the branch moved past the reviewed commit (req-183) — a reviewer's fix
  commit fails its own review. Green moves the ticket on. **A FAIL written
  only in prose is fail-open.**
- `BLOCKED:` (`harness/event-text.ts` `blockedOf`) → `run-completion.ts`
  `blocked` → `run-bookkeeper.ts` `parkBlocked`: no gate, no move, a keyed
  `blocked:` comment, release to the `blocked` stage if the pipeline has
  one, else the ticket stays put for the owner. It never sends the ticket
  back to build; send-back is the owner's action (`board-service.ts`
  `sendBack`, with optional line comments as `### Review feedback`).
- The review session is read-only (Claude Code `--permission-mode plan`;
  other harnesses fall back to the read-only checkout on disk), so it can
  neither fix code nor write the ticket. The `proof:` line it is asked to
  correct is read by `src/core/proof-mode.ts` `parseProofDeclaration`
  (last line in `## Handover` wins; frontmatter pin beats it).

### Q6 QA

- **The judge the QA prompt describes is never called.**
  `src/services/verify-service.ts` is a machine step with no LLM; it passes
  `judge: null` (`src/contracts/verify.ts` `VerifyJudge` has no
  implementation). It writes `## Verification` itself
  (`src/core/verification.ts` `renderVerificationSection`): a shot present
  counts as passed, a missing shot fails, `proof: tests` passes every
  criterion "checked by the machine gate".
- The criteria are the backticked **commands** from `acceptanceCommands`;
  shots are paired by index (`src/server/verify-harness.ts`
  `planVerifyShots`, at most six) and matched back by criterion string.
- `qa-default.md` reaches a model only as Tessa's seeded persona prompt
  (`CREW_STEPS.tester`) or a column template — i.e. as an ordinary worker
  brief with the completion and handover disciplines, where no
  `## Verification` with shots exists.

### Q7 Aggregator

- Input (`src/services/improvements-service.ts` `promptText`, `chat-llm.ts`):
  persona id, the last 20 friction lines from the persona journal
  (`tickets/_meta/personas/<id>/reviews.md`), the settled-run count. **It does
  not receive the current `prompt.md`, `memory.md` or models.**
- Output validated by `src/core/improvements.ts` `validateDraft` (target
  `prompt.md|models.default|memory`, title, content ≤ 8 KiB, evidence ≤ 10,
  optional lesson).
- Applying (`board-service.ts` `decideImprovement`): `prompt.md` is
  **replaced whole** by `content`; `models.default` patched; `memory` gets
  one lesson line. A lesson is appended whether the draft is accepted or
  dismissed.
- **Bug:** the aggregator runs through `createChatBridge`, whose
  `parseEnvelope` (`src/core/chat-intents.ts`) wants one JSON object; the
  aggregator's array either fails to parse ("could not be read") or yields
  `say: ''`, so `extractJsonArray(reply.say)` finds no draft. The specs use
  a fake bridge and miss it.
- The closing round (`src/fleet/closing-round-prompt.ts`) has the same
  shape for its `proposal`: "content is the whole new prompt text".

### Q8 Branch note

- **Nobody writes it.** No code writes a branch tip into the ticket; build
  and review prompts do not ask for one; the runner's one Verlauf line
  (`src/core/verlauf.ts` `renderVerlaufLine`) carries phase, persona, model,
  tokens, cost, duration, outcome — no SHA. The commit step's "the tip
  matches the Log's newest branch note" can never be checked as written.

### Also found

- FRICTION is journaled only on the gate path (`run-completion.ts` calls
  `closing.afterGate` there only): a `BLOCKED:`, scout or no-result run's
  FRICTION line is lost.
- Version marker leak: owner-started board runs pass the vault prompt raw
  (`board-service.ts` around `PLAN_INTERACTIVE_PROMPT` reads and
  `promptText: prompt`), so `<!-- drey-prompt-version: N -->` reaches the model.
- Concurrent roadmap work touches the same seam: req-258 (persona settings,
  "a persona's prompt displaces the step prompt — the intended behaviour"),
  req-266 (the chain as a persona list), req-267 (leaving actions).

## 2. Findings (F1–F25)

| # | Status | Evidence |
|---|---|---|
| F1 | confirmed | Ticket copy outside the worktree, merged back by the runner (Q2); review session read-only; plan-interactive and review still say "commit on the branch"; build's "only writable places" omits the ticket copy the code line names. |
| F2 | confirmed | Only `### Acceptance criteria` (backticked, column 0) and `### Parts` are parsed (Q3); shape's AC rule is missing, so a prose AC is dropped and the dispatch refused or the structural gate fails red. |
| F3 | confirmed | Machine channels are `QUESTION:`, `BLOCKED:`, `FRICTION:` in the final message plus the end of the turn (`event-text.ts`); status-log lines, Handover `State:`, Log lines are not read (Q4). Scout D-lines and shape `question{}` are real but separate channels. |
| F4 | confirmed | No verdict parser; a prose FAIL with a green gate moves the ticket on (Q5). |
| F5 | changed | Worse than "no contract": the judge is never called (`judge: null`); `qa-default.md` only runs as a worker brief that names a Verification section and shots it does not have (Q6). |
| F6 | confirmed | No current prompt in the input; whole-file replacement; plus the envelope parse bug that drops every draft (Q7). Partly mitigated: the closing round asks every persona run with a signal for friction. |
| F7 | confirmed | Measured: "How to work" 1 080 B × 5, FRICTION 341 B × 4, status log 782 B × 4, Handover in plan, build and the discipline (build gets it twice), the scout report shape in the prompt and in code — ≈ 9–10 KB of the 45 KB set. |
| F8 | confirmed | scout and commit carry "Read a file before you change it … no extra features"; qa has no reading rules; plan-interactive a short version. |
| F9 | changed | The runner already owns every persisted verb and its timestamp (Q4); agent writes reach nothing and leave a stray file in the worktree. Fix = drop the status-log instructions; no engine change. |
| F10 | confirmed | Section duties are scattered over step prompts, disciplines and the code's ticket-file line; the runner merges any chapter the agent writes (`mergeWorkerChapters`). |
| F11 | changed | One parser (`src/core/chain-delta.ts` `parseChainEntry`) accepts all five verbs for mission and flow alike; mission's prompt just documents three. |
| F12 | confirmed | No precedence sentence; the repo's instructions come first in the brief (`headParts`). |
| F13 | confirmed | Only crew prompts and qa name a language. |
| F14 | confirmed | build's Orient has no criterion and no baseline run. |
| F15 | confirmed | No stop rule for fix loops. |
| F16 | changed | The no-AC case is engine-defined: refused, except in the first auto column (the owner's Building), where the structural gate demands the run write `- [ ] \`cmd\`` lines — build must know that. Out-of-scope defect case: confirmed missing. |
| F17 | confirmed | Closing duties in persona "What done means", the step prompt's "Before you end", Handover (prompt and discipline), `proof:`, Changes, gate lead-in, completion discipline. |
| F18 | confirmed | "What changed for you" addresses the owner; elsewhere "you" is the agent. |
| F19 | confirmed | 15-line cap vs up to 50 review comments; the brief also caps the quoted handover at 2 000 chars. Conditional injection needs an engine change. |
| F20 | changed | The reviewer cannot fix anything: read-only session and checkout, and a fix commit fails `reviewMoved`. Ralf's persona already says "does not fix". |
| F21 | confirmed | "Stop after the first failed attempt" vs "after honest attempts"; "newest first" fits changelogs only; and the branch note it checks does not exist (Q8). |
| F22 | changed | D-lines are parsed (`src/core/scout.ts`); the status-log channel reaches nothing; `QUESTION:` (asking, appended by code) works and blocks. Two real channels with different jobs, not three. |
| F23 | confirmed | Validator fields (`chat-intents.ts` `validateChatCommand`): createTicket `title, phase, priority, description?`; transition `id, from, to`; setPriority `id, priority`; promote `id` — none documented. |
| F24 | confirmed | A non-empty `read` wins and discards that reply's plan/question/say (`chat-llm.ts`, up to 3 rounds); `size S|M|L` (part) vs `poolClass A|B|C` (session) are two scales; no AC-as-commands rule. |
| F25 | confirmed | Only top-level step prompts carry the marker; crew and discipline loaders do not strip it (it would reach the model and break `crew-prompts.spec.ts` / `discipline-texts.spec.ts`). |

## 3. Guardrails (must survive in meaning)

1. No force-push.
2. No rewriting published history.
3. No merge on a red gate.
4. No touching the owner's checkout (no git in it: no stash, checkout, reset).
5. No host API calls (protected branches: the owner merges).
6. Never weaken, edit or delete an acceptance criterion to pass.
7. Never invent ticket ids or priorities.
8. Scout and QA are read-only (review too, by the engine).
9. Every crew command is a proposal the owner confirms.

## 4. Owner decisions

Asked on 2026-11-12 in one message; the owner answered "Take all recs".

Settled by the code, no question asked:

- **D1** plan schema: shape's chapters plus Decisions and Out of scope, no
  file map; acceptance criteria are backticked commands at line start (the
  only form `acceptanceCommands` reads).
- **D2** ticket files: the runner merges the working copy back; no step
  commits a ticket file (already the engine's behaviour, Q2).
- **D3** superseded: the runner already writes every status line (Q4);
  agents write none — the interim "agents append needs-decision/blocked
  lines" would only leave a stray file in the worktree.
- **D6** persona prompts keep invariant character only.

Decided by the owner (all as recommended):

- **A — shared fragments (T2), engine change:** new discipline files the
  engine appends by run kind (working for every run; writing or read-only;
  ticket file; handover for writing runs; language; precedence; signals
  with the closing); `{{plan-format}}` and `{{chain-grammar}}` placeholders
  resolved from one fragment file each, in step prompts at composition and
  in crew prompts at load.
- **B — review FAIL (T4):** FAIL ends the final message with
  `BLOCKED: FAIL — …`; the reviewer fixes nothing; review runs no longer
  get the handover discipline (engine). Automatic send-back to build stays
  a proposal (collides with req-266).
- **C — aggregator (T5), engine change:** fix the envelope parse bug; give
  it the current `prompt.md`; prompt drafts become exact old→new edits
  instead of whole-file replacements; the closing round's proposals the
  same.
- **D — QA (T5):** `qa-default` rewritten for what actually runs — a
  read-only tester worker with one verdict line per criterion in its final
  message, `BLOCKED:` on any failure.
- **E — small engine fixes:** loaders strip `drey-prompt-version` from crew
  prompts and disciplines (so they can carry it); owner-started board runs
  stop leaking the marker; FRICTION is journaled from blocked and scout
  runs too.
- **F — language (D5 refined):** the sections the owner reads are written
  in the language of the ticket's description; formats, labels, headings
  and markers stay as given.

## 5. Sizes

| Composed brief | Before (bytes) | After (bytes) | Change |
|---|---|---|---|
| plan | 7 641 | 9 350 | +22 % |
| plan-interactive | 6 070 | 9 128 | +50 % |
| build | 10 056 | 11 619 | +16 % |
| review | 7 833 | 6 812 | −13 % |
| qa (after: as Tessa, read-only) | 6 485 | 5 875 | −9 % |
| commit | 7 592 | 8 922 | +18 % |
| scout | 8 394 | 6 726 | −20 % |
| crew mission | 4 145 | 4 866 | +17 % |
| crew shape | 2 651 | 3 980 | +50 % |
| crew flow | 1 640 | 1 764 | +8 % |
| crew aggregator | 1 203 | 1 606 | +34 % |
| **the shipped set** (all files) | 45 016 | 33 148 | −26 % |

Rendered with `scripts/render-composed-prompts.ts` (the engine's own
`composeInstruction` / `composeScoutInstruction` / `loadCrewPrompts`, the
step prompt as the column template, no persona except Tessa for qa,
placeholder ticket facts). The set shrank by a quarter; a writing step's
brief grew because it now carries rules it never had (the signals table,
precedence, language, the ticket file's duties) and the whole plan format
instead of a field list. The plan and shape briefs carry the plan format in
full — the price of one schema read by every planner.

## 6. Fixes (step 4)

| # | Fix | Move |
|---|---|---|
| F1 | One rule for the ticket file (`ticket-file.md`: working copy, merged back by the runner, never committed); writable places in `writing.md`; read-only runs get `read-only.md`; "commit on the branch" and the scout's "ONE writable place" contradictions gone | T2, T1 |
| F2 | One plan format (`fragments/plan-format.md`, D1) pulled by shape, plan, plan-interactive and build; acceptance criteria are `` - [ ] `cmd` `` lines | T2, T1 |
| F3 | One signals table (`signals.md`) with the three markers; status lines, Handover states and Log lines named as not read | T2, T3 |
| F4 | A review FAIL ends `BLOCKED: FAIL — …`; the verdict is the final message's first line | T4 |
| F5 | `qa-default` describes the run that happens: read-only, one verdict line per criterion, `BLOCKED:` on a failure | T5 |
| F6 | Aggregator sees prompt.md, proposes edits; the parse bug fixed; closing-round proposals as edits; FRICTION journaled from blocked and scout runs | T5 |
| F7 | Every shared block exists once (disciplines); the scout report shape only in code | T2 |
| F8 | `working.md` (every run) carries reading and verification only; the change rules are `writing.md`'s; read-only runs never get them | T2 |
| F9 | Status-log instructions deleted — the runner owns every persisted verb | T3 |
| F10 | `ticket-file.md`: write your step's sections, the Handover when asked, one Log line; Description is the owner's, Verlauf and frontmatter the runner's. The full ownership table is §7 below and `docs/design/ticket-run-flow.md` | T2 |
| F11 | One chain grammar (`fragments/chain-grammar.md`) for mission and flow, `move` and `assign` included | T2 |
| F12 | `precedence.md`: the brief wins over the repo's instructions, above all on git | T2 |
| F13 | `language.md`: what the owner reads is in the language of the ticket's description (decision F) | T2 |
| F14 | build: orientation done when every touching point is named; a baseline run of the acceptance commands before the first change | T6 |
| F15 | build: the same failure after three different fixes ends blocked | T6 |
| F16 | build: no plan / no criteria → write the plan in the plan format first; an out-of-scope defect goes to Open, unfixed (`writing.md`) | T6, T2 |
| F17 | build: one ordered "Done when" checklist; the persona keeps character only (D6) | T6, T1 |
| F18 | build: "you" in the Changes label is named as the owner | T6 |
| F19 | build: one Open line per review comment, beyond the 15-line limit (conditional injection: proposal) | T6 |
| F20 | review: fixes nothing; findings in the final message | T4 |
| F21 | commit: one attempt per conflict, one retry of a failed push; additive conflicts keep both sides in the file's own order; gate re-run after any resolution; the tip is checked from the work branch (no branch note exists) | T1 |
| F22 | scout: decision lines are the one channel for owner decisions; `QUESTION:` only when the exploration cannot go on | T1 |
| F23 | mission: every command with its fields and an example | T1 |
| F24 | shape: a `read` reply is only a request; size S/M/L explained with its class in the plan format; criteria as commands | T1, T2 |
| F25 | Version markers on disciplines, fragments and crew prompts; one reader strips them; board-started runs no longer leak them | T2 |

## 7. Section ownership (F10, the record)

| Section | Written by | Read by |
|---|---|---|
| `## Description` | the owner (Mission Control `createTicket`) | every brief (quoted) |
| `## Plan` | Paul in the shape chat, the plan step; the build only when the ticket has none | every brief (quoted); the gate (`### Acceptance criteria`), the part release (`### Parts`) |
| `## Handover` | every writing step outside a dialog (replaced) | the next brief (quoted, ≤ 2 000 chars); the verify step (`proof:`) |
| `### Review feedback` | the owner's Send back (`core/review-feedback.ts`) | the next build |
| `## Changes` | the build | the owner's Ready page |
| `## Report` | the scout | the owner's Needs-you card (decision lines) |
| `## Verification` | the verify step (machine) | the owner |
| `## Result` | the commit step | the owner |
| `## Log` | one line per writing step, the scout | the owner |
| `## Verlauf`, frontmatter | the runner | the board |

## 8. Verification (step 5)

- **Checklist, every composed brief** (`scripts/render-composed-prompts.ts`
  plus a check script): every guardrail of §3 present where it applies
  (G1/G2/G6 in plan, plan-interactive, build and commit via `writing.md`;
  G3–G5 in commit; G6 also as a review check; G7/G9 in mission, G9 in
  flow; G8 in scout via its code lines, in review and qa via
  `read-only.md`); no sentence of 40+ characters twice in one brief; no
  `{{`, version marker, `status.log` or "branch note" left; exactly one
  "Done when" in every step brief. Markers and headings match the parsers
  (`BLOCKED:`, `QUESTION:`, `FRICTION:`, `### Acceptance criteria`,
  `### Parts`, the scout report shape, the `## Changes` labels, the crew
  JSON fields — the chat-llm specs assert them).
- **Read through** the composed review and build briefs end to end; fixed
  what contradicted: the commit step's merge worktree was not a "writable
  place", "fix what the gate surfaces" sat in the shared rules though only
  the build changes code, the scout's end repeated the signals' phrase.
- **Gate:** see the changelog entry.

## 9. Engine proposals not built

1. A review FAIL sends the ticket back to build by itself (decision B,
   option 2) — collides with req-266's persona chain.
2. A `readonly` flag beyond the tester role — req-258's `readonly` persona
   key — so a `qa-default` column template without a tester persona runs
   read-only (today it composes as a writing run).
3. Quote `### Review feedback` beside the handover instead of inside the
   2 000-character handover cap (50 comments × 1 000 characters can be cut),
   and add the review-feedback paragraph to the build brief only on a
   rework (`FEEDBACK_HEADING` present).
4. A plan phase re-run is gated by its own acceptance commands, which fail
   before the build — the plan step should always get the structural gate.
5. Skip the ticket-copy merge for read-only review runs (a harness without
   plan mode could still edit the copy).
6. `event-writer.ts`'s doc comment says status lines "ride along with the
   next regular commit" — nothing commits them, and a legacy `.status.log`
   does not move with its card.
7. A lint rule or spec that a step prompt stays role-only (no shared block
   sneaks back), beyond `default-prompts.spec.ts`'s "no How to work".
