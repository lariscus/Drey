/** Drey Service's command line (req-164): the parse, pure. */
import { homedir } from 'node:os';
import * as path from 'node:path';

export interface CliOptions {
  readonly command: 'run' | 'version' | 'status' | 'stop' | 'autostart';
  readonly vault: string | null;
  readonly home: string;
  readonly autostart: 'on' | 'off' | 'status' | null;
  readonly idleMs: number | null;
}

interface Draft {
  command: CliOptions['command'];
  vault: string | null;
  home: string;
  autostart: CliOptions['autostart'];
  idleMs: number | null;
}

type Apply = (draft: Draft, value: () => string | null) => void;

const FLAGS: Readonly<Record<string, Apply>> = {
  '--version': (d) => (d.command = 'version'),
  '-v': (d) => (d.command = 'version'),
  '--status': (d) => (d.command = 'status'),
  '--stop': (d) => (d.command = 'stop'),
};

const VALUED: Readonly<Record<string, Apply>> = {
  '--autostart': (d, value) => {
    d.command = 'autostart';
    const v = value();
    d.autostart = v === 'on' || v === 'off' ? v : 'status';
  },
  '--vault': (d, value) => (d.vault = value()),
  '--home': (d, value) => (d.home = value() ?? d.home),
  '--idle-ms': (d, value) => {
    const n = Number(value());
    d.idleMs = Number.isFinite(n) && n > 0 ? n : null;
  },
};

export function parseServiceArgs(argv: readonly string[], home = path.join(homedir(), '.drey-engine')): CliOptions {
  const draft: Draft = { command: 'run', vault: null, home, autostart: null, idleMs: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    const value = (): string | null => (arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : (argv[++i] ?? null));
    (FLAGS[arg] ?? VALUED[name])?.(draft, value);
  }
  return {
    command: draft.command,
    vault: draft.vault === null ? null : path.resolve(draft.vault),
    home: path.resolve(draft.home),
    autostart: draft.autostart,
    idleMs: draft.idleMs,
  };
}
