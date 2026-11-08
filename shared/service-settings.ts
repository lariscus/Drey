/**
 * The settings of Drey Service (req-165, board 8c) and the status the
 * Settings page draws from: pure types and parsing, shared by the tickets
 * plugin's main side (which stores the values and reads the service's lock)
 * and the renderer's Settings → Background service page.
 *
 * Every value is a key of the tickets plugin config (and the engine's
 * config, where the service reads it): `service.enabled`, `service.autostart`,
 * `service.idleMinutes` exist since req-164; the rest are stored for the
 * features that read them later (the tray icon: req-165's tray, the load
 * group: req-180's governor, the log level: req-165's log work).
 */

export type ServiceLogLevel = 'quiet' | 'normal' | 'detailed';

export const SERVICE_LOG_LEVELS: readonly ServiceLogLevel[] = ['quiet', 'normal', 'detailed'];

export interface ServicePrefs {
  /** `service.enabled`: the service outlives Drey. */
  readonly enabled: boolean;
  /** `service.autostart`: starts with Windows (only meaningful while `enabled`). */
  readonly autostart: boolean;
  /** `service.idleMinutes`: how long nothing holds the service before it leaves. */
  readonly idleMinutes: number;
  /** `service.trayIcon`: the taskbar icon is shown. */
  readonly trayIcon: boolean;
  /** `service.load.heavySeats`: heavy tasks at once. */
  readonly heavySeats: number;
  /** `service.load.reserve`: percent of CPU and memory kept free. */
  readonly reserve: number;
  /** `service.load.lowPriority`: heavy tasks run behind everything else. */
  readonly lowPriority: boolean;
  /** `service.load.quietHours`: `22:00 – 07:00`, or empty for none. */
  readonly quietHours: string;
  /** `service.logLevel`. */
  readonly logLevel: ServiceLogLevel;
}

export const SERVICE_PREF_DEFAULTS: ServicePrefs = {
  enabled: false,
  autostart: false,
  idleMinutes: 15,
  trayIcon: true,
  heavySeats: 2,
  reserve: 25,
  lowPriority: true,
  quietHours: '',
  logLevel: 'normal',
};

/** The config key of every preference. */
export const SERVICE_PREF_KEYS: Readonly<Record<keyof ServicePrefs, string>> = {
  enabled: 'service.enabled',
  autostart: 'service.autostart',
  idleMinutes: 'service.idleMinutes',
  trayIcon: 'service.trayIcon',
  heavySeats: 'service.load.heavySeats',
  reserve: 'service.load.reserve',
  lowPriority: 'service.load.lowPriority',
  quietHours: 'service.load.quietHours',
  logLevel: 'service.logLevel',
};

export const IDLE_MINUTES_MAX = 24 * 60;
export const HEAVY_SEATS_MAX = 16;
export const RESERVE_MAX = 90;

/** A whole number in `[min, max]`, or null (not a number, a fraction, out of range). */
export function wholeNumberIn(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * A quiet-hours span as the board writes it, `22:00 – 07:00` (a hyphen or
 * an en dash between the times is accepted, hours may omit the leading
 * zero). The empty string means no span. Anything else is null.
 */
export function parseQuietHours(text: unknown): string | null {
  if (typeof text !== 'string') {
    return null;
  }
  const trimmed = text.trim();
  if (trimmed === '') {
    return '';
  }
  const parts = trimmed.split(/\s*[–-]\s*/);
  if (parts.length !== 2) {
    return null;
  }
  const times = parts.map((part) => CLOCK.exec(part.trim()));
  if (times.some((m) => m === null)) {
    return null;
  }
  const clock = (m: RegExpExecArray): string => `${m[1].padStart(2, '0')}:${m[2]}`;
  const [from, to] = times as [RegExpExecArray, RegExpExecArray];
  return clock(from) === clock(to) ? null : `${clock(from)} – ${clock(to)}`;
}

/** The preferences out of a key reader (the plugin config), every missing or malformed value its default. */
export function servicePrefsOf(read: (key: string) => unknown): ServicePrefs {
  const bool = (key: keyof ServicePrefs): boolean => {
    const value = read(SERVICE_PREF_KEYS[key]);
    return typeof value === 'boolean' ? value : (SERVICE_PREF_DEFAULTS[key] as boolean);
  };
  const quiet = parseQuietHours(read(SERVICE_PREF_KEYS.quietHours));
  const level = read(SERVICE_PREF_KEYS.logLevel);
  const enabled = bool('enabled');
  return {
    enabled,
    autostart: enabled && bool('autostart'),
    idleMinutes: wholeNumberIn(read(SERVICE_PREF_KEYS.idleMinutes), 1, IDLE_MINUTES_MAX) ?? SERVICE_PREF_DEFAULTS.idleMinutes,
    trayIcon: bool('trayIcon'),
    heavySeats: wholeNumberIn(read(SERVICE_PREF_KEYS.heavySeats), 1, HEAVY_SEATS_MAX) ?? SERVICE_PREF_DEFAULTS.heavySeats,
    reserve: wholeNumberIn(read(SERVICE_PREF_KEYS.reserve), 0, RESERVE_MAX) ?? SERVICE_PREF_DEFAULTS.reserve,
    lowPriority: bool('lowPriority'),
    quietHours: quiet ?? SERVICE_PREF_DEFAULTS.quietHours,
    logLevel: SERVICE_LOG_LEVELS.includes(level as ServiceLogLevel) ? (level as ServiceLogLevel) : SERVICE_PREF_DEFAULTS.logLevel,
  };
}

/**
 * A change request from the page, validated field by field: only known
 * fields with a valid value survive, anything else is dropped (the page
 * repaints from the stored values). Switching the service off also
 * switches start with Windows off, as the service itself reads it.
 */
export function servicePatchOf(raw: unknown): Partial<ServicePrefs> {
  const p = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: { -readonly [K in keyof ServicePrefs]?: ServicePrefs[K] } = {};
  for (const key of ['enabled', 'autostart', 'trayIcon', 'lowPriority'] as const) {
    if (typeof p[key] === 'boolean') {
      out[key] = p[key];
    }
  }
  const idle = wholeNumberIn(p['idleMinutes'], 1, IDLE_MINUTES_MAX);
  if (idle !== null) {
    out.idleMinutes = idle;
  }
  const seats = wholeNumberIn(p['heavySeats'], 1, HEAVY_SEATS_MAX);
  if (seats !== null) {
    out.heavySeats = seats;
  }
  const reserve = wholeNumberIn(p['reserve'], 0, RESERVE_MAX);
  if (reserve !== null) {
    out.reserve = reserve;
  }
  const quiet = 'quietHours' in p ? parseQuietHours(p['quietHours']) : null;
  if (quiet !== null) {
    out.quietHours = quiet;
  }
  if (SERVICE_LOG_LEVELS.includes(p['logLevel'] as ServiceLogLevel)) {
    out.logLevel = p['logLevel'] as ServiceLogLevel;
  }
  if (out.enabled === false) {
    out.autostart = false;
  }
  return out;
}

/** The components of Drey Service in the order the page lists them. */
export const SERVICE_COMPONENT_IDS = ['engine', 'runner', 'mcp', 'gateway'] as const;
export type ServiceComponentId = (typeof SERVICE_COMPONENT_IDS)[number];

/** A component as the service's lock records it. */
export type ServiceComponentState = 'starting' | 'running' | 'sleeping' | 'stopped' | 'failed' | 'external';

/** What `serviceStatus` answers: the live service's lock, or `running: false`. */
export interface ServiceStatusReply {
  readonly running: boolean;
  /** The service home (`~/.drey-engine`): where `service.log` lives. */
  readonly home: string;
  /** ISO time the service process started; null while it is not running. */
  readonly startedAt: string | null;
  /** The runs a quit would end (starting, running, stopping). */
  readonly liveRuns: number;
  /** The remote gateway: enabled in Settings → Remote access, listening, and the paired devices. */
  readonly gateway: { readonly enabled: boolean; readonly listening: boolean; readonly devices: number; readonly failed: boolean };
  /** The state of the engine and the runner, from the lock. */
  readonly components: Readonly<Record<'engine' | 'runner', ServiceComponentState>>;
}

export const SERVICE_STOPPED: ServiceStatusReply = {
  running: false,
  home: '',
  startedAt: null,
  liveRuns: 0,
  gateway: { enabled: false, listening: false, devices: 0, failed: false },
  components: { engine: 'stopped', runner: 'stopped' },
};

/** A component action the page can ask for. */
export type ServiceAction = 'restart' | 'stop' | 'start';

/** Where a control call goes: the whole service, or the Crew runner inside it. */
export type ServiceControlTarget = 'service' | 'runner';

export interface ServiceControlRequest {
  readonly target: ServiceControlTarget;
  readonly action: ServiceAction;
}
