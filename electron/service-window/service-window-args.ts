/**
 * The service window process's command line (req-165), as the service
 * builds it (`packages/tickets-engine/src/service/launch.ts`,
 * `windowLaunchCommand`): `--drey-service-window --home <dir>
 * --service-pid <pid> --tray|--open`. Pure.
 */
export interface WindowArgs {
  readonly home: string | null;
  readonly servicePid: number | null;
  /** Keep the tray icon. */
  readonly tray: boolean;
  /** Open (or show) the window. */
  readonly open: boolean;
}

export function parseWindowArgs(argv: readonly string[]): WindowArgs {
  const valueOf = (flag: string): string | null => {
    const at = argv.indexOf(flag);
    return at >= 0 && at + 1 < argv.length ? argv[at + 1]! : null;
  };
  const pid = Number(valueOf('--service-pid'));
  return {
    home: valueOf('--home'),
    servicePid: Number.isInteger(pid) && pid > 0 ? pid : null,
    tray: argv.includes('--tray'),
    open: argv.includes('--open'),
  };
}
