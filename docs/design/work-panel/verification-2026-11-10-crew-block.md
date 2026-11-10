# Verification round: the crew block (milestones 213–234)

Status: checklist for the owner's verification of `desktop-integration` at
`553ce5eb` (2026-11-10). Everything below is marked **Not yet manually
verified by the owner** in `specs/changelog.md`; this round removes the
marker where it holds and turns what fails into "Known defects" rows of
`specs/roadmap.md`. Nothing of the block is on `main` yet.

## 0. Before the first start

What the integrator ran on the tip: typecheck (11 configs), import cycles,
ESLint, the whole vitest suite (585 files / 5694 tests), the four Angular
suites, and the full e2e suite (`npm run e2e`, 86 specs) — see the top
entries of the changelog for the figures per milestone. What nobody ran: a
real agent on a real harness through any of the new flows. That is this
round's job.

**Back up first.** The first start migrates files in place, once each:

| Milestone | Migration on first start | Where it writes |
|---|---|---|
| 230 | the keys of `~/.drey-engine/config.json` and of `chain.json`'s `config` move into `tickets/_meta/crew.md`; `chain.json` becomes one per vault under `fleet/chains/<vault key>/` (runtime state only) | the tickets repo (one commit), the service home |
| 229 | `personas/<id>/friction.md` goes up in `reviews.md` | the tickets repo (one commit) |
| 232 | a flat skill `<name>.md` becomes `<name>/SKILL.md` with a generated frontmatter | the tickets repo (one commit) |
| 231 | the prose below the `persona.md` frontmatter moves to the top of `prompt.md`; the placeholder sentence goes | the tickets repo (one commit per persona) |
| 225 | `_worktrees/<id>.ticket.md` moves to `_workcopy/<id>.ticket.md` on the next read | the tickets repo |
| 215 | `fleet.pool.<provider>.size` becomes the `sessions` of that provider's slots | the service home |

So: commit and push `E:\projects\drey-tickets` (every migration there is a
commit you can revert), and copy `%USERPROFILE%\.drey-engine` to a folder
beside it. Keep your `~/.claude/skills` as they are; nothing writes there.

**Start.** From `E:\projects\Drey-desktop-integration`: `.\dev.ps1 -Built`
(a fresh production build, then the packaged-style app). Drey Service starts
with it; since milestone 222 a **tray icon** appears (Settings → Background
service → Tray icon, default Shown; "Hide" from the tray menu ends the tray
process, the service keeps running). The service log is
`~/.drey-engine/logs/` per component and day; the Logs tab of the service
window shows it live.

**Report.** One line per finding is enough — what you did, what you saw,
what you expected. The integrator turns them into D-rows and keeps the
milestone's marker until they are fixed.

## 1. What only you can verify: a real agent through the new flows

These need a harness and a model. One ticket through the chain exercises
most of them at once.

1. **A build run** (milestones 214, 215, 217, 219, 226, 227): start a run on
   a small ticket with Claude Code; then one with opencode (now over ACP,
   `opencode acp`). Watch: the run starts only when its class has capacity
   (the card says `queued · waits for a <class> slot` otherwise), the
   Capacity band's Slots row shows the slot and its windows, the worker
   reaches the vault (ask it in the ticket to read a note — the call appears
   on the run's stream as a tool event; a write to a vault the persona may
   not write is refused with `Error: … may not write vault`).
2. **The review** (225): when the chain reaches review, the reviewer runs in
   `_worktrees/<id>-review`, read-only; the Files panel shows the checkout;
   the gate fails if the branch moves after the review began. Check
   whether Claude Code's `plan` mode still lets the reviewer read files,
   and whether opencode's `plan` agent asks before `git diff` (then it
   becomes a wait for you — tell me, that is req-199's open question).
3. **The closing round** (229): make a run noteworthy (a red gate is the
   easiest: an acceptance command that fails). After the verdict the
   persona is asked once more; `reviews.md` gets an entry, `memory.md` at
   most one lesson line; a smooth run writes nothing. Memory tab: Memory
   and Journal apart, remove a line of each.
4. **A tranche with Autopilot** (221, 224): Autopilot on with a tranche of
   two or three tickets; the checkpoint card at the end of the tranche;
   early stop; the burn-rate hold if a day's spend crosses
   `routing.burnRate` (Settings → Models → Routing; the lift card says
   `Allow today once`).
5. **A 1:1** (228, 234): Crew tab → a persona → 1:1; type a line; the
   persona's own harness answers into `_meta/chat/…` with `persona:`; the
   session shows as `held · releases in N min` in the service window and
   releases after 15 minutes idle; ask it to read a note — it may list,
   search and read vaults, nothing else. Mission Control's *Talk to <name>
   1:1* shows the same file.
6. **A free session** (230): service window → Sessions → *New session…*
   (persona, folder, class); the tickets vault itself as the folder; the
   session appears with its directory and releases after idle. The Crew
   tab has the same button.
7. **The governor** (223): Settings → Background service → Load: seats,
   reserve, quiet hours; the service window's Governor block shows the live
   values; a second heavy task waits while the first holds the seat.
8. **Copilot CLI** (226): not installed on the build machine, so the adapter
   follows the docs only. If you have `copilot` installed, one run with the
   worker `copilot` is the whole test (req-208).

## 2. What you can verify without a model

| Milestone | Look at | Expect |
|---|---|---|
| 216 | Settings → Background service | board 8c: the service's state, autostart, tray, load group, sleep |
| 218 | the Capacity band (Work tab) | Slots row, Tranche-and-queue row, header value as board 7e |
| 220, 224 | Settings → Models | the model table (id, provider, category, class, factor), the cap, slots with quota windows; the Routing group saves what it shows |
| 222 | the tray and the service window | Components, Sessions, Logs tabs as boards 8a/8b; *Restart* is refused with a reason while a gate runs |
| 231, 233 | Crew → a persona (page) | the R11 mockup block by block: Drey's Markdown editor in Instructions, `≈ N tokens at start`, Preview full prompt, Allowed to, Skills with switches / off rows / `Add skill…` (upload one of your `~/.claude/skills` folders), Proposals, Save as one commit, `Saved · committed N days ago` |
| 232 | the tickets repo | your flat skills became folders; `_meta/skills/<name>/SKILL.md` parses |
| 230 | Settings → Tickets | the Fleet group under *This vault*, Models under *This device*; `_meta/crew.md` holds default worker, permission mode, caps |
| 210 and later | every new surface | English throughout, no explanatory prose, icon buttons with tooltips |

Known deviations the sessions recorded (not defects): desktop cards 308 px
instead of 348 (222), the native tray menu cannot be red, the persona page
has no portrait upload and no *Tell me when* (req-235/236), skill titles
read as the folder name (req-250), a free session has no chat file
(req-233), `shape` is typed only (req-229).

## 3. Open rule question

Whether every gap must become a roadmap row (CLAUDE.md, "Parts you
deliberately leave out become new roadmap items"): the block produced
req-187–255. The integrator proposed a threshold (a row only for what the
owner would notice or what touches a ruling; tuning stays in the changelog's
Gaps line). Undecided.
