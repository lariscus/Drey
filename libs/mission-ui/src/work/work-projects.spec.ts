import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { TOUCH_FACE_QUERY } from '../phone/phone';
import { ProjectFilter } from './project-filter';
import { Work } from './work';
import { MC_WORK_STATE, type McBoard, type McWorkState } from './work.model';

/**
 * req-298: Mission Control's own project filter in the running components —
 * the control (board 7n's look) and the Work list it narrows, on the desk's
 * wide list and on the phone's. req-308: one project is always active — no
 * *All projects*, no *Unassigned*.
 */

const PROJECTS = [
  { id: 'drey', name: 'Drey', color: '#8ecbef' },
  { id: 'lariscus', name: 'Lariscus', color: '#f2cfae' },
];

const card = (id: string, title: string, project: string | null) => ({ id, title, blocked: [], meta: { title, ...(project === null ? {} : { project }) } });

const BOARD = {
  projects: PROJECTS,
  recentDone: [
    { id: 'T-0100', title: 'Drey shipped', at: '2026-11-13T10:00:00Z', project: 'drey' },
    { id: 'T-0101', title: 'Lariscus shipped', at: '2026-11-13T09:00:00Z', project: 'lariscus' },
  ],
  columns: [
    { phase: { id: 'shaping', title: 'Shaping' }, tickets: [card('T-0001', 'Drey idea', 'drey'), card('T-0002', 'Lariscus idea', 'lariscus'), card('T-0003', 'Loose idea', null)] },
    { phase: { id: 'done', title: 'Done' }, tickets: [] },
  ],
} as unknown as McBoard;

function stateWith(filter: string | null, picks: string[] = []): McWorkState {
  return {
    needs: [],
    board: BOARD,
    personas: [],
    readOnly: false,
    projectFilter: filter,
    setProjectFilter: (next) => picks.push(next),
    moveTicket: () => Promise.resolve({ ok: true }),
  };
}

function render(state: McWorkState): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: MC_WORK_STATE, useValue: state }] });
  const fixture = TestBed.createComponent(Work);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

/** The phone face: the touch query matches, the iPad's does not. */
function phoneFace(): void {
  window.matchMedia = ((query: string) => ({
    matches: query === TOUCH_FACE_QUERY,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

describe("the desk's Work list under the project filter (req-298)", () => {
  it('shows only the chosen project\'s cards and Done this week', () => {
    const el = render(stateWith('drey'));
    expect([...el.querySelectorAll('button.ticket-card:not(.done-card) .tid')].map((n) => n.textContent)).toEqual(['T-0001']);
    expect([...el.querySelectorAll('button.done-card .tid')].map((n) => n.textContent)).toEqual(['T-0100']);
  });

  it('no stored choice reads as the board\'s first project; a ticket without a project shows under none', () => {
    expect([...render(stateWith(null)).querySelectorAll('button.ticket-card:not(.done-card) .tid')].map((n) => n.textContent)).toEqual(['T-0001']);
    const el = render(stateWith('lariscus'));
    expect([...el.querySelectorAll('button.ticket-card:not(.done-card) .tid')].map((n) => n.textContent)).toEqual(['T-0002']);
    expect([...el.querySelectorAll('button.done-card .tid')].map((n) => n.textContent)).toEqual(['T-0101']);
  });
});

describe("the phone's Work list under the project filter (req-298)", () => {
  it('draws the filter at the end of the cost strip and picks a project on this device', () => {
    phoneFace();
    const picks: string[] = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: MC_WORK_STATE, useValue: stateWith(null, picks) }] });
    const fixture = TestBed.createComponent(Work);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const filter = el.querySelector<HTMLElement>('.ph-today mc-project-filter')!;
    // No stored choice: the board's first project is the one in effect.
    expect(filter.querySelector('.pf-label')?.textContent).toBe('Drey');
    filter.querySelector<HTMLButtonElement>('.pf-btn')!.click();
    fixture.detectChanges();
    const menu = el.querySelector<HTMLElement>('.pf-menu')!;
    expect([...menu.querySelectorAll('.pf-name')].map((n) => n.textContent)).toEqual(['Drey', 'Lariscus']);
    menu.querySelector<HTMLButtonElement>('[data-project="lariscus"]')!.click();
    expect(picks).toEqual(['lariscus']);
  });

  it("lists only the chosen project's rows; Done this week's count follows", () => {
    phoneFace();
    const el = render(stateWith('lariscus'));
    expect([...el.querySelectorAll('.ph-trow .ph-ttitle')].map((n) => n.textContent)).toEqual(['Lariscus idea']);
    expect([...el.querySelectorAll('.ph-ghead .ph-gcount')].map((n) => n.textContent)).toEqual(['1', '1']);
    expect(el.querySelector('.ph-today .pf-label')?.textContent).toBe('Lariscus');
  });

  it('draws no filter on a board with fewer than two projects', () => {
    phoneFace();
    const el = render({ ...stateWith('drey'), board: { ...BOARD, projects: [PROJECTS[0]] } as unknown as McBoard });
    expect(el.querySelector('mc-project-filter')).toBeNull();
  });
});

describe('the filter control (req-298, board 7n)', () => {
  it('shows the choice with its dot, offers one row per project, and picks once', () => {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(ProjectFilter);
    fixture.componentRef.setInput('face', 'pad');
    fixture.componentRef.setInput('projects', PROJECTS);
    fixture.componentRef.setInput('choices', PROJECTS.map((p) => ({ id: p.id, label: p.name, color: p.color })));
    fixture.componentRef.setInput('value', 'drey');
    const picked: string[] = [];
    fixture.componentInstance.pick.subscribe((value) => picked.push(value));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList).toContain('face-pad');
    expect(el.querySelector('.pf-label')?.textContent).toBe('Drey');
    expect(el.querySelector('.pf-btn')?.getAttribute('aria-label')).toBe('Project filter: Drey');
    el.querySelector<HTMLButtonElement>('.pf-btn')!.click();
    fixture.detectChanges();
    expect([...el.querySelectorAll('.pf-item')]).toHaveLength(2);
    expect(el.querySelector('[data-project="drey"]')?.getAttribute('aria-checked')).toBe('true');
    el.querySelector<HTMLButtonElement>('[data-project="drey"]')!.click();
    fixture.detectChanges();
    expect(picked).toEqual([]);
    expect(el.querySelector('.pf-menu')).toBeNull();
    el.querySelector<HTMLButtonElement>('.pf-btn')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-project="lariscus"]')!.click();
    expect(picked).toEqual(['lariscus']);
  });
});
