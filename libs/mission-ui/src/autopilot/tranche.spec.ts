/**
 * req-179 — the tranche on Mission Control (boards 10t and 10u): the
 * popover's On chips and bar, the paused-at-a-checkpoint popover, the
 * phone sheet's header and Release button, and the checkpoint card.
 */
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { AutopilotView } from '../../../../shared/autopilot';
import { trancheViewOf, type TrancheView } from '../../../../shared/tranche';
import { parseTeam } from '../api/dto';
import { MC_AUTOPILOT, MC_AUTOPILOT_ADJUST, type McAutopilotReply, type McAutopilotState } from './autopilot-state';
import { AutopilotPanel } from './panel';
import { TrancheCardView } from './tranche-card';
import { moneyOf } from './tranche-model';

const at = (h: number, m = 0): string => new Date(2026, 10, 9, h, m).toISOString();

const ON = { index: 4, of: null, done: 4, total: 10, spent: 4.1, budget: 15, startedAt: at(12), endsAt: at(16), checkpoint: null, report: null };
const REPORT = {
  kind: 'end',
  at: at(14, 2),
  runs: 10,
  spent: 4.1,
  minutes: 130,
  gates: { green: 7, total: 8 },
  change: { added: 212, removed: 40 },
  cost: { median: 0.41, max: 1.2 },
  repeated: { ticket: 'T-0119', runs: 2 },
  earlyStop: null,
};
const WAITING = { ...ON, index: 1, of: 3, done: 10, checkpoint: 'waiting', report: REPORT };
const EARLY = {
  ...WAITING,
  report: {
    ...REPORT,
    kind: 'early',
    at: at(14, 4),
    earlyStop: { rule: 'gate_rate', red: 3, window: 6, runsLeft: 6, ticket: null, value: null, median: null, tickets: [{ ticket: 'T-0119', phase: 'build', persona: 'ben', red: 2 }] },
  },
};

function provide(autopilot: AutopilotView, tranche: unknown, opts: { reply?: McAutopilotReply } = {}) {
  const view = signal<AutopilotView | null>(autopilot);
  const set = vi.fn(async (record: AutopilotView): Promise<McAutopilotReply> => {
    const reply = opts.reply ?? { ok: true };
    if (reply.ok) {
      view.set(record);
    }
    return reply;
  });
  const state: McAutopilotState = {
    autopilot: view,
    tranche: signal<TrancheView | null>(trancheViewOf({ tranche })),
    readOnly: signal(false),
    set,
    stopAll: async () => ({ ok: true }),
  };
  const adjust = { open: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: MC_AUTOPILOT, useValue: state },
      { provide: MC_AUTOPILOT_ADJUST, useValue: adjust },
    ],
  });
  return { set, adjust };
}

const el = (fixture: ComponentFixture<unknown>): HTMLElement => fixture.nativeElement as HTMLElement;
const texts = (root: HTMLElement, selector: string): string[] => Array.from(root.querySelectorAll(selector)).map((n) => n.textContent!.trim());
const NOW = new Date(2026, 10, 9, 13, 50);

function panel(sheet: boolean): ComponentFixture<AutopilotPanel> {
  const fixture = TestBed.createComponent(AutopilotPanel);
  fixture.componentRef.setInput('now', () => NOW);
  fixture.componentRef.setInput('sheet', sheet);
  fixture.detectChanges();
  return fixture;
}

describe('the popover while the tranche runs', () => {
  it("shows board 10t's chips, the bar and the note on On", () => {
    provide({ state: 'on' }, ON);
    const root = el(panel(false));
    expect(texts(root, '.pd-chip')).toEqual(['Tranche 4 of 10 runs', '2 h 10 min left']);
    const fill = root.querySelector<HTMLElement>('.pd-fill')!;
    expect(fill.style.width).toBe('46%');
    expect(root.querySelector('.pd-note')!.textContent).toBe('Pauses with a checkpoint report after the tranche.');
    expect(root.querySelector('.pd-actions')).toBeNull();
  });

  it('draws no tranche chip without a tranche', () => {
    provide({ state: 'on' }, null);
    const root = el(panel(false));
    expect(root.querySelector('.pd-bar')).toBeNull();
    expect(root.querySelector('.pd-note')).toBeNull();
  });
});

describe('Paused at a checkpoint — the iPad popover', () => {
  it('says the sentence, the chips and offers Release next tranche and Adjust…', async () => {
    const { set, adjust } = provide({ state: 'paused', resumeAt: at(18) }, WAITING);
    const fixture = panel(false);
    const root = el(fixture);
    expect(root.querySelector('.pd-sentence')!.textContent).toBe('Paused at a checkpoint. Running steps finished, nothing new starts.');
    const chips = texts(root, '.pd-chip');
    expect(chips[0]).toBe('Checkpoint report waiting');
    expect(root.querySelector('.pd-attention')!.textContent).toBe('Checkpoint report waiting');
    expect(chips[1]).toBe('Resume at 18:00');
    expect(texts(root, '.pd-actions button')).toEqual(['Release next tranche', 'Adjust…']);
    root.querySelector<HTMLButtonElement>('.pd-adjust')!.click();
    expect(adjust.open).toHaveBeenCalledTimes(1);
    root.querySelector<HTMLButtonElement>('.pd-release')!.click();
    await fixture.whenStable();
    expect(set).toHaveBeenCalledWith({ state: 'on' });
  });

  it('keeps the plain paused sentence when no checkpoint waits', () => {
    provide({ state: 'paused' }, ON);
    const root = el(panel(false));
    expect(root.querySelector('.pd-sentence')!.textContent).not.toContain('checkpoint');
    expect(root.querySelector('.pd-actions')).toBeNull();
  });
});

describe('Paused at a checkpoint — the phone sheet', () => {
  it('heads the sheet with the resume time and puts Release between the rows and Stop', () => {
    provide({ state: 'paused', resumeAt: at(18) }, WAITING);
    const root = el(panel(true));
    expect(root.querySelector('.ph-resume span')!.textContent).toBe('Checkpoint · resume at 18:00');
    const order = Array.from(root.querySelector('.ph-sheet')!.children).map((n) => n.className.split(' ')[0]);
    expect(order.indexOf('ph-release')).toBe(order.indexOf('ph-rows') + 1);
    expect(order.indexOf('ph-stop')).toBe(order.indexOf('ph-release') + 1);
    expect(root.querySelector('.ph-release')!.textContent!.trim()).toBe('Release next tranche');
  });

  it('says only Checkpoint without a resume time, and Release closes the sheet', async () => {
    const { set } = provide({ state: 'paused' }, WAITING);
    const fixture = panel(true);
    const done = vi.fn();
    fixture.componentInstance.done.subscribe(done);
    expect(el(fixture).querySelector('.ph-resume span')!.textContent).toBe('Checkpoint');
    el(fixture).querySelector<HTMLButtonElement>('.ph-release')!.click();
    await fixture.whenStable();
    expect(set).toHaveBeenCalledWith({ state: 'on' });
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('has no Release button when no checkpoint waits', () => {
    provide({ state: 'paused' }, ON);
    expect(el(panel(true)).querySelector('.ph-release')).toBeNull();
  });
});

describe('the checkpoint card (board 10u part 7)', () => {
  it("draws part 1's words and releases with Autopilot On", async () => {
    const { set, adjust } = provide({ state: 'paused' }, WAITING);
    const fixture = TestBed.createComponent(TrancheCardView);
    fixture.detectChanges();
    const root = el(fixture);
    expect(root.querySelector('.title')!.textContent!.trim()).toBe('Checkpoint · tranche 1 of 3 done');
    expect(root.querySelector('.dot')!.getAttribute('data-tone')).toBe('attention');
    expect(texts(root, '.metric dt')).toEqual(['Gate rate', 'Change size', 'Cost per run', 'Repeated']);
    expect(texts(root, '.lead')).toEqual(['7 of 8', '+212 −40', '$0.41', 'T-0119']);
    expect(texts(root, '.sub')).toEqual(['green', 'median lines', 'median · $1.20 max', 'ran twice']);
    expect(root.querySelector('.summary')!.textContent).toBe('Autopilot paused · 10 runs · $4.10 · 2 h 10 min');
    expect(texts(root, '.btn')).toEqual(['Release next tranche', 'Adjust…']);
    expect(root.querySelector('.meta')!.textContent).toBe('Mission Control · 14:02');
    root.querySelectorAll<HTMLButtonElement>('.btn')[1]!.click();
    expect(adjust.open).toHaveBeenCalledTimes(1);
    root.querySelectorAll<HTMLButtonElement>('.btn')[0]!.click();
    await fixture.whenStable();
    expect(set).toHaveBeenCalledWith({ state: 'on' });
  });

  it('draws the early stop with red rows; Open report adds the grid, Release anyway is On', async () => {
    const { set } = provide({ state: 'paused' }, EARLY);
    const fixture = TestBed.createComponent(TrancheCardView);
    fixture.detectChanges();
    const root = el(fixture);
    expect(root.querySelector('.title')!.textContent!.trim()).toBe('Stopped early · gate rate fell');
    expect(root.querySelector('.dot')!.getAttribute('data-tone')).toBe('negative');
    expect(texts(root, '.red-row')).toEqual(['T-0119 · build · Ben · red twice']);
    expect(root.querySelector('.metrics')).toBeNull();
    root.querySelectorAll<HTMLButtonElement>('.btn')[0]!.click();
    fixture.detectChanges();
    expect(root.querySelector('.metrics')).not.toBeNull();
    root.querySelectorAll<HTMLButtonElement>('.btn')[1]!.click();
    await fixture.whenStable();
    expect(set).toHaveBeenCalledWith({ state: 'on' });
  });

  it('renders nothing while no checkpoint waits', () => {
    provide({ state: 'on' }, ON);
    const fixture = TestBed.createComponent(TrancheCardView);
    fixture.detectChanges();
    expect(el(fixture).querySelector('.card')).toBeNull();
  });
});

describe('the desk fold and the money', () => {
  it('carries the chain block tranche into the team', () => {
    const team = parseTeam([], { runs: [], chain: { master: 'run', tranche: WAITING } });
    expect(team.tranche).toMatchObject({ index: 1, of: 3, checkpoint: 'waiting' });
    expect(parseTeam([], { runs: [], chain: { master: 'run' } }).tranche).toBeUndefined();
  });

  it('writes whole dollars bare and cents with two digits', () => {
    expect([moneyOf(15), moneyOf(4.1), moneyOf(0.41)]).toEqual(['$15', '$4.10', '$0.41']);
  });
});
