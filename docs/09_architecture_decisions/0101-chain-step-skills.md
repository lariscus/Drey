# ADR-0101: Chain step skills — activation, instruction and enforcement per chain position

- Status: Accepted — the design stands (owner, 2026-11-15); built as its own
  milestone after the merge into `main`. The predecessor engine service (the
  E4 machine verify step) goes with req-307's teardown on the same branch —
  broken since the dricket cut-over — while the proof format, the display
  side and the video infrastructure stay.
- Deciders: the owner
- Amends [ADR-0088](0088-tickets-engine-package-cut.md) E4's machine-step
  framing (this ADR is the successor design)
- Builds on [ADR-0098](0098-the-persona-board.md) (the chain is the
  per-ticket configuration of the crew),
  [ADR-0099](0099-worker-trust-boundary-per-harness.md) (the worker trust
  boundary — the proof pickup stays engine-side),
  [ADR-0090](0090-tickets-on-dricket.md) /
  [ADR-0100](0100-drey-on-dricket-only.md) (the one dricket store)

## Context

E4/E11 built the proof system: a machine step drove the ticket worktree's
built app through the acceptance criteria (Playwright, video recording), the
`## Verification` section, screenshots in `tickets/attachments/`, videos in
`tickets/videos/` with a per-video cap. The dricket cut-over broke its write
path (virtual `card.path`, a dead `verify`-phase auto-scan, the phase-board
move); the req-307 follow-up removes the engine service. What REMAINS and
works: the whole display side (the desk ticket document's proof block with a
player, the Review tab's proof band, Mission Control's proof card with
chapter seeking, the "Walkthrough videos" settings, the gateway video route)
and `VideoService` (folder, cap, settings).

The owner's requirements for the successor:

1. **Per-ticket activation** — a skill on the persona alone would be global;
   the owner wants to switch it per ticket.
2. **Per-project variance** — a UI project wants the verify step, a CLI
   project does not.
3. **Self-maintaining** — the step should be planned in automatically when
   the project warrants it ("Ben fügt es in den Gesamtplan ein").
4. **Universal** — the mechanism must carry any future step kind, not just
   verify.
5. **Guaranteed execution** — a skill is prose; the owner asked whether
   execution can be enforced. It can: Drey's existing machine gate.

## Decision

Five layers, each concern in exactly one place. The chain is THE per-ticket
configuration of the crew: the persona says WHO, the mode says WHAT, the
skill says HOW, the gate verifies WHETHER, the project says WHEREBY.

### 1. The chain grammar opens its mode slot to skill ids

Today `CHAIN_MODES = ['shape']` (a closed list) gates the `:<mode>` slot of
an entry. It becomes:

- **Reserved behavioral modes**: `shape` (and nothing else today — held, no
  run, the owner works; the holder pass keeps excluding it from dispatch).
  A skill folder named `shape` is refused.
- **Everything else** in the mode slot reads as a **skill id** — the skill
  folder name in `_meta/skills/`, the same word `persona.md`'s `skills:`
  list uses. Example: `paul:shape; ben; ralf; tessa:verify; you`.

Write guard (strict writer, `validateChain`): a mode that is neither
reserved nor an existing skill refuses the chain write. Read/deletion case:
the chain still PARSES (an id is an id); the card carries the warning
"position n names skill 'x' that no folder holds" and the run proceeds
without it — the same degradation a persona's listed-but-missing skill has
today ("the listing says so, a run logs it and goes on").

The grammar is unchanged structurally: the entry regex already accepts
`[a-z][a-z0-9-]*` — the same charset as skill folder names.

### 2. The step's skill rides the run's brief, additively

The cursor entry's mode resolves the skill; its body rides in the EXISTING
`## Skills` block (the D-46 loader), after the persona's own selection,
deduplicated. Stable within the run (the cursor is fixed). No second load
path, no `verify`-specific branch in the brief composition.

### 3. Skills declare their completion check

`SKILL.md` frontmatter (the Agent Skills format's open `metadata` map):

```yaml
metadata:
  drey.gate: proof        # commands | structural | none | proof; absent = commands
```

The runner applies the declared gate shape to runs whose chain step names
the skill. The gate vocabulary stays small and engine-owned; GitHub-sourced
skills (req-289) can carry the declaration.

### 4. The proof gate — the fourth gate kind (the enforcement)

Deterministic, engine-side, at run end regardless of what the worker claims
(the same standing as today's `commands` gate re-running the acceptance
commands). A run whose step skill declares `drey.gate: proof` ends green
only if:

1. `## Verification` exists in the working copy, well-formed per
   `specs/ticket-schema.md`, with **one checkbox per acceptance criterion**;
2. every file the section references exists in the worktree's `proofs/`
   folder, non-empty;
3. freshness: mtime ≥ run start; the video's name carries the record
   script's stamp (`verify-<stamp>-<ticket>.webm`) — proving THIS script in
   THIS run produced the recording, not a pushed-over file.

Red is the ordinary red: no cursor advance, back-off, the breaker counts,
the failure line names exactly what is missing. Green releases.

### 5. The bookkeeper picks the proofs up (engine-side; ADR-0099 holds)

On green release: `proofs/verify-*.png` → `tickets/attachments/`,
`*.webm` → `tickets/videos/`, with `VideoService.enforceCap` applied at
pickup (E11-1c unchanged: the only deletion the engine ever does, of the
recording it is about to reference). Workers write the worktree only — the
vault write stays the engine's.

### 6. The verify skill — the first consumer

`_meta/skills/verify/`, seeded once (crew-seeder pattern, idempotent by
marker):

- `SKILL.md` — the protocol: read the ticket's `proof:` mode
  (`core/proof-mode.ts`: the pin, else the builder's `## Handover`
  `proof: ui|tests — <reason>` line, else `ui`); `ui` → build/launch per
  `repos.md` `launch:`, run `record.mjs`, walk the acceptance criteria,
  write `## Verification` per the schema, drop the artifacts in `proofs/`;
  `tests` → the criteria stand on the machine gate, the section records it.
- `record.mjs` — the deterministic recording core, extracted from the
  removed `server/verify-harness.ts` (reference in history at commit
  `5c7c75f2`): exe discovery under `release/win-unpacked/`,
  `_electron.launch({ recordVideo })` with the no-video retry, ≤ 6 shots
  (`verify-<stamp>-<n>.png`), the rename to `verify-<stamp>-<ticket>.webm`,
  chapter offsets per shot. The lazy-Playwright import and the
  degrade-with-clear-error pattern carry over.

### 7. Stage 2 (separate, after the core proves itself)

- **Project flow default**: `flow:` on the project record
  (`_meta/projects/<id>.md`) — new tickets of that project get it at
  creation (capture already carries `project:`, req-285). NOTE: this
  extends the documented boundary "no pipeline, crew, persona or quota
  keys" in `specs/ticket-schema.md` — an explicit owner decision at build
  time.
- **The shaper's skill** on Paul: propose the verify step per ticket when
  the project warrants it. The seams exist: `propose-flow: true` (E10-5b)
  already makes `### Chain` a chapter every plan carries; `## Project`
  already rides the brief; Ben's `## Handover` proof declaration already
  signals per ticket whether it is UI. The shaper is the chain's write
  seam — the standard flow's plan/chain owner is Paul (`paul:shape`); Ben's
  contribution is the existing proof declaration.

## Consequences

- Verify stops being an engine concept: no `CHAIN_MODES` entry, no dispatch
  branch — a shipped skill like any other; the chain grammar learns one
  generic thing (skill-reference modes) that any future step kind reuses.
- A verify run costs tokens and a pool slot (accepted: the persona rides
  those tickets anyway; the deterministic part stays deterministic — the
  script records, the LLM only orchestrates).
- The gate guarantees FORM (execution happened, artifacts fresh, script
  stamp) — not CONTENT (the video shows the criterion met). The content
  check is the Judge seam (E4's `VerifyJudge` stub) as a future stage
  inside the proof gate.
- The chain grammar is the most-wired core of the system: schedule AFTER
  the desktop-integration merge and coordinate with req-300 (the folder
  sort, which wants to be the last code change before the merge).
- The change is additive (new mode values); parser, guards, loader and
  brief block are in place.

## Open decisions to close when building

1. Missing-skill behavior: warn + run without (recommended — the existing
   precedent) vs. hold at You like an unknown persona.
2. Seeding: seeded like the crew (recommended) vs. purely via GitHub
   source/upload by the owner.
3. Carrier default: `tessa` in the flow of UI projects (recommended) vs.
   unpinned, purely configured.
4. Project-record `flow:` boundary extension (stage 2): yes/no.
5. One skill per step (one mode slot) — more only via the options syntax
   later, and only when a case exists (options stay behavioral: `notify`,
   `on-red`).

## Implementation sketch (for the milestone)

Spike first: extract `record.mjs`, run it against a real Drey build (gates
everything else — M116's caveat, "not run against a real
Playwright/Electron session", applies to the recording core). Then:

| Step | Content | Estimate |
|---|---|---|
| 1 | Grammar opening: reserved set ∪ skill ids, write guard, read warning, display marks (renderer + mission-ui DTOs) | ~1 day, 2–4 commits |
| 2 | Step-skill in the brief: cursor mode → skill lookup → additive `## Skills`, dedupe, missing warning | ½ day, 1–2 commits |
| 3 | Gate declaration (`drey.gate` in SKILL.md metadata) + the proof gate (4th kind) | ~1 day, 1–2 commits |
| 4 | Bookkeeper proofs pickup + `enforceCap` at pickup | ½–1 day |
| 5 | The skill: SKILL.md + `record.mjs` + seeding + shipping spec | ~1 day |
| 6 | Stage 2 (project `flow:`, shaper skill) | +1 day |

Code anchors for the implementing session: `core/chain-list.ts` (the entry
regex, the mode gate), `contracts/chain.ts` (`CHAIN_MODES`),
`core/chain-validate.ts` (the write guard), `fleet/request.ts`
(`persona.skills` → the skills section, D-46) + `fleet/instruction.ts`
(`skillsSection`), `fleet/protocol.ts` (the `gate` enum) +
`fleet/orchestrate/gate-runner.ts`,
`fleet/orchestrate/run-bookkeeper.ts` (the pickup),
`services/video-service.ts` (`enforceCap`), `core/proof-mode.ts`,
`core/verification.ts` (the format), `specs/ticket-schema.md` (Proof mode,
Videos, The chain), `server/verify-harness.ts` in history at `5c7c75f2`
(the recording core).
