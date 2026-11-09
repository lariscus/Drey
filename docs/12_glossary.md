# 12. Glossary

Terms as this documentation and the code use them. Terms of the first
design that no longer exist (master document, primary tag, inbox,
capture popup, tag routing) were removed on 2026-10-13; they are
explained where they were retired,
[ADR-0017](09_architecture_decisions/0017-tags-as-labels-and-section-index.md)
and [ADR-0002](09_architecture_decisions/0002-quick-capture-opens-daily-note.md).

## The user's data

| Term | Meaning |
|---|---|
| Vault | A folder on disk holding notes. Drey reads and writes the files in it directly. Several can be registered. |
| Vault registry | The list of vaults Drey knows, stored in `<userData>/vault-config.json` — never inside a vault ([ADR-0051](09_architecture_decisions/0051-multi-vault-registry.md)). |
| Vault id | The stable identity of a registered vault. Minted at registration, survives the folder being moved. |
| Active vault | The vault that new content goes to by default: daily notes, quick capture, chats. |
| Note | A Markdown file in a vault, with optional YAML frontmatter. |
| Section | The part of a note from one heading to the next. The unit the tag index, search and the assistant's vault context work on. |
| Tag | A `#label` written in a note's text. May be nested with `/` (`#project/frontend`). Never a folder. |
| `#task` | The reserved marker for a task line. A structural marker, not a tag. |
| Wikilink | `[[Note]]` or `[[Note#Heading]]` — a link to another note by name ([ADR-0046](09_architecture_decisions/0046-wikilinks.md)). |
| Daily note | One note per day under the daily-notes root (`daily/` by default), created from `templates/daily.md`. |
| Entry | A timestamped block in a note (`## HH:mm`), inserted from the `/` menu. |
| Chat note | An assistant conversation stored as a note under `chats/` ([ADR-0048](09_architecture_decisions/0048-chats-as-vault-notes.md)). |
| Draft | An untitled tab saved to the hidden `.drafts/` folder when the app closes. |
| Attachment | A non-Markdown file a note refers to, kept under `attachments/`. |
| Structural folders | The folders Drey itself creates: `templates/`, the daily-notes root, `chats/`, `.drafts/`. Everything else is the user's. |
| Note history | Earlier versions of a note, kept outside the vault under `<userData>/history/`. |

## The application

| Term | Meaning |
|---|---|
| Base application | Everything that is not a plugin: shell, editor, vault access, model transport, the plugin hosts. |
| Main process | The Node side of the app (`electron/`). The only part with file and network access. |
| Renderer | The window (`src/app/`). Sandboxed; reaches the main process through the bridge. |
| Bridge | `window.dreyApi`, the typed interface the preload script exposes to the renderer. Its shape is `shared/ipc-api.ts`. |
| Drey Service | The one background process that comes with Drey (ADR-0092): it hosts the tickets engine, the Crew runner, the remote gateway and, later, the MCP server as components. Optional (`service.enabled`, off by default): off, it ends with Drey; on, it outlives Drey until nothing holds it. Controlled in Settings → Background service. |
| Service window process | Drey Service's tray icon and its window: a small Electron process from Drey's binary (`--drey-service-window`) that the service starts and ends (req-165, ADR-0092). A client of the service's HTTP API; it holds nothing. |
| Service window | The window of Drey Service (boards 8a/8b): **Components** (the components, slots, governor and the log), **Sessions** (every harness session raw: stream, instruction, tool calls, process; send, interrupt, resume) and **Logs**. The workshop; Drey's Thread stays the clean view. |
| Atomic restart | `POST /restart` of Drey Service: the runner hands its runs over, the service starts its successor and leaves; refused while a run is in its gate (req-165). |
| Plugin | A feature loaded at startup from `plugins/<id>/`: a main half, a renderer half, a manifest. Trusted, in-process. |
| SDK | The versioned interface plugins are written against (`shared/plugin-api/`): `DreyPluginApi` for the renderer half, `MainPluginContext` for the main half. |
| Seam | One kind of thing a plugin can register: a panel, a tab kind, a command, a save hook, … |
| Registry | The base-owned list behind a seam. The base draws or calls whatever is registered. |
| Provider | An object one plugin registers so that the base or another plugin can query its data: section search (tags), task query (tasks). |
| Save hook | A function a plugin registers to run after every note save, used to keep its index current. |
| Quarantine | The state of a plugin that failed to start: not loaded, reported, the app runs without it. |

## The window

| Term | Meaning |
|---|---|
| Dock | One of three regions (left, right, bottom) holding panels. |
| Panel | One tool in a dock: Files, Calendar, Search, Tasks, Assistant, … Called a *widget* in the code. |
| Pane | One editor area. The centre can be split into several; a dock can host one as its *editor band*. |
| Tab | One open document in a pane. |
| Doc kind | What a tab shows: a note, an image, a PDF, a help page, or a kind a plugin registered (browser, diagram). |
| Doc key | A tab's identity: `vaultId::path`. |
| Live Preview | The default editing mode: the note is shown rendered, and Markdown syntax appears only around the cursor ([ADR-0009](09_architecture_decisions/0009-live-preview-decorations.md)). |
| Quick capture | A global hotkey that brings Drey forward and opens today's daily note. |

## Models and tools

| Term | Meaning |
|---|---|
| Provider (model) | One way to reach a model: the local endpoint, a hosted API, or a command-line tool ([ADR-0047](09_architecture_decisions/0047-llm-provider-abstraction.md)). |
| Action | A user-defined prompt run on a note, by hand or on save, whose result is applied after confirmation. |
| Ask | A question to the assistant in its panel. |
| Vault chip | The assistant's switch that adds the most relevant note sections to a question. |
| Vault context | The note sections that ride an assistant question while its Vault chip is on: the ones that contain words of the question, found by text search ([ADR-0072](09_architecture_decisions/0072-vault-context-by-text-search.md)). |
| Tool group | A set of tools the assistant may call, with one switch: vault, tasks, templates, web search, web fetch, each external server. |
| Web chip | The globe button in the assistant's composer: whether the next question may use the tools that leave the machine (web search, web fetch, external servers). |
| MCP | Model Context Protocol. Drey is both a server (other programs use the vault) and a client (the assistant uses external servers). |
| Confirmation dialog | The one dialog that shows a proposed change as a diff ([ADR-0011](09_architecture_decisions/0011-unified-confirmation-flow.md)). |
| Own-write ledger | The record of files Drey itself just wrote, so the watcher does not report them as outside changes. |
| Slot | One account a fleet worker runs on — `Claude A`, `Claude B`, `z.ai`, `Kimi` — with a profile, a billing kind, a session cap and quota windows. Configured in the service home's `service.json`; a slot names the account's login, never its key (req-177, [ADR-0095](09_architecture_decisions/0095-model-table-and-capacity-pool.md)). |
| Profile | `private` or `work`. A repository has one (`profile:` in `_meta/repos.md`, default `private`) and its runs go only to slots of the same profile. |
| Quota window | A span over which a provider limits an account's use — the rolling five hours, the week, the month — with the share left and its reset time. |
| Reliability | How far a window's numbers can be trusted: `measured` (read from the provider), `estimated` (counted by the runner, or a cache), `unknown`. |
| Surplus (q) | A window's remaining share divided by its remaining share of time; a slot's q is the minimum over its windows. Above 1 the account has more left than an even pace would use. |
| Routing filter | The hard stage of the choice within a granted class (req-178): a slot is taken out — with its reason on the route line — when its profile is the other one, the model does not declare what the step `needs:`, the slot needs a login, is spent or busy, a cap or its day ledger is full, or a run would take a window below the reserve. |
| Routing choice | The soft stage after the filter: the slot of the ticket's last run if it passed, else the largest surplus q, then the cheaper cost factor, then the cheaper slot price. Always within the class asked for. |
| Step up | Above `Upgrade above q` (default 1.3) the chosen slot runs the next stronger model of the persona's pool that the same slot serves, if it passes the filter. Only upwards, one step, never onto another slot, never on a pin; a smaller class is never taken. |
| Reserve per window | The share of every quota window kept back (default 10 %): a run whose estimated share — learned from the ticket's, else the persona's runs on that slot, else 5 % — would take a window below it waits. |
| Needs (`needs:`) | A step's required model capabilities on a ticket, a plan part or a pipeline phase: `image`, `tools`, `context-<n>`, `output-<n>`. The filter takes only a model whose row declares them. |
| Route line | The runner log's and the stream's record of one routing decision: `route T-0121 → claude-a/sonnet: class B, q 1.4, est $0.40 · filtered: kimi (no image input)`. |
| Slot state | `ready`, `busy` (runs of the cap), `exhausted` (a window spent), `needs login` (the account's login was refused; no run starts until it is signed in again) or `unknown` (nothing read or counted yet). |
| Model table | Settings → Models, kept in the service home's `service.json`: one row per model and slot (or provider) with its category, capability class, cost factor and sessions — the only models a persona's pool may name (req-170, [ADR-0095](09_architecture_decisions/0095-model-table-and-capacity-pool.md)). |
| Capability class | A model's class in the model table: `A` (strongest), `B` or `C`. A session gets exactly the class it asked for, never a smaller one. |
| Cost factor | What one active session of a model weighs against the capacity cap (board 7l: opus 5, sonnet 1, glm 0.4). |
| Capacity cap | The most the active sessions may weigh at once, in cost factors: one global, one per slot (set, or derived from the slot's largest row at full sessions). Only active sessions count — a queued task weighs nothing. |
| Class request | What a session asks the pool for before it starts: its persona, a capability class and its context size. The chain derives the class from a ticket pin, the plan part's size (S → C, M → B, L → A) or the persona's default, raised to the phase's `min-class:`. |
| Queued | A task the pool did not grant: no process starts, the card reads `queued · waits for a B slot`, and the next pass serves the queue in priority order. |
| Ledger | One of three spend limits the pool checks, each a sum over the session records: the ticket's allowance (`allowance:`), the persona's day (`budget:`), the provider's (slot's) day. A full ledger grants nothing and raises a Needs-you card. |

## The Crew (tickets and agents)

| Term | Meaning |
|---|---|
| Ticket | A unit of work with an id (`T-0121`), a description, a plan with executable acceptance criteria and a log, kept in the tickets repository ([ADR-0076](09_architecture_decisions/0076-ticket-repository-format-and-coordination.md); format `specs/ticket-schema.md`). |
| Tickets repository / ticket store | The git repository that holds the tickets. Since the cut-over of 2026-11-06 it is a **dricket** store, written only through `dk` ([ADR-0090](09_architecture_decisions/0090-tickets-on-dricket.md)); the runner refuses to work on a plain folder board (milestone 214). |
| Board | The pipeline as columns in an editor tab; the Work panel is the same data as lists. The state list is `Inbox → Shaping → Prioritized → Building → Ready to try → Done`. |
| Stage / phase | A stage is a column of the board; a phase is an agent step inside Building (Plan, Build, Review, Test), the chain's unit ([ADR-0077](09_architecture_decisions/0077-continuous-orchestration.md)). |
| Pipeline | `_meta/pipeline.md` in the tickets vault: the stages, which are manual and which are agent columns (`handover: agent | manual | ci`), their prompts and pins. |
| Persona | A role with a prompt, memory, skills and a model pool, stored under `_meta/personas/<id>/`. The default crew: Paul plans, Ben builds, Ralf reviews, Tessa tests; Pia is Mission Control. |
| Mission Control / Pia | The conversation surface over the tickets engine (desktop Assistant target, iPad, phone): she executes commands and raises decision cards, she does not do the work herself ([ADR-0093](09_architecture_decisions/0093-persona-sessions-the-1on1.md)). The concept's "Lead" is Pia with a fixed command set. |
| Crew | The personas and their runs; the Crew tab shows them. The product name is Drey Crew. |
| Accept | The one decision verb: accepting a plan, accepting a result on Ready to try (which merges, pushes and lands the ticket in Done). Proposals carry Confirm / Dismiss. |
| Autopilot | The one switch with three states — On (tickets move and start by themselves), Paused (running steps finish, nothing new starts), Off (you start every step); every start is Off ([ADR-0077](09_architecture_decisions/0077-continuous-orchestration.md)). On releases one **tranche** at a time (req-179); at its end it reads Paused with the reason checkpoint. |
| Chain | The dispatcher inside the runner that serves the agent columns' queues, with the circuit breaker, cooldowns and the daily token budget. |
| Drey Service | The one background process shipped with Drey, optional (`service.enabled`, off by default): tickets engine, Crew runner, MCP server and remote gateway as components, a tray icon and its own window ([ADR-0092](09_architecture_decisions/0092-drey-service-the-shipped-background-process.md)). |
| Crew runner (fleet runner) | The component that owns the worker processes, the per-run stream files, the worktrees and the machine gate; reachable over a loopback HTTP API with a bearer token and a `GET /events` stream ([ADR-0075](09_architecture_decisions/0075-agent-fleet-architecture-governance-and-run-control.md), [ADR-0096](09_architecture_decisions/0096-crew-runner-refactor-state-machine-ports-and-file-size-rule.md)). Operations: `plugins/tickets/FLEET.md`. |
| Harness / adapter | A harness is the CLI or server that drives a model (Claude Code, OpenCode, Kimi Code, Copilot CLI); an adapter is the runner's code under `fleet/harness/` that speaks to one, behind one contract. ACP (Agent Client Protocol) is the target protocol (req-182). |
| Run | One worker session on one ticket in one worktree: a record (`run.json`), a stream (`stream.jsonl`), a state. |
| Run state machine | `RunStateMachine`: the one place a run's state changes (`starting`, `running`, `stopping`, `detached`, then `done`, `stopped` or `failed`), a transition table over the events the supervisor reports (§6.99). |
| Machine gate | The ticket's acceptance criteria — backticked commands under Plan — that the runner executes after a worker's turn; green moves the ticket, red parks it with the failure's tail for the next run. |
| Worktree (`t/<id>`) | The worker's own checkout of the work repository on the ticket's branch, under `<tickets repo>/_worktrees/<id>/` ([ADR-0080](09_architecture_decisions/0080-fleet-worktrees-home-and-cleanup.md)). |
| Handover (session) | How a run's context reaches its worker: fresh, resume, resume-compact (T-0049). Not the pipeline's `handover:` key, which is a column's mode. |
| Needs-you card | A decision raised to the owner in Mission Control: a question from a worker, a proof to accept, a stopped run, a checkpoint report. |
| Capability class | A / B / C, strongest first; a session requests a class and gets exactly it or waits ([ADR-0095](09_architecture_decisions/0095-model-table-and-capacity-pool.md)). |
| Tranche / checkpoint report | The Autopilot's release unit (req-179, ADR-0077 later change): up to N runs, a share of the day's budget or a time span, whichever ends first. At its end the runner pauses the Autopilot (Paused, reason checkpoint) and the chain status carries the **checkpoint report** — gate rate, change size, cost per run, repeated tickets; deterministic numbers, no prompt — drawn as a card in Mission Control with *Release next tranche* / *Adjust…*. **Early stop**: an anomaly (a falling gate rate, the same ticket red again, a change or a cost far above the tranche's median) raises the checkpoint before the end. |
| Resource governor | The Crew runner's seat keeper (req-180, milestone 223, ADR-0092 later change): every spawn takes a seat of a class first — `light` for a model run, `heavy` for a gate command, a ci check or a listening dev server — within Settings → Background service's Load group: 1–2 heavy seats at once, a CPU/RAM reserve, quiet hours (no new heavy start), heavy processes at below-normal priority; one dev-server port per worktree (`DREY_DEV_PORT`), test parallelism bounded by environment variables; every wait and refusal is logged with its reason. Shown in the service window's Governor block. |
| Size baseline | `eslint.size-baseline.mjs`: the files under `packages/` that broke the backend OOP rule's limits when it was switched on; the list may only shrink ([ADR-0096](09_architecture_decisions/0096-crew-runner-refactor-state-machine-ports-and-file-size-rule.md)). |
