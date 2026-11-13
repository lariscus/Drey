import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MC_TEAM_STATE, Team, type McTeamPersona, type McTeamState } from './team';

const persona = (id: string, extra: Partial<McTeamPersona> = {}): McTeamPersona => ({
  id,
  title: id.toUpperCase(),
  role: 'Builder',
  worker: 'opencode',
  model: 'm',
  pool: [],
  color: '#ff0000',
  currentRun: null,
  budget: null,
  ...extra,
});
const lane = (id: string, kind = 'agent'): object => ({ persona: id, title: id, kind, color: '', parallel: null, min: 0 });
const held = (id: string, holder: string): object => ({ id, hold: { holder, why: 'entry', position: 1, length: 2, chain: [holder, 'you'] } });

const BOARD = {
  lanes: [lane('ralf'), lane('ben'), lane('you', 'human')],
  columns: [{ tickets: [held('T-1', 'ben'), held('T-2', 'ben'), held('T-3', 'you')] }],
};

function mount(options: { board?: unknown; readOnly?: boolean; reply?: { ok: true } | { ok: false; error: string } } = {}) {
  TestBed.resetTestingModule();
  const orders: (readonly string[])[] = [];
  const toasts: string[] = [];
  const state: McTeamState = {
    team: signal([persona('ben', { liveRuns: [{ runId: 'r', ticketId: 'T-1', state: 'running', provider: 'x', startedAt: '', lastActivity: '', activity: null, stuck: false, contextPct: null }] }), persona('you', { kind: 'human' }), persona('ralf')]),
    board: signal(options.board ?? BOARD),
    readOnly: signal(options.readOnly ?? false),
    setCrewOrder: async (order) => {
      orders.push(order);
      return options.reply ?? { ok: true };
    },
    toast: (message) => toasts.push(message),
  };
  TestBed.configureTestingModule({ providers: [{ provide: MC_TEAM_STATE, useValue: state }] });
  const fixture = TestBed.createComponent(Team);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const ids = (): string[] => Array.from(el.querySelectorAll<HTMLElement>('.crew-row')).map((row) => row.dataset['persona']!);
  return { fixture, el, orders, toasts, ids, vm: fixture.componentInstance as unknown as { move(p: McTeamPersona, dir: -1 | 1): void } };
}

describe('the Crew list on a persona board (req-273)', () => {
  it('lists the personas in the lanes order with what each holds and runs', () => {
    const { el, ids } = mount();
    expect(ids()).toEqual(['ralf', 'ben', 'you']);
    const lines = Array.from(el.querySelectorAll('.crew-holds')).map((n) => n.textContent?.trim());
    expect(lines).toEqual(['· Holds nothing', '· Holds 2 tickets · 1 running', '· Holds 1 ticket']);
    expect(el.textContent).not.toContain('plan');
  });

  it('gives every row but the owner a handle, and none on a read-only device', () => {
    expect(mount().el.querySelectorAll('.crew-handle')).toHaveLength(2);
    expect(mount({ readOnly: true }).el.querySelectorAll('.crew-handle')).toHaveLength(0);
  });

  it('keeps the desk order and no handle off a persona board', () => {
    const { ids, el } = mount({ board: { columns: [] } });
    expect(ids()).toEqual(['ben', 'you', 'ralf']);
    expect(el.querySelectorAll('.crew-handle')).toHaveLength(0);
    expect(el.querySelectorAll('.crew-holds')).toHaveLength(0);
  });

  it('writes the whole order and shows it at once', async () => {
    const { fixture, orders, ids, vm } = mount();
    vm.move(persona('ben'), -1);
    fixture.detectChanges();
    expect(ids()).toEqual(['ben', 'ralf', 'you']);
    expect(orders).toEqual([['ben', 'ralf', 'you']]);
  });

  it('puts the order back and says why when the desk refuses', async () => {
    const { fixture, toasts, ids, vm } = mount({ reply: { ok: false, error: 'no such persona' } });
    vm.move(persona('ben'), -1);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(ids()).toEqual(['ralf', 'ben', 'you']);
    expect(toasts).toEqual(['no such persona']);
  });

  it('never moves the owner nor past the owner', () => {
    const { fixture, orders, vm } = mount();
    vm.move(persona('ben'), 1);
    vm.move(persona('you', { kind: 'human' }), -1);
    fixture.detectChanges();
    expect(orders).toEqual([]);
  });
});
