# Drey Service — operations guide

Drey Service is the one background process shipped with Drey (req-164,
milestone 209, [ADR-0092](../../docs/09_architecture_decisions/0092-drey-service-the-shipped-background-process.md)).
It replaced the detached tickets engine and the detached fleet runner. This
file is the tool-neutral guide for the owner at a terminal and for coding
agents; the Crew runner's own routes, run states and diagnosis stay in
[FLEET.md](FLEET.md).

## Optional: background, or with Drey

The owner's ruling (Q3, 2026-11-08): the background service is **optional**,
`service.enabled` in Settings → *Background service*, **off by
default**. The same process runs either way; the setting decides how long it
lives (it is re-read every tick from the engine's config, so a switch applies
at once):

| Mode | `service.enabled` | Lives | Live runs when Drey closes |
|---|---|---|---|
| **with Drey** | off (default) | as long as a Drey is open: 10 s after the last Drey's event stream closed it stops its live runs and leaves (2 min for a Drey that never came); a paired phone does not keep it | Drey asks first: *Stop the runs and quit* / *Keep running (enable the service)* / *Cancel* (a quit guard, SDK 1.53) |
| **background** | on | independently of Drey, until nothing holds it (the two-level sleep below); with `service.autostart` also started at Windows sign-in | they go on; Drey asks nothing |

## Components

| Component | What | State |
|---|---|---|
| **engine** | the tickets engine (ADR-0088): board service, chat, verify, the invoke channel Drey talks to; the one writer of the tickets repository — the runner's closing round and the workers' `memory_write` / `journal_write` reach it in-process over that channel and land as its commits (req-225, req-226) | always `running` while the service runs |
| **runner** | the Crew runner (the fleet runner, ADR-0075), **in the service's own process**; its resource governor (req-180, `FLEET.md` *The resource governor*) seats every spawn within Settings → Background service → *Load* | `sleeping` until something needs it, `running` while awake, `failed` with the reason when it cannot start |
| **gateway** | the remote gateway for phone and iPad (ADR-0086), inside the engine | `running` (address, paired devices), `stopped` (remote access off) or `failed` (why it does not listen) |
| **mcp** | the **vault MCP for the workers** (req-167, [ADR-0094](../../docs/09_architecture_decisions/0094-vault-mcp-served-by-drey-service.md)): the ADR-0071 vault tools without `vault_delete`, Streamable HTTP on a loopback port of its own (`/mcp`), a bearer token per worker carrying its project — it reads the project's vaults and plain folders and writes where the project says Write and the persona has `write-notes` (req-283) — every call audited on the run's stream ([FLEET.md](FLEET.md) *The vault over MCP*); a 1:1's token reads every project's vaults read-only with the three read tools (req-217, req-283), a ticket run's persona also gets `memory_write` / `journal_write` into its own records (req-226; written by the engine, one commit each), and a worker's write is announced to Drey's vault round through the engine's paths channel (req-213). Drey's own MCP server for other programs (Claude Desktop, the stdio bridge) still runs in the Drey process — req-212 moves it | `running` (`127.0.0.1:<port> · <n> workers`) as long as the service runs, `failed` with the reason when it cannot listen; no start / stop / restart — live workers hold its address |

The runner's workers run as the OS user that runs the service: on native
Windows no harness fences a worker's shell commands, so a worker reaches the
disk and the network that user can. What each harness does confine — the
persona's permission mode and network switch, the folders a worker may write,
and a finished ticket's worktrees removed after its merge — is
[ADR-0099](../../docs/09_architecture_decisions/0099-worker-trust-boundary-per-harness.md)
and [FLEET.md](FLEET.md) *The worker's boundary* (milestone 273).

Settings → Background service (milestone 216) shows the components and drives
the runner, the gateway and Drey's MCP server; the tray icon and the service
window (milestone 222, below) show and drive all of it too. A terminal sees
the service through `--status`, its control port and the log files.

## The tray icon and the window (req-165/166, milestone 222)

The service starts a **service window process** — Drey's own binary as
Electron, `Drey.exe --drey-service-window --home ~/.drey-engine
--service-pid <pid> --tray` (a dev checkout: `electron.exe <repo> …`) — while
`service.trayIcon` is Shown (Settings → Background service → *Taskbar icon*;
default Shown), starts it again when it dies (2 s … 60 s; after five crashes it
waits until the icon is switched off and on), and ends it when the service
leaves. *Hide* drops the icon; the process leaves unless its window is open.
`DREY_SERVICE_TRAY=off` in the service's environment starts no tray (the e2e
fixtures set it). The window process is one per home (its single-instance lock
lives in `~/.drey-engine/service-window/`), leaves by itself when its service
is gone, and is only a client: it reads `service.lock` and calls the routes
below, the runner's and the engine's.

- **Tray icon (req-276):** Drey's app icon (`build/icon.png`, packaged
  `resources/icon.png`) with a status dot in its bottom-right corner, where
  Windows puts badges (owner, 2026-11-11); the same dot on the window's
  taskbar button as Windows' overlay icon (`setOverlayIcon`, the tooltip's
  words as its description; Windows places it — top right on Windows 11,
  bottom right on Windows 10; the window icon stays Drey's). The colour, from the lock,
  `GET /status` and the runner's `/chain` each tick (`trayVerdictOf`):
  **grey** stopped — no `service.lock`; **red** problem — a component
  `failed`, or a lock whose control port does not answer; **orange** paused
  — the Autopilot Paused; **green** running — everything else, a sleeping or
  starting runner and a gateway switched off included. The tooltip and the
  menu's first row name the state; a problem's tooltip names its cause.
- **Tray menu:** `Drey Service · <state>`, *Open Drey Service…*, *Open Drey*,
  *Autopilot: On/Paused/Off ›* (the engine's `chainAutopilot`), *Stop all
  running steps…* (asks; the runner's `/chain/abort`), *Start with Windows ✓*
  (`POST /settings {autostart}`), *Quit service* (asks while runs live;
  `POST /shutdown`). A click on the icon opens the window.
- **Window:** *Components* (status line, the five rows with restart / stop /
  start, Slots from the runner's `GET /slots`, the Governor block from the
  runner's `GET /governor` — heavy and light seats, the reserve against the
  load, the waiting tasks, the dev servers (req-180) —, the log following
  `GET /log/stream`),
  *Sessions* (every live run and today's ended ones raw: the run's stream,
  instruction, tool calls, process, raw lines; *Send* = the runner's `/send`,
  logged to the run's stream and the ticket like a steer from Drey; *Interrupt
  turn* `/interrupt`; *Resume after stop* `/resume`; *Copy attach command*
  `GET /attach/<run>`), *Logs* (the log, full height, a component filter).
  Closing the window keeps the service running.
- Settings' *Open Drey Service…* is `POST /window/open`.

## Where everything lives

The service home is `~/.drey-engine` (`%USERPROFILE%\.drey-engine`) — the
engine's home before, unchanged so `config.json`, the fleet root and the
e2e isolation stay where they were (req-173 kept it there).

```
~/.drey-engine/
├── service.lock        discovery: pid, build, control port + token, one record per component
├── service.log         the combined log: `<ISO time> <level> <component> <message>`, capped at 1 MB
├── logs/               one file per component per day (`runner-2026-11-09.log`), kept 14 days (req-165)
├── service-window/     the tray / window process's own userData (its single-instance lock)
├── service-start.log   stdout/stderr of the last start (a start that dies says why here)
├── start-service.vbs   the Windows sign-in launcher (only while start with Windows is on)
├── service.json        the machine layer (req-173): slots, quota, the class list, the model table, the cap, ledgers, routing, governor — schema below
├── discovery.json      req-286: the last check of the harnesses — their rows and every model offered (FLEET.md, "Model discovery")
├── discovery/          req-286: the folder the harness probes start their sessions in
├── config.json         the engine's config (since req-173 no vault key is read from it — those live in the tickets repository's `tickets/_meta/crew.md`; the marker `crew.migrated` records the one-time move; added: `service.enabled`, `service.autostart`, `service.vaultPath`, `service.idleMinutes`; Drey writes every Settings → Background service key here too — `service.trayIcon`, `service.logLevel`, `service.load.*` — and the service applies them each tick; the Load group goes to the in-process runner's resource governor live, req-180)
└── fleet/              the Crew runner's root (FLEET.md): runs/, chains/<vault key>/chain.json (one per tickets vault, req-173), chain-vault.json, runner.log
```

### `service.json` — the machine layer (req-173, R13)

What this computer is, read and written only through `ServiceConfigFile`
(`fleet/routing/service-config-file.ts`; a write keeps the keys it does not
know, a file that does not parse is never overwritten). Its root keys,
each parsed by its owner (`fleet/routing/service-config-schema.ts`):

| Key | Owner | Holds |
|---|---|---|
| `slots` | req-177, `routing/slot-config.ts` | the accounts per provider: id, label, provider, login folder, sessions, cost (`billing`, req-287: subscription, credits or per token) |
| `impliedOff` | D-69, `routing/slot-config.ts` | the providers whose implied slot the owner removed (Settings → Models) |
| `quota` | req-177 | the quota sources (Claude Code, Kimi, z.ai) and their refresh |
| `classes` | req-287, `routing/class-config.ts` | the owner's class list, strongest first, each with at most N sessions at once |
| `models` | req-170, `routing/pool-config.ts` | the model table: model, provider, category, class (a name of `classes`), cost factor, capabilities, the router switch `enabled` |
| `discovery` | req-286, `routing/model-discovery.ts` | `ignored`: the discovered models the owner ignored |
| `capacity` | req-170 | the capacity cap, global and per provider |
| `ledgers` | req-170 | the default ticket allowance, persona day, provider day |
| `routing` | req-178 / req-181 | surplus and step-up thresholds, the reserve, the burn rate |
| `governor` | req-180 | the dev-port range (`devPorts`) |
| `migrations` | req-170, req-287 | the one-time moves done on this machine (`fleet.pool.size`, `classes.v3`) |

The three layers (machine `service.json` · vault `tickets/_meta/crew.md` ·
the session record) and their precedence — session > vault > built-in
default, a machine key never overridden — are in FLEET.md ("The three
configuration layers"). Drey's mirrored device settings (`service.*`,
`remote.*`, `chat.*`, `gitPath`, `dk.*`) still sit in `config.json`;
folding them into `service.json` is req-231.

**Which `dk`** (req-277): the installer ships the pinned dricket release as
`resources/dk/dk.exe`. Drey resolves the path (`main/dk-path.ts`: a configured
`dk.path` wins, else the bundled binary of a packaged build when the file
exists, else empty = `dk` on PATH) and writes the RESULT as `dk.path` into
`config.json` — before it starts the service, at every adoption and with every
board fetch. The service, its runs and the chain read that one key, so they
run the same `dk` as the board; the service never learns about Electron or
the resources folder. The last Drey to start sets it: a service that starts at
Windows sign-in without Drey runs the path the last Drey wrote. The board
carries an issue (`DkHealthProbe`, `store/dk-health.ts`) when that `dk` is
missing or cannot run, is older than the engine's minimum, is older than the
bundled release (a warning), or when `git --version` fails — `dk` calls the
installed git.

### `service.lock`

Written owner-only and atomically, rewritten whenever a component changes:

```json
{
  "version": 1,
  "pid": 12345,
  "build": "2026-11-08T10:00:00.000Z#9f3c…",
  "startedAt": "2026-11-08T10:01:02.000Z",
  "home": "C:\\Users\\me\\.drey-engine",
  "vaultPath": "E:\\notes",
  "port": 51234,
  "token": "<bearer of the control port AND the engine's invoke channel>",
  "mode": "background",
  "components": {
    "engine":  { "state": "running",  "detail": "E:\\notes", "port": 51233 },
    "runner":  { "state": "running",  "detail": "127.0.0.1:51240", "port": 51240, "token": "<runner bearer>", "pid": 12345, "build": "…" },
    "gateway": { "state": "running",  "detail": "http://192.168.1.20:47811 · 2 paired devices", "port": 47811 },
    "mcp":     { "state": "running",  "detail": "127.0.0.1:51236 · 2 workers", "port": 51236 }
  }
}
```

It replaces `engine.lock` (the engine's port + token) and
`fleet/runner.json` (the runner's). A device never sees it: phones reach
the gateway through their pairing, never these tokens.

## Command line

The entry is `dist-electron/packages/tickets-engine/src/service/service-main.js`
(in a packed build inside the app's resources). It is Electron-as-Node:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& "<Drey.exe or node_modules\electron\dist\electron.exe>" "<...>\service-main.js" --status
```

| Command | What |
|---|---|
| `--status` | the components, read from `service.lock` and `/status`; exit code 3 when not running |
| `--version` | the app version and the build stamp |
| `--stop` | asks the service to leave (live runs are stopped first, like the owner's quit) |
| `--autostart on\|off\|status` | start with Windows (opt-in, off by default; `on` also switches the background service on): the per-user `Run` value `DreyService` |
| `--vault <path> [--home <dir>]` | run the service (what Drey does); without `--vault` the last one from `config.json` |

## Control routes

Every route needs `Authorization: Bearer <token>` from `service.lock`.

```powershell
$l = Get-Content "$env:USERPROFILE\.drey-engine\service.lock" -Raw | ConvertFrom-Json
$h = @{ Authorization = "Bearer $($l.token)" }
Invoke-RestMethod "http://127.0.0.1:$($l.port)/status" -Headers $h
```

| Route | What |
|---|---|
| `GET /health` | `{ok, pid, build}` |
| `GET /status` | `{pid, build, startedAt, vaultPath, mode, components, sleep, dreyClients, settings, logFolder, trayRunning}` — `mode` is `background` or `with-drey`; `sleep` (background mode) is `{sleep: true}` or `{sleep: false, reason: "drey" \| "runner" \| "remote gateway"}` |
| `POST /settings` `{enabled?, autostart?}` | writes `service.enabled` / `service.autostart` into the engine's config and applies them at once (what `--autostart` sends to a running service) |
| `GET /log?tail=N&component=<name>` | the log tail, plain text, optionally one component |
| `GET /log/stream` | server-sent events: `event: log` with each new line as a JSON string (the window's log panel) |
| `POST /components/runner/start` | wake the Crew runner |
| `POST /components/runner/stop` | put it to sleep — its live runs are stopped first |
| `POST /components/runner/restart` | stop, then wake |
| `POST /components/gateway/<start\|stop\|restart>` | the remote gateway on / off (the same persisted switch as Settings → Remote access) |
| `POST /components/engine/restart` | the atomic restart of the whole service (below) |
| `POST /components/engine/<start\|stop>`, `POST /components/mcp/*` | 409 with the reason: the engine runs as long as the service (restart it, or quit the service), the vault MCP runs as long as the service (live workers hold its address) |
| `POST /restart` | the atomic restart: the runner hands its runs over, the service starts its successor (the same command) once its lock is gone, and leaves; 409 while a run is in its gate |
| `POST /window/open` | opens the service window (a window process with `--open`; a running tray process takes it over) |
| `POST /shutdown` | leave: live runs stopped, engine closed, lock removed |
| `POST /shutdown` `{handover: true}` | what a newer Drey build sends: the runner hands its live runs over (req-51 — workers keep running, the successor takes them back); 409 while a run is in its gate, and the service serves on |

The engine's invoke channel (`/api/invoke`, `/api/events`, `/api/health` on
`components.engine.port`) and the runner's routes (`components.runner.port`,
its own token — FLEET.md) are unchanged.
The persona pictures (req-292) ride both of the engine's channels: the invoke
method `personaAvatar` (Drey's desktop circles) and the remote gateway's
`GET /api/personas/<id>/avatar` (Mission Control, the phone) answer
`{ok: true, dataUrl}`, the gateway a 404 without a picture; the persona list
says which persona has one (`avatarVersion`). FLEET.md, "The default crew".

## Lifecycle

**Start.** The tickets plugin's main process (`plugins/tickets/main/service-lifecycle.ts`,
`ensureService`) reads `service.lock`. A live service of the same or a newer
build is adopted. An **older** build is asked for the handover; if it
refuses (a run in its gate) Drey keeps using it and the next Drey start asks
again. Otherwise — or with no service — Drey starts one through the single
launch seam (`service/launch.ts`) and waits (up to 60 s) for `service.lock`
with the engine running. A boot claim (`service.starting`) keeps two Dreys
starting at once from starting two services. Drey never stops the service.

**First start after the update (migration).** A tickets engine from before
the service (`engine.lock`) is ended by pid after its own health check
answered with its own token; a fleet runner from before (`fleet/runner.json`)
is asked for the handover. Both lock files are removed. A runner that
refuses (a run in its gate) keeps its runs; the Crew runner component stays
blocked (row `failed`, the reason named) and the service asks again every
tick until the old runner has gone. Handed-over runs wake the runner at
boot so they are taken back at once. Nothing else changes shape: `config.json`
and `fleet/runs/` are read where they are.

**The vault keys move into the tickets repository (req-173, once).** The
first board read of a tickets vault moves the vault keys of `config.json`
(`defaultWorker`, `autoPermissionMode`, `personas.default`, `fleet.cap.*`,
`fleet.compactAboveTokens*`, `fleet.resumePauseTtlMin`,
`fleet.contextCapTokens*`, `autopilot.tranche.*`, `autopilot.earlyStop.*`)
and of the old `chain.json`'s `config` into `tickets/_meta/crew.md` — only
keys the file lacks, only values that differ from the defaults, one commit,
one log line per key — and sets `crew.migrated` in `config.json`. The old
keys are left in place and read by nothing. The runner's first boot moves
the machine-wide `fleet/chain.json` into its vault's
`fleet/chains/<vault key>/chain.json` and keeps the original as
`fleet/chain.legacy.json`.

**With Drey (the service off).** The service follows Drey: when no Drey has
held the event stream for 10 s it stops its live runs (the runner's graceful
stop) and leaves — also after a Drey crash. Drey's quit guard asked the owner
before a deliberate close; *Keep running* switches the service on, and it
stays.

**Sleep, in two levels (the service on).**

1. *The Crew runner* sleeps on req-110's verdict (`fleet/runner-lifecycle.ts`):
   a live run or an On/Paused Autopilot keeps it; otherwise it goes when the
   Autopilot is switched Off, when Drey has gone (`/retire-if-idle`, sent once
   the last Drey's event stream has been closed for 5 s), or after 15 min
   without a write. The next write that needs it — a run start, a message to
   a run (req-154), the Autopilot switch (D-51) — wakes it in the same
   process. Nothing is spawned.
2. *The service* leaves only when nothing holds it — no Drey on the event
   stream (`DreyPresence`), the runner asleep, and **no enabled remote gateway
   with a paired device** (a phone cannot wake a service that is gone) — and
   that has lasted the idle span: `service.idleMinutes` in `config.json`,
   15 by default. Then it closes the engine, removes the lock and exits.

The boot rule of ADR-0077 stands: every runner wake starts with the
Autopilot Off, except a handover, which keeps the master as it stood.

**Start with Windows** is opt-in and belongs to the background mode: on
while `service.enabled` and `service.autostart` are both on (Settings →
Tickets, or `--autostart on`). The service applies it whenever that changes:
it writes `start-service.vbs` into its home — `wscript` sets
`ELECTRON_RUN_AS_NODE` and starts the entry with no window — and the per-user
`Run` value `DreyService` naming it. Off removes the value only when it names
this home's launcher, so a test home never touches the owner's entry. A
sign-in start with no paired device and no Drey leaves after the idle span.

**Process mode.** Node under Electron's binary, not a headless Electron: the
optional service needs no Chromium for either mode, and Node mode keeps the
~50–80 MB out (ADR-0092, "As built"). Only `service/launch.ts` builds the
command.

## Diagnosing

- **Drey says the service did not come up** → `service-start.log` (the
  crash of the start), then `service.log`.
- **Is it running, and why not asleep?** → `--status`: the `held by` line.
- **The Autopilot will not switch on** → the runner row: `failed` names the
  cause (D-51), e.g. a file where `fleet/` should be, or an older runner
  still in its gate.
- **Two checkouts on one machine** share one service: the newer build serves
  both; an older Drey adopts it without asking it to leave.
- **A pre-service Drey still running** (an old build in another checkout)
  starts its own old engine again when it finds `engine.lock` gone — close it.

## Pointers

Code: `packages/tickets-engine/src/service/` (`service-host.ts`,
`control/` (the route groups), `service-log.ts` + `daily-log-files.ts`,
`window-processes.ts`, `service-stay.ts`, `runner-component.ts`, `sleep.ts`,
`service-lock.ts`, `legacy.ts`, `launch.ts`, `service-main.ts`); the tray and
window `electron/service-window/` + `apps/service-window/`; the client `plugins/tickets/main/service-lifecycle.ts`;
the Drey-gone signal `packages/tickets-engine/src/server/drey-presence.ts`.
Docs: ADR-0092, ADR-0099 (the workers' boundary), docs/05 §5.0, docs/06 "Drey Service: start, adopt, hand over",
docs/07 (the packaged layout).
