# ADR-0099 — The worker's trust boundary per harness: the persona's permission mode and network switch, the folders a worker may write, finished worktrees removed

## Status

Accepted — built (milestone 273: req-142 and req-185 Spike 1, owner request
2026-11-14 for finish line step 5). Later change of
[ADR-0075](0075-agent-fleet-architecture-governance-and-run-control.md): its boundary sentence
("the worktree plus the permission mode") is now the table below. The worktree
**location** stays as [ADR-0080](0080-fleet-worktrees-home-and-cleanup.md) decided it
(owner, 2026-11-14: no machine-wide root; `specs/decisions.md`).

## Context

A Crew worker is a harness CLI (Claude Code over stream-json; opencode, Kimi
Code and Copilot CLI over ACP, ADR-0096 later change) started headless in the
ticket's git worktree. Until now three things were weaker than the persona
page suggested:

- **The persona's "Allowed to" was recorded and ignored.** Milestone 231
  wrote `allowed: run-commands: accept-edits | bypass` and `allowed: network:
  true` into the persona record; every harness still started with the crew's
  `permissionMode`, and nothing read `network`.
- **What a worker can reach beyond its worktree was never written down.** The
  concept's Spike 1 asked, per harness, what file system and network a worker
  reaches, and which of it can be fenced.
- **Finished worktrees piled up.** Only the old column board's terminal
  Accept removed a ticket's worktree; a chain ticket merged by You's `commit`
  leaving action (milestone 245) or moved into Done by the engine kept it until
  the owner pressed "Clean up worktrees".

What each harness offers was measured against the installed CLIs' `--help`
(Claude Code 2.1.319, opencode 2.0.32, Kimi 2.5.2) and their documentation;
Copilot CLI is not installed on the owner's machine, so its column rests on
GitHub's CLI reference alone.

| Harness | Confining file access | Switching the network off | An OS sandbox for shell commands | Does bypass lift the fence? |
|---|---|---|---|---|
| Claude Code | `--add-dir` names the folders beside `cwd`; `permissions.blockWritesOutsideWorkingDirectories` (2.1.314+) stops the file tools writing elsewhere; reads are open | `--disallowedTools WebFetch WebSearch`, or deny rules | `sandbox.*` on macOS and Linux/WSL2 only — **none on native Windows** | No: deny rules and the `block…` keys hold in `bypassPermissions` |
| opencode | `permission.external_directory` (the V2 default is allow) | `permission.webfetch`, `permission.websearch` | none | `"*": "allow"` approves the rest; a deny still wins |
| Kimi Code | nothing per run (`--add-dir` only adds folders) | `[tools] disabled` in its own `config.toml`, not per run | none | — |
| Copilot CLI | `cwd` and `--add-dir` by default; `--allow-all-paths` lifts it | every URL waits for approval; `--allow-all-urls` allows them all | `--sandbox` on Windows 11 25H2+ (with the named update), macOS, Linux | No: deny rules hold under `--allow-all` |

## Decision

1. **The persona's `run-commands` is the run's permission mode.** The request
   composer takes `allowed.runCommands` over the crew's `permissionMode`
   (`request-assemble.ts`); a review stays `read-only` whatever either says
   (req-183). A free session takes the session's own choice, then the
   persona's, then the crew's; a 1:1 stays read-only. Each harness maps the
   mode as before: Claude Code `--permission-mode acceptEdits |
   bypassPermissions | plan`, Kimi's session modes `auto | yolo | plan`,
   Copilot's `--allow-all-tools`; opencode had no mode for bypass and now asks
   for `"*": "allow"` in its run config (point 4).
2. **The persona's `network` is a request key.** A persona whose `allowed:`
   lacks `network: true` runs with `network: false` on its request (ticket
   runs, free sessions, 1:1s); a run without a persona and every record from
   before carry no key and stay unrestricted. What it means per harness:
   - Claude Code: `--disallowedTools WebFetch WebSearch` and the same two as
     deny rules in the run's settings — enforced, in bypass too.
   - Copilot CLI: `--allow-all-urls` only while the network is open; without
     it each URL — `web_fetch` or a shell `curl` — waits for the owner's
     approval as a permission request. Enforced as an ask, not as a deny.
   - opencode: `webfetch` and `websearch` denied in the inline config it is
     launched with (`OPENCODE_CONFIG_CONTENT`). **Not proven**: opencode
     2.0.32's `debug config` does not list that source, so the run's stream
     says the rules were asked, not proven.
   - Kimi Code: **cannot** — its web tools are switched in its own
     `config.toml` only; the run's stream says so once.
   - **No harness fences a shell command's network on native Windows.** A
     worker that runs `npm install` or `curl` in its shell reaches the network
     whatever the switch says; the Persona page's hint says "Shell commands
     keep the network".
3. **A writing worker may write its worktree and the folders it needs, and
   nothing else, where the harness can enforce that.** The folders beyond
   `cwd` are the ticket file's folder (a store ticket's working copy in
   `_workcopy/`, else the ticket's folder in the tickets repository) and the
   further repositories' worktrees (req-72) — `fleet/worker-dirs.ts`. The
   runner's own run folder is **not** one of them: it holds the worker's vault
   token. Claude Code gets them as `--add-dir` and a settings file in the run
   folder (`claude-settings.json`, `blockWritesOutsideWorkingDirectories`,
   written as a file because a JSON argument does not survive the Windows
   shell); Copilot CLI gets them as `--add-dir` (it confines to `cwd` itself).
   opencode's `external_directory` is not used — its path patterns could not
   be proven through the unconfirmed config channel, and a wrong pattern would
   stop every run writing its ticket copy. Kimi has no per-run fence. **Reads
   stay open** on every harness: Claude Code reads its own large tool output
   back from the temp folder, and the brief's sources live outside the
   worktree.
4. **Claude Code's OS sandbox is not used.** It does not exist on native
   Windows, Drey's platform; on macOS and Linux it would also fence off the
   repository's `.git` the worker commits into (a worktree's objects and refs
   live there), so it would need the repository among its writable paths — a
   follow-up when Drey runs workers on another platform.
5. **A finished ticket's worktrees are removed.** `FinishedWorktrees`
   (`fleet/orchestrate/finished-worktrees.ts`) removes each checkout of the
   ticket with `git worktree remove` without `--force` (through
   `worktree-clean.ts`'s `removeWorktree`, `link:` junctions first): the
   branch stays, a dirty tree is kept and reported, a folder that is not there
   is nothing to do. Two callers: the commit run's green end (You's `commit`
   leaving action — every outcome is a note on the run) and the engine's Done
   moves (the owner's last Accept on a chain, a chain that is through, Mission
   Control's last entry, the old terminal Accept's archive — a kept tree is
   the owner's warning and a log line). A live run on the ticket keeps them
   all. The review checkout and the commit's scratch checkout already went at
   their own ends; "Clean up worktrees" stays for everything older.
6. **The spawner quotes an argument with a space on Windows.** The worker CLIs
   are npm `.cmd` shims, so the runner spawns through the shell there, and the
   shell joined the argv unquoted; a path with a space (`--add-dir`,
   `--settings`, `--mcp-config`) now goes in double quotes (`procs.ts`
   `shellArg`).

## Consequences

- The Persona page's two switches change what a worker does on the next run;
  nothing to migrate — a record without `run-commands` keeps the crew's mode.
- Every persona of the default crew lacks `network: true`, so its Claude Code
  workers lose WebFetch and WebSearch until the owner turns the switch on for
  the personas that need them; shell commands are unaffected.
- A Copilot worker of a persona with the network off asks the owner for every
  URL instead of fetching it; with the network on it no longer asks at all.
- The boundary on the owner's Windows machine is: Claude Code's file tools
  write only the worktree and the named folders; Copilot CLI confines itself
  to them; opencode and Kimi are fenced by nothing but the worktree as their
  working folder and their own configuration. Any harness's shell command can
  reach the whole disk the OS user can and the network. Real isolation of a
  shell needs an OS boundary (a sandbox user, a container, Copilot's
  Windows sandbox) — not built; it is the open part of the concept's Spike 1.
- Open questions recorded, not acted on: Kimi 2.5.2's CLI flags call "never
  ask" `auto` and "ask when needed" `yolo`; whether its ACP mode ids mean the
  same is unverified, and Drey maps bypass to `yolo`, accept-edits to `auto`.
- Worktrees no longer pile up between cleanups; a dirty finished tree stays
  visible in the warning and in "Clean up worktrees".
