import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { Clock } from '../ports/clock';
import type { QuotaWindow } from '../protocol';
import type { HttpReply, QuotaHttp, QuotaReading, QuotaSource } from './quota-source';
import type { Slot } from './slot';

/** A clock the spec moves. */
export class FakeClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** A quota endpoint answering from a script; every call is recorded (url and headers). */
export class FakeQuotaHttp implements QuotaHttp {
  readonly calls: { url: string; headers: Readonly<Record<string, string>> }[] = [];

  constructor(private readonly answer: (url: string, headers: Readonly<Record<string, string>>) => HttpReply) {}

  getJson(url: string, headers: Readonly<Record<string, string>>): Promise<HttpReply> {
    this.calls.push({ url, headers });
    return Promise.resolve(this.answer(url, headers));
  }
}

/** A quota source handing out whatever the spec set for a slot. */
export class FakeQuotaSource implements QuotaSource {
  readonly reads: string[] = [];
  readonly readings = new Map<string, QuotaReading>();

  read(slot: Slot): Promise<QuotaReading> {
    this.reads.push(slot.id);
    return Promise.resolve(this.readings.get(slot.id) ?? { kind: 'unavailable', detail: 'nothing set' });
  }
}

/** A recorded sample response of `fixtures/`. */
export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')) as unknown;
}

export function slot(over: Partial<Slot> & Pick<Slot, 'id'>): Slot {
  return { label: over.id, provider: 'claude-code', profile: 'private', billing: null, sessions: null, login: {}, quota: 'counting', limits: [], implied: false, ...over };
}

export function window(over: Partial<QuotaWindow> = {}): QuotaWindow {
  return { name: '7d', spanMs: 7 * 24 * 3_600_000, remaining: 0.5, resetsAt: null, reliability: 'measured', fetchedAt: null, ...over };
}
