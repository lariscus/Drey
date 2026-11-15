# Toolchain — every command

The full command reference behind `CLAUDE.md` § "Toolchain": the raw call per tsconfig, suite and build. Moved out of `CLAUDE.md` unchanged (2026-11-15) so it is read when an area is touched, not in every session.

There is **no global `node`/`npm` on PATH** (neither in PowerShell nor in a
Bash shell). A portable Node lives at `.tools/node/` (gitignored, so the
toolchain is removable by deleting `.tools/`). Never assume a bare `node`,
`npm`, `npx`, `ng`, `tsc` or `vitest` command works.

- PowerShell, per session, from the repo root: `. .\env.ps1`
- Any checkout or worktree, one command: `.\dev.ps1` — bootstraps
  `.tools/` (junction into the source checkout's vendored Node) and
  `node_modules/` (`npm ci`) when missing, then runs `npm run dev`;
  `.\dev.ps1 -Built` runs `npm run app` instead — always a fresh
  production build, then the packaged-style app from `dist/` (no dev
  server, no port 4200, no DevTools); `.\dev.ps1 -Multi` (combinable)
  opts out of the single-instance lock (`DREY_MULTI_INSTANCE=1`, see
  the lock in `electron/main.ts`) so parallel checkouts run side by
  side for checking several agent outputs — they share one userData /
  one set of settings (config/session = last writer wins); the lock
  holder keeps the quick-capture hotkey
- Test runs (`npm run …`; PowerShell after `env.ps1`, Bash with
  `.tools/node` on PATH): `npm run test:plugin -- <id>` runs one
  plugin's specs — the daily loop while working on a plugin; `--watch`
  switches to watch mode, anything else passes through to vitest
  (`-t "name"`), and a path fragment instead of an id scopes outside
  `plugins/` (`shared`, `electron/ipc`). `npm run test:plugins` runs
  the whole out-of-Angular suite, `npm run test:app` the four Angular
  suites once — drey's renderer, then `mission-control`, then `mission-ui`
  (the `@mission-ui` lib's specs), then `markdown-surface` (the
  `@markdown-surface` lib's specs) — `ng test mission-control` can't see
  the libs' specs: the unit-test builder discovers spec files inside the
  project's sourceRoot only, and the libs live outside it. `npm run
  test:all` — lint, the ten typechecks, import cycles,
  all four suites — is the **release gate**: `prepack` runs it before every
  `npm run pack` (skip the gate with `npm run pack --ignore-scripts`).
  `pack:dir` stays the fast unpacked smoke build and runs no gate —
  npm fires no pre-hooks for colon-named scripts anyway; run
  `npm run test:all` yourself there when needed.
- Bash: `export PATH="$PWD/.tools/node:$PATH"`, then invoke tools **by
  script path**, not by bin-shim name:
  - Typecheck (all nine configs — the plugins' build configs
    `plugins/tsconfig.main.json` / `plugins/tsconfig.renderer.json`
    included, since a type error there only showed in the build; and
    `tsconfig.e2e.json`, added by req-94 after a broken e2e spec had
    slipped past every earlier gate):
    `npm run typecheck`; raw, one config
    at a time: `node node_modules/typescript/bin/tsc -p <config>
    --noEmit` with `electron/tsconfig.json` (main + shared),
    `tsconfig.app.json` (renderer), `apps/mission-control/tsconfig.app.json`
    (the mission-control app), `libs/mission-ui/tsconfig.json` (the
    `@mission-ui` lib, sources + specs) or `tsconfig.plugins.json`
    (plugins; `electron/tsconfig.spec.json` has `noEmit` in the config)
  - Unit tests: `npm run test:app` (scope it with
    `npm run test:app -- --include "src/.../x.spec.ts"`); raw, one app at
    a time: `node node_modules/@angular/cli/bin/ng.js test --watch=false`
    (drey), `node node_modules/@angular/cli/bin/ng.js test mission-control --watch=false`
    or `node node_modules/@angular/cli/bin/ng.js test mission-ui --watch=false`
  - Main-process, shared and plugin tests (`electron/**/*.spec.ts`,
    `shared/**/*.spec.ts`, `plugins/**/*.spec.ts`; plain Node,
    `vi.mock('electron')` where needed, `// @vitest-environment jsdom` at
    the top of a spec that needs a DOM):
    `npm run test:plugin -- <id>` for one plugin, `npm run test:plugins`
    for everything (raw:
    `node node_modules/vitest/vitest.mjs run --config vitest.plugins.config.mts plugins/<id>`).
    **A spec sits beside the file it tests** — `src/app/` holds only
    specs of renderer code
  - **Test hygiene** ([docs/testing-flakes.md](../testing-flakes.md)): a component that
  starts background work exposes how to wait for it (`idle()` / `ready`),
  and a spec awaits that before it removes a temp dir — no retry loop around
  `rm`, no clock polling where an event exists. Specs that spawn real
  git/dk/node processes belong to the `processes` vitest project
  (`packages/`, `plugins/git/`; `PROCESS_SPECS` in `vitest.plugins.config.mts`).
  - Lint: `node node_modules/eslint/bin/eslint.js "electron/**/*.ts" "shared/**/*.ts" "src/**/*.ts apps/**/*.ts libs/**/*.ts" "plugins/**/*.ts" "packages/**/*.ts"`
    — module barrels, the dependency rules between `shared/`, `src/`,
    `electron/`, `plugins/`, `apps/` and `libs/` (docs/05, "The dependency rules"; a
    type-only import counts) plus `no-floating-promises` /
    `no-misused-promises` (a promise meant to run on its own is marked
    `void`)
  - Runtime import cycles: `node scripts/check-cycles.mjs` — fails with
    the cycle chain if a runtime edge ever closes a loop again
    (`import type` and type-only clauses don't count; the compilers erase
    them); `apps/` joined the scan roots with the mission-control app,
    `libs/` with the `@mission-ui` lib
  - Production renderer builds: `node node_modules/@angular/cli/bin/ng.js build --configuration production`
    for drey, `node node_modules/@angular/cli/bin/ng.js build mission-control --configuration production`
    (`npm run build:mission-control`) for the served Mission Control app —
    `npm run build` runs renderer, electron, plugins, then mission-control
  - Emit the main process: `node node_modules/typescript/bin/tsc -p electron/tsconfig.json`,
    then `node scripts/bundle-preload.mjs` — the main window is sandboxed
    and only runs the bundled one-file preload (`npm run build:electron`
    does both; tsc's own `preload.js` leaves `window.dreyApi` undefined)
- VS Code tasks and debug configs don't inherit `env.ps1`; `.vscode/` works
  around that three ways (see `docs/11`, "Environment gotchas").
- **`npm run dev` rebuilds and restarts Electron by itself**
  (`scripts/dev-electron.mjs`): a change under `electron/`, `shared/` or
  `plugins/` rebuilds the affected part of `dist-electron/` and asks the
  running app to quit (the ordinary quit, so unsaved tabs prompt first),
  then starts it again; `ng serve` keeps hot-reloading the renderer. A
  failed build restarts nothing. **Every other way of running the app
  still builds once** — `npm run app`, the VS Code debug configs, a
  packed build: there, touching `shared/`, `electron/` or `plugins/**`
  leaves a stale main process that disagrees with the renderer about the
  IPC contract _at runtime_ even though `tsc` is clean (unknown fields
  are silently stripped from IPC payloads). Rebuild and restart; verify
  with `grep <new-symbol> dist-electron/plugins/<id> -r` (and
  `grep <new-field> dist-electron/shared -r` for base IPC).
