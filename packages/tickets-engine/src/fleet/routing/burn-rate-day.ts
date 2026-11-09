/** Where the day's book is kept (production: `burn-rate.json` in the service home); a spec passes its own. */
export interface BurnRateDayFile {
  /** The stored JSON, or null when there is none (or it does not parse). */
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
}

/** One slot's weekly window as the day has seen it: the last remaining share, what dropped since the day began, the window's reset. */
export interface SlotDayEntry {
  readonly last: number;
  readonly spent: number;
  readonly resetsAt: string | null;
}

interface DayRecord {
  readonly day: string;
  readonly lifted: boolean;
  readonly slots: Readonly<Record<string, SlotDayEntry>>;
}

const EMPTY: DayRecord = { day: '', lifted: false, slots: {} };

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : null);
const share = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

function entryOf(value: unknown): SlotDayEntry | null {
  const raw = rec(value);
  const last = share(raw?.['last']);
  const spent = share(raw?.['spent']);
  const resetsAt = raw?.['resetsAt'];
  return raw === null || last === null || spent === null ? null : { last, spent, resetsAt: typeof resetsAt === 'string' ? resetsAt : null };
}

/** The stored book, tolerant: a broken file is an empty day, a broken slot entry is dropped. */
function recordOf(value: unknown): DayRecord {
  const raw = rec(value);
  if (raw === null || typeof raw['day'] !== 'string') {
    return EMPTY;
  }
  const slots: Record<string, SlotDayEntry> = {};
  for (const [id, entry] of Object.entries(rec(raw['slots']) ?? {})) {
    const parsed = entryOf(entry);
    if (parsed !== null) {
      slots[id] = parsed;
    }
  }
  return { day: raw['day'], lifted: raw['lifted'] === true, slots };
}

/**
 * The burn rate's book of one UTC day (req-181): per slot what its weekly
 * window has dropped since the day began, and whether the owner allowed the
 * day once. Kept in the service home so a restart mid-day does not forget
 * the morning's spend; a new day starts empty.
 */
export class BurnRateDayBook {
  private record: DayRecord = EMPTY;
  private stored = JSON.stringify(EMPTY);
  /** Writes go one after another, so an older state never lands after a newer one. */
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: BurnRateDayFile,
    private readonly log: (message: string) => void,
  ) {}

  /** Reads the stored book (the service's start). */
  async load(): Promise<void> {
    this.record = recordOf(await this.file.read().catch(() => null));
    this.stored = JSON.stringify(this.record);
  }

  /** Turns the book to `day`: on a new day every entry and the lift go. */
  roll(day: string): void {
    if (this.record.day !== day) {
      this.record = { day, lifted: false, slots: {} };
      this.save();
    }
  }

  get day(): string {
    return this.record.day;
  }

  entry(slotId: string): SlotDayEntry | null {
    return this.record.slots[slotId] ?? null;
  }

  setEntry(slotId: string, entry: SlotDayEntry): void {
    this.record = { ...this.record, slots: { ...this.record.slots, [slotId]: entry } };
    this.save();
  }

  /** The owner's "Allow today once": the hold stays lifted until the day turns; resolves once it is stored. */
  lift(): Promise<void> {
    this.record = { ...this.record, lifted: true };
    this.save();
    return this.idle();
  }

  /** Resolves when every write so far has landed (or failed and been logged). */
  idle(): Promise<void> {
    return this.writing;
  }

  get lifted(): boolean {
    return this.record.lifted;
  }

  private save(): void {
    const json = JSON.stringify(this.record);
    if (json === this.stored) {
      return;
    }
    this.stored = json;
    const record = this.record;
    this.writing = this.writing
      .then(() => this.file.write(record))
      .catch((error: unknown) => this.log(`burn rate: the day's book could not be written: ${error instanceof Error ? error.message : String(error)}`));
  }
}
