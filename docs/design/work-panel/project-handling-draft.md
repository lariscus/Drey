# Projects — a draft for project handling (2026-11-13)

Status: **draft accepted in its direction (owner, 2026-11-13: "Ja, A"); the
answers to §9 are recorded in §10. Nothing built.**
Stage 1 of the design round the owner opened on 2026-11-13 after verifying
milestones 242–251. Stage 2 (boards in Claude Design: project settings, the
Persona page revised, Settings → Models) waits for his OK on this draft; stage 3
(concept documents and roadmap rows) waits for his OK on the boards. Whatever is
built from it goes **after the finish line** unless the owner says otherwise.

The owner's findings this draft answers (2026-11-13, paraphrased in English):
readable vaults belong to a project, not to a persona; a project scope with
source folders, name, purpose and the other vaults it may read; how projects
show in Files and Tickets; maybe several projects in dricket with a ticket filter
(all / one project); quotas stay cross-project.

## 0. What exists today (the facts the draft rests on)

- **There is no "project" anywhere.** The nearest things are the tickets
  repository (one board), `tickets/_meta/repos.md` (work repositories) and Drey's
  vault registry (ADR-0051). A ticket names its work repos (`repo:` / `repos:`),
  nothing names what the ticket is *about*.
- **The board is two places.** The *tickets vault* `E:\projects\drey-tickets`
  holds `tickets/_meta/` — pipeline, crew, personas, skills, chat, repos, the
  ledger. The *dricket store* `E:\projects\drey-board` holds the ticket records
  (`tickets.backend: dricket`, ADR-0090). The store already carries `repos`,
  `labels` and free `x-<name>` extension fields (R-01); one id sequence per store.
- **One board at a time.** The engine is started for one tickets vault; the chain
  (`fleet/orchestrate/chain-state-store.ts`) keeps state per vault but runs one:
  *"the chain moves from A to B — each vault keeps its own state"*. Mission
  Control, the phone and the Tickets panel all show that one board.
- **Vault rights today (R5, ADR-0094, req-167).** A worker **reads every
  registered vault** and writes the vaults its persona names in `persona.md`
  `allowed: write-vaults: [<vault id>, …]`. Drey hands the service its registry
  as the engine key `vaults.registered`. The tickets repository is reached by no
  vault tool. A 1:1 gets the read-only cut.
- **Vault ids are per device.** `mintVaultId()` (`electron/vault-manager.ts`) is
  `v` + 10 random hex characters, minted on each machine. `write-vaults` already
  stores such ids in a versioned file — on a second device they name nothing.
  (A latent defect of today, worth knowing; a project must not repeat it.)
- **What is machine-wide stays machine-wide.** Slots, profiles, the capacity
  pool, the class routing, the burn rate and the three ledgers (req-170/177/178/
  181) live in `service.json` and count every run on the machine. `repos.md`
  `profile: private | work` decides which slots may serve a repository.
- **The Files panel** shows one section per registered vault (req-23). **Find**
  scopes are This note | This vault | All vaults. **Views** (ADR-0089) are saved
  layouts.

## 1. What a project is

> A **project** is the context a piece of work happens in: a name, a short
> purpose, the repositories the work lands in, and the vaults a worker may read
> (and possibly write) while working on it.

It is a **work scope for the Crew**, not a note topic: tags stay free labels and
a project never creates or moves a folder (ADR-0017, the user's own folder
structure). A vault, a repository and a ticket can exist without a project.

### The record

One file per project in the tickets vault, beside `repos.md` — the vault layer
of R13, versioned, shared by every device working the board:

```markdown
tickets/_meta/projects/drey.md
---
name: Drey
color: "#8ecbef"
repos: [drey]                 # names from _meta/repos.md, primary first
vaults:                       # by registry NAME, never by device id
  Drey notes: write
  Work notes: read
  Private: none               # explicit "never", same as leaving it out
---
A local, topic-based note app (Electron + Angular) and its Crew. The Crew works
on the app itself; product decisions live in "Drey notes".
```

- **Body = the purpose**, a few sentences. It rides every run brief of the
  project as a short `## Project` section (counted in the persona page's
  "≈ N tokens at start"), so a worker knows what the thing is without
  re-deriving it from the repo.
- **`repos:`** references `repos.md` by name. `repos.md` stays the one registry
  of checkouts (url, branch, path, worktrees, link, launch, profile); the
  project only says which belong to it. A repo may belong to more than one
  project (a shared library).
- **`vaults:`** — the source folders that are notes, each `read | write | none`.
  Named by the vault's registered **name**, because ids are per device. On a
  device where a name is not registered, the project page shows "not on this
  device" and no run reads it there.
- No pipeline, crew, persona or quota keys. Those stay board-wide or
  machine-wide.

## 2. Integration with what exists

| Building block | What changes |
|---|---|
| **Tickets** | A ticket gets a `project:` field (`x-project` on the store, `project:` in the files backend). An inbox ticket may have none ("Unassigned"); leaving inbox for a working stage without one is a board issue, like a missing `repo:` today. A ticket's `repo:` / `repos:` must be repos of its project. |
| **`repos.md`** | Unchanged file. Settings → Repositories stays as the registry; a project page can add a repo in place (the "Add from folder…" probe registers it in `repos.md` and lists it in the project in one save). |
| **Vault MCP (ADR-0094)** | The run's token carries the ticket's project. **Read** = the project's `read` + `write` vaults (no longer every registered vault). **Write** = the project's `write` vaults, **and** the persona may write notes at all (§3), **and** the run is not read-only. `vault_list` lists only what the project lets the run see. Every refusal keeps today's `Error: …` wording and audit line. |
| **Persona `allowed:`** | `write-vaults: [ids]` leaves the persona. What remains is a yes/no — `allowed: write-notes: true` ("may change notes where the project allows it"). A reviewer stays read-only as today. The Persona page's "Allowed to" loses its vault list. |
| **1:1 and free sessions (R12)** | A free session takes a project (picked, or derived when its folder is a project repo's checkout) and gets that project's vaults. A 1:1 has no ticket: it reads the vaults of **every** project, read-only — the persona's coach should see what the persona works on. (Open question 4.) |
| **Pool, slots, quotas, routing** | **Unchanged and cross-project**, as the owner ruled. Ben's `2/2` in a column header counts all his runs whatever the filter shows. A run's profile still comes from its repo's `profile`. Report and Cost may *group* by project (display only, no fourth ledger). |
| **Personas, crew, pipeline, skills** | Board-wide, unchanged. One crew works every project of the board. |
| **Mission Control / Pia** | Pia knows the projects: a capture lands in the current filter's project (or asks when the filter is "All"); a ticket card names its project. |

## 3. The persona keeps one switch

The owner's conclusion: *which* vaults is a property of the project. But "may
this persona change notes at all" is a property of the persona — Ben writes a
decision note, Ralf never does. So:

- **Effective write** = project says `write` for that vault **∧** persona has
  `write-notes: true` **∧** the run is not read-only.
- **Effective read** = project says `read` or `write`.

Alternative weighed: move write completely to the project (every persona on a
project may write its `write` vaults). Simpler, one place — but a reviewer or a
tester would gain write rights the moment a project grants any, and the
read-only discipline (req-258) is only an instruction, not a lock.
**Recommended: the intersection above.**

## 4. Where projects show

### The Files panel

| Option | What the owner sees | Trade-off |
|---|---|---|
| **F1 — a project filter in the panel header** *(recommended)* | Files keeps one section per vault. A "Project ▾" control in the header: *All vaults* (today) or one project — then only that project's vaults are listed (and repo checkouts that are registered as vaults). The vault header row carries the project's colour dot. | Smallest change; the panel stays a vault browser. |
| F2 — projects as the top level | Project → its vaults and repos nested; vaults in no project under "Other". | Mirrors the model, but a vault in two projects appears twice, and repos are not vaults (they would need a read-only tree of their own). |
| F3 — nothing in Files | Projects only in Tickets. | Misses the owner's ask. |

### The Tickets / Work panel and the board

- **A project filter in the board's header** — *All projects* or one project.
  The same control in the Tickets panel, Mission Control's Work list (desk, iPad,
  phone) and the Review tab.
- With **All**, each card carries a small project chip (colour + short name);
  with one project selected the chip disappears (it would say the same thing on
  every card).
- **The persona columns stay whole.** The filter hides cards, never columns or
  capacity: `Ben · 2/2 · 1 waiting` and the pool chip `4/5 · 1 queued` count
  every project, because the pool is cross-project. A column with no card of the
  filtered project stays visible and says so by its empty body.
- **Capture** (+ in the panel, the phone's capture, Pia) puts the ticket into
  the filtered project; under *All* the ticket starts Unassigned.
- Unassigned tickets show under *All* and under an *Unassigned* entry of the
  filter.

### One filter or several?

| Option | Trade-off |
|---|---|
| **S1 — one "current project" per window** *(recommended)* | Changing it in Files, the board or the Tickets panel changes all three (and Find's This project scope, if that is taken). One state, saved with the View (ADR-0089), so a "Lariscus" view opens filtered. Mission Control on the phone keeps its own. |
| S2 — a filter per panel | More freedom, but Files on Drey and the board on Lariscus is a state the owner would rarely want and easily forgets. |

Optional, small: Find gains a **This project** scope (the project's vaults) beside
This vault | All vaults.

### Settings

A category **Projects** (master-detail like Personas): the list left, the project
right — name, colour, purpose (Drey's Markdown editor, like Instructions), its
repositories (chips from `repos.md`, Add repository… in place), its vaults
(one row per registered vault with a segmented `None | Read | Write`). One commit
per change, applied as made (ADR-0010 later change). Drawn in stage 2.

## 5. One store with several projects, or one tickets repository per project?

The owner is unsure which makes sense. Both, weighed:

### Option A — one board, several projects in it *(recommended)*

The tickets vault and the dricket store stay one; projects are records in
`_meta/projects/`, each ticket names its project.

- **For:** one crew, one pipeline, one set of skills, personas' memory and
  journals keep learning across projects; the board, Mission Control and the
  phone stay one surface with a filter; the engine and the chain stay "one board"
  as built; a ticket that moves between projects is one field edit; the
  cross-project pool needs nothing new. The store already has the field
  mechanism (`x-project`) and filters (R-05 `--label`, `ext`).
- **Against:** every project's tickets share one git history and one remote —
  a project whose tickets must not leave a work context (e.g. an employer's repo
  under `profile: work`) would sit in the private store; ids are one sequence
  (T-0093 Drey, T-0094 Lariscus); one pipeline for all projects.

### Option B — a tickets repository per project, bound in side by side

Each project is its own tickets vault + store (its own `_meta/`, pipeline, crew).

- **For:** full separation — its own remote, can be shared with other people,
  its own pipeline, ids per project; a work project's tickets live where the
  employer wants them.
- **Against:** the engine and the chain run **one** board today, so this means
  a multi-board engine (several chains, several stores, one pool); personas,
  skills and crew exist per board — copied and drifting, or a new shared crew
  layer; the "All" filter must merge boards whose ids collide (T-0001 twice);
  Mission Control, the phone, the 1:1 and Settings → Tickets each need a board
  switch. Several milestones of engine work before the first filter shows.

### The path between them

A does not close B: a project record can later gain a `store:` key — "this
project's tickets live in their own store" — while crew, skills and pipeline stay
in the one tickets vault (call it **A+**). That is the separation of B for the
one project that needs it, without copying the crew. It is only worth building
when a real project needs it.

**Recommendation: A now; A+ only on a concrete need.** Open question 1 asks the
owner whether such a need exists today (Lariscus).

## 6. Migration (option A)

1. The engine's start finds no `_meta/projects/` and writes **one project**,
   named after the board (or the first repo), holding every `repos.md` entry and
   every registered vault as `read` — exactly today's behaviour, now visible.
2. Every persona's `write-vaults: [ids]` becomes: those vaults `write` on the
   project (ids resolved to names on this device) and `write-notes: true` on the
   persona. Ids this device cannot resolve are reported, not guessed.
3. Tickets are **not** rewritten: a ticket without `project:` reads as the board's
   only project while there is one; once a second project exists it reads as
   Unassigned. One logged commit, like the other migrations.

## 7. What this changes in the existing concepts

- **crew-internals R5** ("read every registered vault, write none by default")
  becomes "read the project's vaults; write where the project and the persona
  both allow it". ADR-0094 gets a later change (the token carries the project;
  `PersonaRights` becomes a project-and-persona grant).
- **R12** (session record) gains `project`; a free session picks one.
- **R13** (three layers): projects are vault layer, beside `repos.md`.
- **req-171 / the Persona page**: "Allowed to" loses its vault rows, keeps
  `write-notes` (stage 2 board).
- **persona-board-concept §11 (surfaces)**: the board header gets the filter and
  the cards a project chip; columns and load stay global.
- **ticket-schema**: `project` / `x-project`; `_meta/projects/`; the issue for a
  working ticket without a project.
- **The run brief (ADR-0097)**: a `## Project` section from the purpose.
- Files panel (req-23), Find (req-161), Views (ADR-0089): the project filter.
- **decisions.md** at the end of the round: Option B (and F2/S2) as weighed and
  not taken, with today's date.

## 8. Carried into stages 2 and 3

- **The persona picture (D-67, owner 2026-11-13):** change and remove the
  picture — req-235's desktop half — is part of the Persona page v3 board and
  of the concept and roadmap items stage 3 writes. D-67's defect row has left
  the roadmap (commit 8503f298) and is not added back.

## 9. Open questions for the owner

1. **Separation need:** must any project's tickets live outside the private
   store today — Lariscus (`profile: work`)? If yes, A+ for that project; if no,
   plain A.
2. **Write rights:** the intersection of §3 (project per vault ∧ persona switch),
   or write fully on the project?
3. **One current project per window (S1)**, shared by Files, board and Tickets
   panel and saved with the View — or a filter per panel?
4. **The 1:1:** read every project's vaults (recommended), or pick a project
   when the 1:1 opens?
5. **Non-git source folders:** a project's "source folders" are its repositories
   (runs need a git worktree). Should a project also list plain folders a worker
   may *read* as context (a spec folder, a shared drive copy)? Recommended: not
   now — register such a folder as a vault and grant it `read`.
6. **Profile:** stays per repository (today), or becomes the project's default
   for its repos (Lariscus = work)? Recommended: stays per repo.

## 10. The owner's answers (2026-11-13)

Given in German in the session; English here.

- **Option A** — one board, several projects in it ("Ja, A"). A+ stays a later
  option for a project that needs its own store.
- **Write rights: both** — the project per vault **and** the persona's
  `write-notes` switch (§3, the intersection).
- **Filter:** the owner leans to **one global filter that filters the view** and
  asked for a view on it. The session's answer: one **project filter in the
  title bar**, beside the view switcher — Files, the Tickets panel, the board,
  the Review tab and Find follow it; it is saved with each View (ADR-0089), so a
  "Lariscus" view opens filtered. This replaces S1's "the same control in every
  panel": the panels show the active filter as a quiet line, they do not each
  carry a switch. Mission Control on the phone keeps its own filter. Drawn on the
  stage 2 board.
- **The 1:1 reads every project, but not every vault:** the union of the
  vaults (and folders) that some project grants, read-only. A registered vault
  no project names is not read by a 1:1.
- **Folders without git are a source too:** a project lists plain folders
  (`folders:` in the record, read-only — a spec folder, a copy of a shared
  drive). The workers' vault MCP serves them read-only beside the vaults, under
  the same path rules (no dot-folders, no `.git`, links resolved inside the
  folder). They never host a run: runs still need a repository's worktree.
- **Profile: dropped.** Asked what it is (req-177's `profile: private | work` on a
  repository: which accounts may serve runs on it), the owner answered that he
  needs **no distinction between work and private**. So a project carries no
  profile, and stage 3 retires the profile altogether: every slot may serve every
  repository (the `profile:` key of `repos.md`, the slots' `profile` in
  `service.json`, the refusal "no slot of this profile" and the Private / Work tags
  in Settings go; an old key is read and ignored). A `decisions.md` entry records it.
- **On the boards (owner, 2026-11-13):** the project colour gets a free colour
  picker beside the presets, as the highlight colour in Settings → Appearance has;
  Purpose (and the persona's Instructions) are Drey's Markdown editor — the
  formatting strip and Live | Source, as on today's Persona page — not plain text.
