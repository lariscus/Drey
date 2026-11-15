# 0102 — The tickets plugin activates unconfigured; Drey Service starts with the setup

## Status

Accepted — built (D-74, milestone 285; owner request 2026-11-15)

## Context

The tickets plugin failed to activate whenever no registered vault carried a
tickets board: `activate()` awaited `ensureService` first, and the start
refused with "no tickets vault detected — Drey Service has nothing to host".
On a fresh install the plugin showed **failed** in Panels and plugins — no
Work panel, no Tickets settings, and therefore no way to configure a tickets
repository at all. The only setup entry point (the Work panel's empty state
and its Initialize button) sat behind the activation that failed, and the
engine's own fresh path ("Initialize board", E14-9b item 6) was unreachable.

Two facts made a narrower fix possible than a bootstrap rework:

- The engine already hosts a vault **before** its board exists — `detect()`
  probes for `tickets/_meta/pipeline.md` and answers the null snapshot, and
  `initialize` is its designed fresh path (pinned by the board-service
  dricket spec).
- The only gate in front of it was plugin-side: the locator that finds the
  vault the service should host required the board to exist.

The rejected alternative — start Drey Service unconditionally for a fallback
vault (say, the active notes vault) so activation never fails — is recorded
in `specs/decisions.md` (2026-11-15): it runs a background process on every
install, tickets or not (req-164 keeps the service optional), and blurs
ADR-0076's own-repository rule.

## Decision

1. **The unconfigured state is a state, not a failure.** The plugin
   activates without the engine: the `EngineClient` exists unbound, every
   engine-bound IPC call answers the typed `UnconfiguredTicketsError`
   ("No tickets vault is configured yet — set one up in Settings →
   Tickets"), and the `board` fetch returns the unconfigured snapshot the
   engine itself assembles for a hosted vault without a board. The renderer
   already handled that snapshot everywhere (the Work panel's empty state,
   the hidden Autopilot switch, the settings page's "No tickets vault
   detected").
2. **The engine's live wiring is deferred, not duplicated.** Event stream,
   fleet polling, boot sweep and the first config pushes run behind an
   idempotent `wireEngine()` at the first successful start or adoption,
   which also emits one `board-changed` / fleet round so views that fetched
   early re-read. A vault-registry round retries the start while unbound.
   A real start failure is logged, not thrown — a failed plugin has no
   settings to repair itself from; the setup surfaces the error instead.
3. **The setup names the vault, and the service starts for it before its
   board exists.** `ensureService` accepts an explicitly named vault: the
   detector's probe first, the named vault second (still verified as a
   registered, existing vault). Settings → Tickets offers the setup while
   unconfigured — pick a folder (OS dialog, empty → `git init` with the
   configured git, neither empty nor a repository → refused), register it
   as a vault (SDK 1.33), start the service for it, run the engine's fresh
   path (`initialize`: pipeline, repos, the human persona, the store beside
   the vault). The Work panel's Initialize button rides the same seam with
   the active vault.
4. **Drey Service starts when a tickets repository exists** — with the
   setup, at the next start once the board is detected, or when Settings →
   Background service starts it. Never for a fallback vault.

## Consequences

- A fresh install shows the Tickets plugin as **active** with a setup page
  instead of **failed**; Drey Service does not run until the owner sets
  tickets up (req-164's optionality holds).
- The engine-bound IPC surface answers one uniform error while unbound;
  consumers that catch (CrewSettings, the quit guard's run count,
  ServiceControl's status) keep their degraded readings without changes.
- `ensureService` gains a typed refusal (`UnconfiguredTicketsError`) and a
  `startVault` argument; the old free-text throw and its log line are gone
  (docs/11's vault-less e2e note updated).
- The settings page renders its setup block alone until the board exists,
  then the full page — driven by the existing `board-changed` reload.
