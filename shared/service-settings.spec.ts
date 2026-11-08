import { describe, expect, it } from 'vitest';
import { SERVICE_PREF_DEFAULTS, parseQuietHours, servicePatchOf, servicePrefsOf, wholeNumberIn } from './service-settings';

describe('wholeNumberIn', () => {
  it('takes a whole number or its text, inside the range', () => {
    expect(wholeNumberIn(15, 1, 60)).toBe(15);
    expect(wholeNumberIn(' 15 ', 1, 60)).toBe(15);
    expect(wholeNumberIn('0', 0, 90)).toBe(0);
  });

  it('refuses fractions, ranges, words and empty text', () => {
    expect(wholeNumberIn('1.5', 1, 60)).toBeNull();
    expect(wholeNumberIn(0, 1, 60)).toBeNull();
    expect(wholeNumberIn(61, 1, 60)).toBeNull();
    expect(wholeNumberIn('soon', 1, 60)).toBeNull();
    expect(wholeNumberIn('', 1, 60)).toBeNull();
    expect(wholeNumberIn(null, 1, 60)).toBeNull();
  });
});

describe('parseQuietHours', () => {
  it('normalises the board form, with a hyphen or an en dash', () => {
    expect(parseQuietHours('22:00 – 07:00')).toBe('22:00 – 07:00');
    expect(parseQuietHours('22:00-07:00')).toBe('22:00 – 07:00');
    expect(parseQuietHours('9:30 – 17:05')).toBe('09:30 – 17:05');
  });

  it('keeps an empty span as none and refuses the rest', () => {
    expect(parseQuietHours('')).toBe('');
    expect(parseQuietHours('   ')).toBe('');
    expect(parseQuietHours('22:00')).toBeNull();
    expect(parseQuietHours('25:00 – 07:00')).toBeNull();
    expect(parseQuietHours('22:00 – 22:00')).toBeNull();
    expect(parseQuietHours('22:00 – 07:00 – 08:00')).toBeNull();
    expect(parseQuietHours(7)).toBeNull();
  });
});

describe('servicePrefsOf', () => {
  it('gives the defaults for an empty config: the service off, nothing started with Windows', () => {
    expect(servicePrefsOf(() => undefined)).toEqual(SERVICE_PREF_DEFAULTS);
    expect(SERVICE_PREF_DEFAULTS.enabled).toBe(false);
    expect(SERVICE_PREF_DEFAULTS.idleMinutes).toBe(15);
  });

  it('reads every stored value by its config key', () => {
    const store: Record<string, unknown> = {
      'service.enabled': true,
      'service.autostart': true,
      'service.idleMinutes': 30,
      'service.trayIcon': false,
      'service.load.heavySeats': 1,
      'service.load.reserve': 40,
      'service.load.lowPriority': false,
      'service.load.quietHours': '22:00 – 07:00',
      'service.logLevel': 'detailed',
    };
    expect(servicePrefsOf((key) => store[key])).toEqual({
      enabled: true,
      autostart: true,
      idleMinutes: 30,
      trayIcon: false,
      heavySeats: 1,
      reserve: 40,
      lowPriority: false,
      quietHours: '22:00 – 07:00',
      logLevel: 'detailed',
    });
  });

  it('falls back per field for malformed values, and start with Windows waits for the service', () => {
    const store: Record<string, unknown> = {
      'service.enabled': false,
      'service.autostart': true,
      'service.idleMinutes': -3,
      'service.load.reserve': 'lots',
      'service.load.quietHours': 'whenever',
      'service.logLevel': 'chatty',
    };
    const prefs = servicePrefsOf((key) => store[key]);
    expect(prefs.autostart).toBe(false);
    expect(prefs.idleMinutes).toBe(15);
    expect(prefs.reserve).toBe(25);
    expect(prefs.quietHours).toBe('');
    expect(prefs.logLevel).toBe('normal');
  });
});

describe('servicePatchOf', () => {
  it('keeps the valid fields of a request and drops the rest', () => {
    expect(servicePatchOf({ enabled: true, idleMinutes: '20', reserve: 120, bogus: 1, logLevel: 'quiet', quietHours: '23:00-06:00' })).toEqual({
      enabled: true,
      idleMinutes: 20,
      logLevel: 'quiet',
      quietHours: '23:00 – 06:00',
    });
  });

  it('switching the service off switches start with Windows off with it', () => {
    expect(servicePatchOf({ enabled: false })).toEqual({ enabled: false, autostart: false });
  });

  it('accepts clearing the quiet hours', () => {
    expect(servicePatchOf({ quietHours: '' })).toEqual({ quietHours: '' });
  });

  it('is empty for anything that is not an object', () => {
    expect(servicePatchOf(null)).toEqual({});
    expect(servicePatchOf('enabled')).toEqual({});
  });
});
