import { describe, expect, it } from 'vitest';
import { QuietHours } from './quiet-hours';

const at = (hh: number, mm: number): Date => new Date(2026, 10, 9, hh, mm);

describe('QuietHours', () => {
  it('reads the board format, an en dash or a hyphen', () => {
    expect(QuietHours.parse('22:00 – 07:00')?.until).toBe('07:00');
    expect(QuietHours.parse('12:30-13:45')?.until).toBe('13:45');
  });

  it('is no span for empty, malformed or zero-length text', () => {
    expect(QuietHours.parse('')).toBeNull();
    expect(QuietHours.parse('22:00')).toBeNull();
    expect(QuietHours.parse('25:00 – 07:00')).toBeNull();
    expect(QuietHours.parse('08:00 – 08:00')).toBeNull();
  });

  it('holds inside a span within one day, from inclusive and to exclusive', () => {
    const span = QuietHours.parse('12:00 – 14:00')!;
    expect(span.holds(at(11, 59))).toBe(false);
    expect(span.holds(at(12, 0))).toBe(true);
    expect(span.holds(at(13, 59))).toBe(true);
    expect(span.holds(at(14, 0))).toBe(false);
  });

  it('holds across midnight', () => {
    const span = QuietHours.parse('22:00 – 07:00')!;
    expect(span.holds(at(21, 59))).toBe(false);
    expect(span.holds(at(22, 0))).toBe(true);
    expect(span.holds(at(0, 30))).toBe(true);
    expect(span.holds(at(6, 59))).toBe(true);
    expect(span.holds(at(7, 0))).toBe(false);
  });

  it('counts the minutes left in the span', () => {
    const span = QuietHours.parse('22:00 – 07:00')!;
    expect(span.minutesLeft(at(23, 0))).toBe(8 * 60);
    expect(span.minutesLeft(at(6, 30))).toBe(30);
    expect(span.minutesLeft(at(12, 0))).toBe(0);
  });
});
