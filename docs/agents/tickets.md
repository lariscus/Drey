# Tickets, the Crew runner and Drey Service — who owns what

The tickets part of the ownership map. Operating guides: [SERVICE.md](../../plugins/tickets/SERVICE.md) (the background process), [FLEET.md](../../plugins/tickets/FLEET.md) (runs, the HTTP surface), [BOARD.md](../../plugins/tickets/BOARD.md) (the owner's checkpoints); the format is `specs/ticket-schema.md`; the backend OOP rule and the file-size limits are in `CLAUDE.md` § "Coding & Style Conventions". Moved out of `CLAUDE.md` unchanged (2026-11-15) so it is read when an area is touched, not in every session.

Plugin (`plugins/tickets/`):

- `tickets/` — the Work panel over a dedicated tickets repository:
  capture → inbox, transitions as one-commit git moves, claims/takeover,
  derived order + sparse pins, the deterministic validator
  (ADR-0075/0076, M83; format spec `specs/ticket-schema.md`); the remote
  gateway + phone client (req-66, ADR-0086); run control and the chain
  orchestrator's Drey-side wiring (ADR-0077/0084, M84/85). The domain,
  the fleet runner and the cross-layer contracts live in
  `packages/tickets-engine` since ADR-0088 — the plugin keeps the
  BoardService wiring, gateway, UI and the Drey seams, reaching the
  engine by relative import

Packages (`packages/<name>/`, npm workspaces — the tickets-engine
extraction, ADR-0088):

- `tickets-engine/` — the tickets domain as a pure package
  (`src/core` ticket parse/patch, board assembly, the one transition
  machine, drift, status log, ledger, git plumbing · `src/fleet` the
  Crew runner (ADR-0096): `run/` the pure run state machine, `orchestrate/`
  the supervisor's and the chain's parts with the one ticket writer
  `RunBookkeeper`, `harness/` the adapter contract, the Claude Code adapter (stream-json)
  and the one ACP adapter serving opencode, Kimi and Copilot CLI (req-182), `store/` the ticket store port, `routing/`
  the slots per account with their quota windows (req-177; the profile
  rule retired by req-290) and the capacity pool — model table, cap, class grant, the
  three ledgers (req-170) — and the routing within the class: filter,
  surplus choice, step up, reserve per window (req-178), and the burn rate over all slots (req-181); configured in the service home's
  `service.json`, `config/` the one resolver of the three configuration
  layers (req-173, R13: machine `service.json` · vault
  `tickets/_meta/crew.md` · the session record; session > vault >
  default, a machine key never overridden), `session/` the session
  record (kind run | 1:1 | shape | free, working directory, state) and
  the free session's directory rule, `api/` the
  HTTP routes and the `GET /events` stream, `ports/` (clock, file
  system, process table and spawner, event sink — the core imports no
  Node built-in), and `runner.ts` the composition root; worktrees,
  telemetry beside them · `src/contracts`
  the cross-layer types and pure helpers · `src/services` since E2a the
  host-agnostic board service behind `EngineHost`/`FleetPort` ·
  `src/service` **Drey Service**, the one shipped background process
  (req-164, ADR-0092): engine, Crew runner (in-process), remote gateway
  and the workers' vault MCP (`service/vault-mcp/`, req-167) as components, `~/.drey-engine/service.lock`, the
  two-level sleep — `plugins/tickets/SERVICE.md`). No
  Drey/Electron/plugin imports (ESLint-enforced); the plugin main tsc
  program compiles it into `dist-electron/packages/tickets-engine/`, and
  `plugins/tickets/shared/` holds thin re-export shims for the renderer
  and phone client. The tickets plugin is Drey Service's client
  (`main/service-lifecycle.ts`: adopt, hand over, or start; never stop).
