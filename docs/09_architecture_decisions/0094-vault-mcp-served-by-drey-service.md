# 0094 — The vault MCP for workers is served by Drey Service, with per-run tokens and persona permissions

## Status

Accepted — built as milestone 227 (req-167, 2026-11-09). Proposed in the
design session 2026-11-07/08 (owner rulings R5 and R7 in
`docs/design/work-panel/crew-internals-concept.md`). A later change of
ADR-0071 (one vault toolset) and ADR-0075 ("vault access for a worker goes
through Drey's governed MCP server" — promised, never wired). Gives req-142
its enforcement. What was built differently is under *As built* below.

## Context

No worker is given an MCP server today. Drey's MCP server lives in the Drey
process and dies with it; the runner and the engine survive Drey on purpose
(ADR-0075, ADR-0088), and the engine already reads and writes the vault
directly for the phones (Notes API, req-100) with ADR-0060's mtime guard but
without save hooks or the local history. A run that depends on Drey being
open would be a run that fails when the owner closes the laptop lid.

## Decision

**Drey Service (ADR-0092) serves the vault MCP** that runs and 1:1 sessions
use. Same tool names and semantics as ADR-0071 — `vault_list`,
`vault_search`, `vault_read`, `vault_edit`, `vault_write`, `vault_move` —
built on the shared pure code (`shared/text-edit`, `shared/note-search`,
`shared/frontmatter`), the path the Notes API already walks; this is the one
toolset, hosted in the service instead of the Drey process, not a plugin-owned
twin. `vault_delete` is not offered to workers.

**Rights (R5).** Without an entry in the persona record a run **reads every
registered vault and writes none**. `persona.md` grants writing per vault
(`allowed:`; req-142's block also covers commands = the harness permission
mode, network, spending above the allowance). No confirmation dialog: a
detached run cannot wait for a click; a refused write returns `Error: <who>
may not write vault "<id>" (allowed: read)` to the model (ADR-0071's
convention) and is logged. The tickets repository is reached by no vault
tool.

**Authentication.** The service mints a **token per run (or 1:1 session)** at
spawn and hands it to the worker in its MCP configuration — claude-code
`--mcp-config`, opencode its config file in the worktree, Kimi by its
capability; a harness without MCP gets no vault and the run log says so (a
capability of the adapter, like the steer ladder). Token → run → persona →
permissions. Every call is appended to the run's stream and visible in the
service's Sessions area (the audit of ADR-0075). The token ends with the
run. The device tokens of the remote gateway (milestone 204) stay the
phones' and never reach a worker.

**What a write does not do.** It does not pass through an open Drey tab
(milestone 78's `OpenDocsBridge`) and leaves no entry in the local history.
ADR-0060's mtime guard refuses a stale write; Drey's vault round reloads
clean tabs and marks dirty ones "Changed on disk". If this bites in practice,
the service may route a write to Drey while Drey is up (the proxy variant the
owner saw and did not choose now).

## Consequences

- A run has the vault whether Drey is open or not; so does a 1:1.
- Programs on the machine (Claude Desktop, the stdio bridge) connect to the
  service as well; `mcp.enabled` / `mcp.yolo` keep their meaning for them,
  while a worker's rights come from its persona, never from `mcp.yolo`.
- The per-run token is a second token kind beside the device tokens; both
  are hashes at rest in the service record.
- ADR-0071's rule "a new vault capability goes into this set" stands; the
  set moves house.
- Open: the exact 1:1 read set; whether `vault_move` is a write right or
  its own right.

## As built (milestone 227, req-167, 2026-11-09)

**The set moved house, it was not copied.** `electron/mcp/tools/` and
`VaultTools` moved into `shared/vault-tools/` over the `ToolVault` port
(ADR-0071 later change); the link rewriter (ADR-0059) moved to
`shared/link-rewriter.ts` over a `RenameVault` port, the cancellation helpers
to `shared/abort.ts`, the loopback guard to `shared/loopback-request.ts`.
Drey's main process builds the set over `VaultManager` exactly as before; the
service builds it over `DiskToolVault` (`service/vault-mcp/`), the registered
vaults on disk behind a `VaultDisk` port, with the Notes API's atomic write and
served-path guard (`services/atomic-note-write.ts`, `services/served-files.ts`,
split out of `notes-service.ts`). The dependency rules allowed it as it stood:
`packages/` imports `shared/` (ESLint: "its own folder and the repo's
`shared/`"), so nothing had to move the other way.

**Two new call options in the shared set**, never set by Drey's callers:
`grant` (`{ who, vaults }` — a change to any other vault is refused with
`Error: <who> may not write vault "<id>" (allowed: read)`, whatever the write
rule) and `exclude` (tools neither listed nor callable: the service leaves out
`vault_delete` and `tasks_list`).

**The component.** `mcp` in `service.lock` is `running` with
`127.0.0.1:<port> · <n> workers`: Streamable HTTP over the official SDK on a
loopback port of its own, path `/mcp`, stateless, JSON answers, the loopback
guard; it runs as long as the service runs (start / stop / restart refuse:
live workers hold its address). It is the Crew runner's `WorkerVaultGate`
(`fleet/orchestrate/worker-vault.ts`): the one spawn path
(`ProcessSupervisor.spawn`) opens it before each worker and closes it when the
worker exits.

**Tokens** (`RunTokens`): 32 random bytes per **worker** (a run's respawn gets
a fresh one), SHA-256 kept in memory beside the run, persona, ticket and
read-only flag; revoked at the worker's exit, when Claude Code's config file
is removed too. *Deviation:* the hashes are not written to a service record
on disk — no worker outlives its service since req-182 (every harness is a
stdio child of the runner), so nothing would read them back. An unknown token
is a 401 before any tool runs.

**Rights.** `persona.md` `allowed: write-vaults: [<vault id>, …]` (req-142's
vault right) is read through the board's `listPersonas` at every call. No
persona, no entry, an unknown persona or an unreadable board: writes nothing.
A **read-only run** (a review, req-183) writes nothing whatever its persona
may. **`vault_move` is a write right** (it rewrites other notes' links) —
ADR-0094's open point, decided. The other `allowed:` permissions req-142 names
(commands, network) stay with the permission mode and req-171's page.

**ADR-0060 for a worker** (`StaleWriteGuard`, per token): a file the worker
read with `vault_read` and that changed on disk since is not overwritten or
edited — `Error: <path> changed on disk since you read it — … Read it again`;
its own writes move the mark. A file it never read is guarded by the edit's
exact-match rule and a create's "must not exist".

**Which vaults.** Drey keeps the engine config key `vaults.registered`
(`contracts/vaults.ts`) on its registry (the tickets plugin, with every board
fetch, only when it changed); the service re-reads it at every call and keeps
the last list with Drey closed. Without it, the vault the service was started
for. Every path passes `core/note-path.ts`: no `tickets/`, no `chats/`, no
dot-folder, links resolved — so the tickets repository is reached by no vault
tool.

**Harness configuration** — the optional adapter capability
`mcpLaunch(server): WorkerMcpLaunch` (`fleet/harness/contract.ts`; files,
arguments, ACP servers — a description, no IO):

| Harness | How it takes the vault MCP | Proven |
|---|---|---|
| Claude Code 2.1.319 | `<run folder>/mcp.json` (owner-only, the bearer in a header) named by `--mcp-config`, tools allowed by `--allowedTools mcp__drey` | fakes + live (connects with its token before any prompt) |
| opencode 2.0.32 | ACP `session/new` / `session/resume` `mcpServers` (HTTP, `Authorization` header) — `initialize` advertises `mcpCapabilities.http: true` | fakes + live |
| Kimi 2.5.2 | the same (`mcpCapabilities.http: true, sse: true`) | fakes + live |
| Copilot CLI | the same, by its documented ACP server | fakes only (not installed — req-208) |

*Deviation:* opencode takes it over ACP, not a config file in the worktree —
measured on 2.0.32, and it keeps the token out of a git worktree. An ACP agent
whose `initialize` advertises no HTTP MCP opens its session without it and the
run's stream says so once; a harness without `mcpLaunch` likewise (the gate
writes the line).

**Audit.** Every call is one `tool` event on the run's stream with
`detail: 'audit'`, `tool: mcp__drey__<tool>`, the text
`vault › <tool> <vault>:<path>[ → Error: …] · <ms> ms` and the
`audit` field (`persona`, `vault`, `path`, `verdict` allowed / refused /
failed, `ms`) — the service window's Sessions tab and Mission Control show it
as a tool line; a refusal also goes to the service log (`mcp`).

**Not built here** (roadmap follow-ups): Drey's own server for other
programs stays in the Drey process (req-212); the
`tags` filter of `vault_search` has no section index in the service
(req-214); a worker's write leaves no local history entry (req-215, the price
this ADR states); a model-driven tool call on every harness end to end
(req-216). The 1:1 session's token is req-168's: it opens the same gate.

**Later change (milestone 234, req-213 and req-217).** A worker's write is
now **announced**: `Engine.emitPaths` (the hub's paths channel a phone's
note save already uses) was exposed when `server/engine.ts` was split, and
the service host wires `VaultMcpCalls`' `changed` to it — every successful
`vault_write`, `vault_edit` and `vault_move` reports the vault's folder
with the paths that changed or went away (a move: the new path changed, the
old deleted; one report per vault and call, `ChangeCollector`), so Drey's
vault round reloads clean open tabs and refreshes the tag index at once,
watcher on or off. With Drey closed nobody listens; its next start reads
the files as they are. The local history price (req-215) stands. A **1:1's
token** is read-only in the grant and carries a tool cut
(`VaultGrant.tools`: `vault_list`, `vault_search`, `vault_read`); the
spawn path sets it for `kind: '1:1'` only, a free session keeps its
persona's rights.

**Later change (milestone 265, req-283): the rights are the project's.**
The owner's round of 2026-11-13 (concept `project-handling-draft.md` §2,
§3, §10) moved *which* vaults a worker reaches from the persona to the
project; R5's "reads every registered vault" no longer holds.

- **The token carries the project.** `VaultGrantRequest.scope` (and the
  token's `VaultGrant.scope`) is `{ kind: 'project', project }` for a
  ticket run — the ticket's project (`ticketProject`, carried as
  `RunRequest.projectId` by `composeRunRequest`) — and for a free session
  — the one picked (`FreeSessionAsk.project`) or the one project naming a
  repository whose checkout holds its folder (`SessionProjectRule`; none
  or several = no project) — and `{ kind: 'every-project' }` for a 1:1.
  The spawn path (`ProcessSupervisor.openVault`) sets it.
- **Read** = the project's vaults marked `read` or `write`, matched by the
  vault's registered **name** in `vaults.registered` (ids are per device),
  plus its plain `folders` (absolute paths), served read-only as vaults of
  their own (`folder-<last segment>`, never with a colon so `id:path`
  labels still parse) under the same path rule (`core/note-path.ts`: no
  `tickets/`, `chats/` or dot-folder, `.git` included; links resolved
  inside the folder). A vault outside the reach does not exist for the
  call: the shared set's own refusal, `Error: vault "<id>" is not
  available to this call. Pass one of: …`; `vault_list` lists only the
  reach. A 1:1 reads the union of every project's vaults and folders; a
  registered vault no project names is read by no worker.
- **Write** = the project says `write` **∧** the persona has `allowed:
  write-notes` **∧** the run is not read-only (a review, a 1:1). The
  alternative weighed in the concept — write on the project alone — would
  give a reviewer or tester write rights the moment a project grants any
  (`specs/decisions.md`, 2026-11-13). A plain folder is never written. The
  refusal wording (`Error: <who> may not write vault "<id>" (allowed:
  read)`) and the audit line are unchanged; an out-of-reach vault is now
  audited as `refused` too and logged.
- **Fail closed.** No project, an unknown project or an unreadable board
  gives no vault (`Error: no vault is available to this call.`) — never
  every vault, as R5's default once was. The records and the personas are
  read through the engine at every call (`projectRecords`, a new board
  invoke method, and `listPersonas`), so an edit applies to the next call.
- **`write-vaults` retired.** `PersonaRights` is gone (`ProjectRights` +
  the pure `project-reach.ts`). `allowed: write-vaults` grants nothing; it
  is parsed only for the first project's migration (req-282), never
  written back, and the engine's start drops it from every persona file
  once a project exists (`ProjectMigrator`, one commit). The Persona page's
  vault picker became the switch *Change notes where the project allows*.
