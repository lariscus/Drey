/**
 * The Electron entry (`package.json` `main`): one binary, two programs.
 *
 * `--drey-service-window` starts the **service window process**
 * (req-165, ADR-0092 later change 2026-11-09): Drey Service's tray icon and
 * its window, spawned by the service. Everything else is Drey itself. The
 * branch sits before Drey's module graph is loaded, so the tray process
 * costs only the few modules it needs — the owner watches the service's
 * memory.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
if (process.argv.includes('--drey-service-window')) {
  require('./service-window/service-window-main');
} else {
  require('./main');
}
