/**
 * Quiet hours (req-180, board 8c): `22:00 – 07:00` in local time — no new
 * heavy task starts inside the span; a span may cross midnight. Pure: the
 * caller hands the time.
 */
const SPAN = /^([01]?\d|2[0-3]):([0-5]\d)\s*[–-]\s*([01]?\d|2[0-3]):([0-5]\d)$/;

const MINUTES_PER_DAY = 24 * 60;

export class QuietHours {
  private constructor(
    private readonly fromMin: number,
    private readonly toMin: number,
  ) {}

  /** The span of a stored setting; null for '' or anything malformed (no quiet hours). */
  static parse(text: string): QuietHours | null {
    const match = SPAN.exec(text.trim());
    if (match === null) {
      return null;
    }
    const [, fh, fm, th, tm] = match.map(Number) as [number, number, number, number, number];
    const from = fh * 60 + fm;
    const to = th * 60 + tm;
    return from === to ? null : new QuietHours(from, to);
  }

  /** Whether `at` (local time) falls inside the span: from inclusive, to exclusive. */
  holds(at: Date): boolean {
    const minute = at.getHours() * 60 + at.getMinutes();
    return this.fromMin < this.toMin ? minute >= this.fromMin && minute < this.toMin : minute >= this.fromMin || minute < this.toMin;
  }

  /** The span's end as the log writes it, `07:00`. */
  get until(): string {
    const hours = Math.floor(this.toMin / 60) % 24;
    return `${String(hours).padStart(2, '0')}:${String(this.toMin % 60).padStart(2, '0')}`;
  }

  /** Minutes from `at` until the span ends (0 outside it). */
  minutesLeft(at: Date): number {
    if (!this.holds(at)) {
      return 0;
    }
    const minute = at.getHours() * 60 + at.getMinutes();
    return (this.toMin - minute + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  }
}
