/**
 * Drey Service's entry (req-164, ADR-0092): the one background process
 * shipped with Drey. Started by the Drey plugin when no service is running
 * (`launch.ts`), at Windows log-in when the owner switched that on, by its
 * own atomic restart, or by hand:
 *
 *   service-main.js [--vault <tickets vault>] [--home <dir>]   run the service
 *   service-main.js --version                                   the version and build stamp
 *   service-main.js --status                                    the components, from service.lock + /status
 *   service-main.js --stop                                      ask a running service to leave
 *   service-main.js --autostart on|off|status                   start with Windows (opt-in; on also enables the service)
 *
 * The home is `~/.drey-engine` (the integrator's ruling of 2026-11-08).
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fleetBuildStamp } from '../fleet/build-stamp';
import { parseServiceArgs, type CliOptions } from './service-args';
import { runService } from './service-boot';
import { autostartCommand, statusCommand, stopCommand } from './service-commands';

export { parseServiceArgs, type CliOptions } from './service-args';
export { formatStatus } from './service-commands';
export { SERVICE_IDLE_KEY, SERVICE_VAULT_KEY } from './service-boot';

/** The repository / app root: the entry sits at `<root>/dist-electron/packages/tickets-engine/src/service/`. */
const APP_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

function appVersion(): string {
  try {
    return (JSON.parse(readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function run(opts: CliOptions): Promise<number> {
  const out = (line: string): void => console.log(line);
  const build = await fleetBuildStamp(__filename).catch(() => 'unknown');
  switch (opts.command) {
    case 'version':
      out(`Drey Service ${appVersion()} (build ${build})`);
      return 0;
    case 'status':
      return statusCommand(opts, out);
    case 'stop':
      return stopCommand(opts, out);
    case 'autostart':
      return autostartCommand(opts, __filename, out);
    case 'run':
      return runService(opts, { entry: __filename, appRoot: APP_ROOT, build }, out);
  }
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  run(parseServiceArgs(process.argv.slice(2))).then(
    (code) => {
      if (code >= 0) {
        process.exit(code);
      }
      // -1: the service runs; its listeners keep the process alive.
    },
    (error: unknown) => {
      console.error(`Drey Service failed to start: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
