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
| Autopilot | The one switch with three states — On (tickets move and start by themselves), Paused (running steps finish, nothing new starts), Off (you start every step); every start is Off ([ADR-0077](09_architecture_decisions/0077-continuous-orchestration.md)). Planned: On releases one **tranche** at a time (req-179). |
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
| Slot | An account a worker runs on (Claude A, Claude B, z.ai, Kimi, Copilot) with a profile (`private | work`), a billing kind and quota windows; a repository is bound to one profile ([ADR-0095](09_architecture_decisions/0095-model-table-and-capacity-pool.md) later change; req-177). |
| Quota window / reliability | A provider's limit over a span (5 h, 7 d, month) with its remaining share and reset time, read from the provider (`measured`), counted from own runs (`estimated`) or `unknown`. |
| Surplus q | Remaining share over remaining time share of a window, minimum over the windows: above about 1.3 a bigger model of the slot is attractive; never a smaller class (req-178). |
| Capability class | A / B / C, strongest first; a session requests a class and gets exactly it or waits ([ADR-0095](09_architecture_decisions/0095-model-table-and-capacity-pool.md)). |
| Tranche / checkpoint report | Planned (req-179): the Autopilot's release unit (N runs, a budget share or a time span); at its end the runner pauses and the Lead reports gate rate, change size, cost per run and repeated tickets. |
| Resource governor | Planned (req-180): seats of a class (`light` model runs, `heavy` tests, builds, dev servers), a CPU/RAM reserve, quiet hours. |
| Size baseline | `eslint.size-baseline.mjs`: the files under `packages/` that broke the backend OOP rule's limits when it was switched on; the list may only shrink ([ADR-0096](09_architecture_decisions/0096-crew-runner-refactor-state-machine-ports-and-file-size-rule.md)). |
