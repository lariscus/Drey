/**
 * req-181 — the burn rate's hold on Mission Control (board 10u's phone
 * chrome, laid out like part 9): the Needs-you card with its chips and the
 * two buttons side by side, Wait and Allow today once, and the popover's /
 * sheet's line in place of the On sentence.
 */
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { AutopilotView } from '../../../../shared/autopilot';
import { burnRateHoldOf, type BurnRateHoldView } from '../../../../shared/burn-rate';
import { parseTeam } from '../api/dto';
import { MC_AUTOPILOT, type McAutopilotReply, type McAutopilotState } from './autopilot-state';
import { BurnRateCardView } from './burn-rate-card';
import { AutopilotPanel } from './panel';

const HOLD = { reason: 'burn-rate', spent: 0.21, limit: 0.2, resumesAt: new Date(2026, 10, 10, 0, 0).toISOString(), basis: 'measured', since: new Date(2026, 10, 9, 22, 40).toISOString() };

function provide(autopilot: AutopilotView, hold: unknown, opts: { reply?: McAutopilotReply; readOnly?: boolean } = {}) {
  const holdView = signal<BurnRateHoldView | null>(burnRateHoldOf({ hold }));
  const liftHold = vi.fn(async (): Promise<McAutopilotReply> => {
    const reply = opts.reply ?? { ok: true };
    if (reply.ok) {
      holdView.set(null);
    }
    return reply;
  });
  const state: McAutopilotState = {
    autopilot: signal<AutopilotView | null>(autopilot),
    tranche: signal(null),
    readOnly: signal(opts.readOnly ?? false),
    set: async () => ({ ok: true }),
    stopAll: async () => ({ ok: true }),
    hold: holdView,
    liftHold,
  };
  TestBed.configureTestingModule({ providers: [{ provide: MC_AUTOPILOT, useValue: state }] });
  return { liftHold, holdView };
}

const el = (fixture: ComponentFixture<unknown>): HTMLElement => fixture.nativeElement as HTMLElement;
const texts = (root: HTMLElement, selector: string): string[] => Array.from(root.querySelectorAll(selector)).map((n) => n.textContent!.trim());

function card(): ComponentFixture<BurnRateCardView> {
  const fixture = TestBed.createComponent(BurnRateCardView);
  fixture.detectChanges();
  return fixture;
}

function panel(sheet: boolean): ComponentFixture<AutopilotPanel> {
  const fixture = TestBed.createComponent(AutopilotPanel);
  fixture.componentRef.setInput('sheet', sheet);
  fixture.detectChanges();
  return fixture;
}

describe('Mission Control: the burn rate (req-181)', () => {
  it('reads the hold off the fleet snapshot', () => {
    expect(parseTeam([], { runs: [], chain: { master: 'run', hold: HOLD } }).hold).toMatchObject({ spent: 0.21, limit: 0.2 });
    expect(parseTeam([], { runs: [], chain: { master: 'run', hold: null } }).hold).toBeUndefined();
  });

  it('draws the card: peach dot, title, body, chips, Wait and Allow today once side by side, the meta line', () => {
    provide({ state: 'on' }, HOLD);
    const root = el(card());
    expect(root.querySelector('.title')!.textContent!.trim()).toBe('Burn rate reached · 20 % of the week today');
    expect(root.querySelector('.dot')).not.toBeNull();
    expect(root.querySelector('.body')!.textContent).toBe('Nothing new starts until 00:00. Running steps finish.');
    expect(texts(root, '.chip')).toEqual(['spent 21 %', 'resumes 00:00']);
    expect(texts(root, '.btn')).toEqual(['Wait', 'Allow today once']);
    expect(root.querySelector('.btn.primary')!.textContent!.trim()).toBe('Wait');
    expect(root.querySelector('.meta')!.textContent).toBe('Mission Control · 22:40');
  });

  it('draws nothing while nothing holds', () => {
    provide({ state: 'on' }, null);
    expect(el(card()).querySelector('.card')).toBeNull();
  });

  it('Wait dismisses the card on this device and lifts nothing', async () => {
    const { liftHold } = provide({ state: 'on' }, HOLD);
    const fixture = card();
    (el(fixture).querySelectorAll<HTMLButtonElement>('.btn')[0]!).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el(fixture).querySelector('.card')).toBeNull();
    expect(liftHold).not.toHaveBeenCalled();
  });

  it('Allow today once lifts the hold; a refusal shows in words', async () => {
    const { liftHold } = provide({ state: 'on' }, HOLD, { reply: { ok: false, error: 'the fleet runner is not running', code: 'runner_down' } });
    const fixture = card();
    (el(fixture).querySelectorAll<HTMLButtonElement>('.btn')[1]!).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(liftHold).toHaveBeenCalledTimes(1);
    expect(el(fixture).querySelector('.err')!.textContent).toBe('The runner is not running.');
  });

  it('a read-only device cannot lift', () => {
    provide({ state: 'on' }, HOLD, { readOnly: true });
    const buttons = el(card()).querySelectorAll<HTMLButtonElement>('.btn');
    expect([buttons[0]!.disabled, buttons[1]!.disabled]).toEqual([false, true]);
  });

  it('the iPad popover and the phone sheet say the hold in place of the On sentence', () => {
    provide({ state: 'on' }, HOLD);
    expect(el(panel(false)).querySelector('.pd-sentence')!.textContent).toBe('Burn rate reached · resumes at 00:00');
    const sheet = el(panel(true));
    expect(sheet.querySelector('[data-state=on] .ph-sentence')!.textContent).toBe('Burn rate reached · resumes at 00:00');
    expect(sheet.querySelector('[data-state=off] .ph-sentence')!.textContent).toBe('You start every step yourself.');
  });

  it('Off keeps its own sentence', () => {
    provide({ state: 'off' }, HOLD);
    expect(el(panel(false)).querySelector('.pd-sentence')!.textContent).toBe('You start every step yourself.');
  });
});
