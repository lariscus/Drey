import { describe, expect, it } from 'vitest';
import type { RunnerEvent } from '../ports/event-sink';
import type { GovernorStatus } from '../protocol-governor';
import { GovernorPublisher } from './governor-publisher';

const status = (busy: number): GovernorStatus => ({
  heavy: { busy, total: 2, holders: [] },
  light: { busy: 0, total: null },
  load: { cpu: null, memory: null, reserve: 25 },
  lowPriority: true,
  quietHours: '',
  quietUntil: null,
  waiting: [],
  devServers: [],
});

describe('GovernorPublisher', () => {
  it('prefixes the log line and publishes a changed status once', () => {
    const lines: string[] = [];
    const events: RunnerEvent[] = [];
    const publisher = new GovernorPublisher((line) => lines.push(line), { publish: (event) => events.push(event) });
    publisher.line('heavy seat granted to T-0126 tests · 1 of 2');
    publisher.status(status(1));
    publisher.status(status(1));
    publisher.status(status(2));
    expect(lines).toEqual(['governor: heavy seat granted to T-0126 tests · 1 of 2']);
    expect(events.map((e) => (e.kind === 'governor' ? e.governor.heavy.busy : -1))).toEqual([1, 2]);
  });
});
