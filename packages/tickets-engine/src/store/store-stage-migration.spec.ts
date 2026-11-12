import { describe, expect, it } from 'vitest';
import type { TicketDetail } from '../ports/ticket-store';
import { StoreStageMigration, type StageConfigCommitter, type StageMigrationStore } from './store-stage-migration';

const OLD = '[stages]\nvalues = ["inbox", "shaping", "prioritized", "building", "ready", "done"]\ninitial = "inbox"\nterminal = ["done"]\nclaim = ["building"]\n';
const BRIDGE = '[stages]\nvalues = ["inbox", "prioritized", "shaping", "building", "ready", "active", "running", "done"]\ninitial = "inbox"\nterminal = ["done"]\nclaim = ["running"]\n';

function record(id: string, stage: string): TicketDetail {
  return { id, stage, owner: null, rev: 1, extensions: {}, text: `---\nid: ${id}\nstage: ${stage}\nrev: 1\n---\nbody\n` } as unknown as TicketDetail;
}

/** An in-memory store and config: what the migration reads and writes. */
class Scripted implements StageMigrationStore, StageConfigCommitter {
  readonly writes: string[] = [];
  readonly commits: string[] = [];
  pinCursor?: StageMigrationStore['pinCursor'];
  constructor(
    public config: { ref: string; text: string },
    public tickets: TicketDetail[],
    private readonly refused: string | null = null,
  ) {}
  configText(): Promise<{ ref: string; text: string }> {
    return Promise.resolve(this.config);
  }
  records(): Promise<readonly TicketDetail[]> {
    return Promise.resolve(this.tickets);
  }
  show(id: string): Promise<TicketDetail> {
    return Promise.resolve(this.tickets.find((t) => t.id === id)!);
  }
  write(id: string, text: string): Promise<{ ok: boolean }> {
    this.writes.push(text);
    const stage = /^stage: (\S+)/m.exec(text)![1]!;
    const pin = /^x-phase: (\S+)/m.exec(text)?.[1];
    this.tickets = this.tickets.map((t) => (t.id === id ? ({ ...t, stage, text, extensions: pin === undefined ? {} : { 'x-phase': pin } } as TicketDetail) : t));
    return Promise.resolve({ ok: true });
  }
  refusal(): Promise<string | null> {
    return Promise.resolve(this.refused);
  }
  commit(text: string): Promise<string> {
    this.commits.push(text);
    this.config = { ...this.config, text };
    return Promise.resolve(`c${this.commits.length}`);
  }
}

const migration = (s: Scripted): StoreStageMigration => new StoreStageMigration(s, s, 'owner@h', () => undefined);

describe('the store stage migration (req-265)', () => {
  it('a local store: one click makes step 1, the moves and step 2', async () => {
    const s = new Scripted({ ref: 'main', text: OLD }, [record('t-1', 'building'), record('t-2', 'inbox')]);
    expect(await migration(s).offer()).toMatchObject({ mode: 'local', moves: 1, configCommits: 2, reason: null });
    expect(await migration(s).run()).toEqual({ ok: true, configCommits: 2, moved: ['t-1'] });
    expect(s.commits[0]).toContain('"active", "running"');
    expect(s.commits[1]).toContain('values = ["inbox", "prioritized", "active", "running", "done"]');
    expect(s.writes[0]).toContain('stage: active');
    expect(s.writes[0]).toContain('x-phase: building');
    expect(await migration(s).offer()).toBeNull();
  });

  it('req-257: with the cursor rule a moved ticket gets its cursor and the standard flow instead of the pin', async () => {
    const s = new Scripted({ ref: 'main', text: OLD }, [record('t-1', 'building')]);
    s.pinCursor = (_record, pin) => (pin === 'building' ? { at: 3, chain: 'paul:shape;paul;ben;you' } : null);
    expect(await migration(s).run()).toEqual({ ok: true, configCommits: 2, moved: ['t-1'] });
    expect(s.writes[0]).toContain('stage: active');
    expect(s.writes[0]).toMatch(/^x-at: 3$/m);
    expect(s.writes[0]).toMatch(/^x-chain: paul:shape;paul;ben;you$/m);
    expect(s.writes[0]).not.toContain('x-phase');
    expect(await migration(s).offer()).toBeNull();
  });

  it('req-257: a pin a milestone-239 migration left on an active ticket becomes its cursor', async () => {
    const LIFE = '[stages]\nvalues = ["inbox", "prioritized", "active", "running", "done"]\ninitial = "inbox"\nterminal = ["done"]\nclaim = ["running"]\n';
    const pinned = { ...record('t-2', 'active'), extensions: { 'x-phase': 'ready' }, text: '---\nid: t-2\nstage: active\nx-phase: ready\nrev: 1\n---\nbody\n' } as TicketDetail;
    const s = new Scripted({ ref: 'main', text: LIFE }, [pinned]);
    s.pinCursor = () => ({ at: 6, chain: null });
    expect(await migration(s).offer()).toMatchObject({ moves: 1, configCommits: 0 });
    expect(await migration(s).run()).toEqual({ ok: true, configCommits: 0, moved: ['t-2'] });
    expect(s.writes[0]).toMatch(/^x-at: 6$/m);
    expect(s.writes[0]).not.toContain('x-phase');
    expect(await migration(s).offer()).toBeNull();
  });

  it("a remote store: the offer is manual with the next table to paste; Migrate moves the tickets once the owner's edit is in", async () => {
    const s = new Scripted({ ref: 'refs/dricket/config', text: OLD }, [record('t-1', 'ready')]);
    const offer = await migration(s).offer();
    expect(offer).toMatchObject({ mode: 'manual', moves: 1 });
    expect(offer?.toml).toContain('"active", "running"'); // step 1's table first
    expect(await migration(s).run()).toMatchObject({ ok: false });
    expect(s.commits).toEqual([]);

    s.config = { ref: 'refs/dricket/config', text: BRIDGE }; // the owner pasted step 1
    const result = await migration(s).run();
    expect(result).toMatchObject({ ok: false, moved: ['t-1'] }); // moved; step 2 is the owner's again
    expect((await migration(s).offer())?.toml).toContain('values = ["inbox", "prioritized", "active", "running", "done"]');
    expect(s.commits).toEqual([]);
  });

  it('waits while a ticket is claimed and writes nothing', async () => {
    const claimed = { ...record('t-1', 'building'), owner: 'agent-r-1@h' } as TicketDetail;
    const s = new Scripted({ ref: 'main', text: OLD }, [claimed]);
    expect((await migration(s).offer())?.waitFor).toBe('t-1 is claimed by agent-r-1@h');
    expect(await migration(s).run()).toMatchObject({ ok: false });
    expect([s.commits, s.writes]).toEqual([[], []]);
  });
});
