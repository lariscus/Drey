# Projects, Persona v3, Models v3 — the concept of the design round of 2026-11-13

Status: **accepted by the owner on 2026-11-13** — the draft ("Ja, A"), his answers
(§10) and the stage 2 boards ("Passt", §11). Nothing built; the build items are
roadmap rows req-282 – req-291 (§12), placed **after the finish line**.

The file keeps its first name (`project-handling-draft.md`) because the canvas note
and the boards index point at it. §0 – §9 are the stage 1 draft as the owner read
it; where §10 and §11 differ from them, §10 and §11 hold.

The round ran in three stages: the draft (stage 1), boards in Claude Design
(stage 2: `DeskProjects`, `DeskProjectFilter`, `DeskPersonaV3`, `DeskModelsV3`,
`DeskSkillsLibrary`, exported to [boards/](boards/README.md)), and this concept with
the roadmap rows (stage 3).

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
| **Pool, slots, quotas, routing** | **Unchanged and cross-project**, as the owner ruled. Ben's `2/2` in a column header counts all his runs whatever the filter shows. (The repository `profile` of req-177 is retired — §10.) Report and Cost may *group* by project (display only, no fourth ledger). |
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
- **Models (owner, 2026-11-13):** a model must move between classes easily — by
  dragging its row into another class or through the class menu on the row;
  a class **super heavy** above heavy (for Fable), and the list of classes is the
  owner's (Add class); every account carries its **cost** — subscription per
  month, credits per credit, or per token — edited in place (today the board and
  page give no place for it).
- **Settings have no scopes (owner, 2026-11-13):** the tabs All devices · This
  device · This vault go from Settings — settings are global. The one exception:
  a phone or iPad sets its own appearance (theme, text size) on that device, and
  that is not configurable from the desktop. Where a setting is stored (the
  vault's `_meta/`, the machine's `service.json`, the app config) stays an
  implementation detail the page does not show. Stage 3 turns this into an
  ADR-0010 later change and a roadmap item that removes the scope tabs from the
  built Settings tab (board 7g, milestone 197).

## 11. What the boards settle (stage 2, accepted 2026-11-13)

The boards are the reference for the look; this section is the behaviour they
show, so the rows of §12 can be built from it.

### Projects — board 7m `DeskProjects`, board 7n `DeskProjectFilter`

- **Settings → Projects**, a top-level category: the projects listed left (colour
  dot, name, ticket count, *New project*), the project right — Name, Colour (six
  presets **and a free colour picker**, the highlight colour's control in
  Settings → Appearance), **Purpose in Drey's Markdown editor** (formatting strip,
  Live | Source; its token count beside the title), Repositories (chips from
  `repos.md`, the first marked `primary`; *Add repository* opens an inline picker
  of the registered repos plus *From folder…*), Folders (plain folders, read-only,
  *Add folder*), Vaults (one row per registered vault, segmented None | Read |
  Write; a vault the record names that this device has not registered is greyed
  with *not on this device*). No profile, no Save — every change is one commit,
  applied as made.
- **The global project filter** sits in the title bar right of the view
  switcher: a colour dot, the project name (or *All projects*) and a chevron. Its
  menu: All projects · each project · Unassigned (with its count) · *Manage
  projects…*. Files, the Tickets panel, the board, the Review tab and Find follow
  it; it is saved with the View. Under one project the Files panel lists that
  project's vaults and folders (a `read` tag on the read-only ones) with the line
  `Drey · 2 vaults, 1 folder` under its header; the board shows only that
  project's cards. **Columns and load stay global** — `Ben · 2/2 · 1 waiting` and
  the `4/5 · 1 queued` chip count every project (tooltip *Counts every project*).
  Under *All projects* each card carries a small project chip.

### Persona v3 — board 7k v3 `DeskPersonaV3`

- **No harness choice.** The **Model** block picks a **class** (super heavy ·
  heavy · standard · light — the classes the owner keeps in Settings → Models)
  and a **Model**: `Next free in class` (the default) or one model of that class
  pinned (the listbox names the discovered models of the class with their
  harness, e.g. `claude-opus-5-5 · Claude Code`, `kimi-k3.1-pro · Kimi CLI`;
  under it `2 heavy models · 1 free now`). A pinned model means the router never
  grants another model of the class to this persona — heavy with Opus pinned is
  never served Kimi K3.1 Pro. The harness follows from the model. The persona
  record carries `class:` and an optional `model:` instead of `worker:` and
  `models:` (default + pool); the class floor `min-class` folds into `class` (a
  ticket's `class:` / `size` may still raise a run above it, never below).
- **Profile**: the picture with a camera button — *Upload picture…* and *Remove
  picture* (D-67, req-235's desktop half); Name, Role, One line for the crew list.
- **Work**: Parallel max / min, Read-only, Leaving actions, Daily budget, Tell
  me when (req-258's settings, without the model pool and the class floor).
- **Allowed to**: Run commands (Accept edits | Bypass), Reach the network,
  **Change notes where the project allows** (`allowed: write-notes`, §3), Spend
  above allowance; a link *Vaults are set per project*. No vault list.
- **Skills**: *Add from library* opens a searchable list of the library's skills
  with their source (`shared`, `own`, `github.com/…`); each of the persona's skill
  rows has its switch, its source line (`github.com/acme/skills ·
  go-conventions@v1.4`, an *update available* tag when the source has a newer
  ref), its token count and a remove button.
- **Instructions** is Drey's Markdown editor (formatting strip, Live | Source,
  Live Preview) and **fills all the space** the right side has; *Preview full
  prompt* and `≈ N tokens at start` above it.
- **Proposals** as today; footer Discard · Save.

### Models v3 — board 7l v3 `DeskModelsV3`

- **Harnesses**: one row per harness the machine has — name, version, state
  (`signed in`, the providers it is configured for, or `not installed` with
  *Install…*), and how many models it offers. *Checked 2 min ago* and a refresh
  button (*Find models again*) beside the page title. **Models are discovered,
  never typed in**: from what each installed harness has configured and available
  (an ACP harness lists its models in the `session/new` reply's config options —
  opencode, Kimi CLI, Copilot CLI; Claude Code's from its own model list and
  settings), the capabilities (context, tools, images) filled from the model
  registry import of milestone 217. A model found for the first time appears as a
  card above the classes with a class choice, *Add* and *Ignore*.
- **Classes**: a list the owner keeps — shipped as **super heavy · heavy ·
  standard · light** (today's A · B · C become heavy · standard · light; super
  heavy is new, for Fable-class models), *Add class* for more. Each class is a
  group with its models and **at most N sessions at once** — the slots live at
  class level. A model row: drag handle, model id, harness · account chip,
  capability icons, context, cost factor, **its class as a menu**, and a switch
  (the router may use it). A model moves to another class by **dragging the row
  into the class or picking the class in the menu**.
- **Accounts** (the slots of req-177, now an optional extra cap per account):
  label, harness, **cost** — Subscription per month, Credits per credit, or Per
  token, with the amount, edited in place — the account's own session cap, its
  quota windows where known, and remove. *Add account* opens an inline row
  (label, harness, cost, sessions; Add / Cancel); remove asks in the row (*Remove
  Claude B? 1 model uses only this account.* Remove / Keep). No file dialog
  (milestone 252 built in-place add and remove for today's slots).
- Global cap one line under the title; Routing as one folded row.

### Skills library — board 7o `DeskSkillsLibrary`

- **Settings → Skills library** (`_meta/skills/` of the tickets vault): *Add from
  GitHub* opens an inline row — Repository, Path, Ref, *Fetch* — and *Upload
  skill…* stays (the zip upload of milestone 232). **Sources**: each GitHub source
  with its ref, skill count, last fetch, *Update to <newer ref>* and remove.
  **Skills**: search, a filter All | Shared | GitHub | Own, and one row per skill —
  name, source, *Used by* (the personas' initials), size in tokens, a `⋯` menu.
- A fetched skill stays files (R8): its folder lands in `_meta/skills/<name>/`
  as an Agent Skills folder, its source (`repo`, `path`, `ref`, fetched commit)
  recorded beside it, one commit per fetch or update.

### Settings without scopes

- The Settings tab loses the scope tabs All devices · This device · This vault
  (milestone 197's frame). **Settings are global.** The one exception: a phone or
  iPad sets its own appearance (theme, text size) in Mission Control on that
  device, and the desktop does not configure it. Where a value is stored — the
  tickets vault's `_meta/`, the machine's `service.json`, the app config — is the
  implementation's business, not the page's. Models and accounts stay per
  machine (`service.json`); a second desktop sharing them would be a later sync
  item, not part of this round.

## 12. The build items (roadmap rows req-282 – req-291)

After the finish line, frozen until the merge into `main`, in this order.
Models: Opus where the engine or data changes, Sonnet for the boards-to-screen
rows (the owner's rule for delegation).

| Row | What | Touches |
|---|---|---|
| req-282 | **Projects: the record and the migration** — `_meta/projects/<id>.md` (name, colour, purpose, repos, folders, vaults), `project:` / `x-project` on tickets, the default project written once, `write-vaults` → project grants + `write-notes`, the board issue for a working ticket without a project, `## Project` in the run brief | `core/`, `store/extension-keys.ts`, ticket schema, ADR-0097 |
| req-283 | **Vault rights per project** — the worker's token carries the project; read = the project's vaults and folders, write = project Write ∧ `write-notes` ∧ not read-only; a 1:1 reads every project's vaults and folders read-only; plain folders served read-only | `service/vault-mcp/`, ADR-0094 later change, R5 |
| req-284 | **Settings → Projects** (board 7m) | tickets plugin settings, the colour control, the Markdown editor |
| req-285 | **The global project filter** (board 7n) — title bar, saved per View; Files, Tickets panel, board, Review, Find; the card chip; capture into the filtered project; Mission Control's own filter and Pia's projects | base (title bar slot, Views), Files panel, tickets plugin, Mission Control |
| req-286 | **Model discovery from the harnesses** — the harness rows, the model lists, *Find models again*, the new-model card | `fleet/harness/`, `fleet/routing/`, `service.json` |
| req-287 | **Classes and accounts** (board 7l v3) — the owner's class list (A/B/C migrated, super heavy, Add class), at most N per class, move by drag or menu, the router switch, account cost in place | `fleet/routing/`, Settings → Models, ADR-0095 later change |
| req-288 | **Persona v3** (board 7k v3) — `class:` + optional `model:` instead of `worker:` / `models:` (migrated), `min-class` folded in, the picture (D-67, req-235), Allowed to without vaults, skills from the library, Instructions filling the rest | `core/persona.ts`, dispatch, Persona page |
| req-289 | **Skills library with GitHub sources** (board 7o) — fetch, update, source record, Used by, the persona's *Add from library* | `services/` skills routes, Settings, R8 |
| req-290 | **Retire the slot profile** — `profile:` in `repos.md`, the slots' `profile`, the refusal; old keys read and ignored | `fleet/routing/`, `repos.md` parser, FLEET.md |
| req-291 | **Settings without scopes** — the scope tabs leave the Settings tab; the mobile appearance stays device-local | `src/app/settings/`, ADR-0010 later change |
