// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { PersonaView } from '../../shared/remote-protocol';
import type { ChainStatus, RunInfo } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { BoardSnapshot, TicketCard } from '../../shared/tickets';
import type { DeskDeps } from '../desk-deps';
import { mountBoard } from '../board/board-view';
import { bandHeaderStatusOf, bandStatusOf } from './capacity-model';
import { bandShownFor, mountCapacity, personaLineOf, trancheNodes } from './capacity-view';
import { focusCrew, resetCrewFocus } from './team-focus';
import { personaCardOf } from './team-model';
import type { TeamStore } from './team-store';
import { mountTeam } from './team-view';

describe('Edit persona (board 7f -> 7k)', () => {
  it('is drawn when the page can be opened, and opens the selected persona', async () => {
    const opens: string[] = [];
    const host = document.createElement('div');
    const dispose = mountTeam(
      {
        api: { i18n },
        runs: () => [],
        chain: () => null,
        titleOf: () => null,
        subscribe: () => () => undefined,
        openPersona: (id: string) => opens.push(id),
      } as unknown as DeskDeps,
      { personas: () => [persona({})], loaded: () => true, error: () => '', subscribe: () => () => undefined, refresh: async () => undefined, nameOf: () => 'Ben' } as TeamStore,
      host,
    );
    const button = host.querySelector<HTMLButtonElement>('.desk-detail-head .persona-edit-btn');
    expect(button?.textContent).toBe('Edit persona');
    button?.click();
    expect(opens).toEqual(['ben']);
    dispose();
  });
});

const persona = (patch: Partial<PersonaView>): PersonaView => ({
  id: 'ben',
  title: 'Ben',
  role: 'Builder',
  worker: 'opencode',
  model: 'qwen3-coder',
  pool: ['qwen3-coder'],
  color: '#3366cc',
  budget: 5,
  dailyCost: 2.67,
  phases: ['build'],
  ...patch,
});

const run = (patch: Partial<RunInfo>): RunInfo =>
  ({
    id: 'r1',
    ticketId: 'T-0126',
    persona: 'tessa',
    provider: 'opencode',
    state: 'running',
    startedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    lastActivity: new Date(Date.now() - 9 * 60_000).toISOString(),
    stuck: true,
    ...patch,
  }) as unknown as RunInfo;

let runs: RunInfo[];
let chain: ChainStatus | null;
let invoked: [string, unknown][];
let opened: string[];

const ticketCard = (id: string, at: string): TicketCard =>
  ({ id, path: `tickets/${at}/${id}.md`, phase: at, meta: { title: `Ticket ${id}`, persona: null, parent: null, entered: {} }, usage: { tokensIn: 0, tokensOut: 0, cost: 1.2, runs: 1 }, blocked: [], blocks: [], issues: [] }) as unknown as TicketCard;

const snapshot = {
  vaultId: 'v',
  columns: [
    { phase: { id: 'inbox', title: 'Inbox', persona: null, handover: 'manual' }, unknown: false, tickets: [ticketCard('T-0133', 'inbox')] },
    { phase: { id: 'build', title: 'Build', persona: 'ben', handover: 'agent build-default' }, unknown: false, tickets: [ticketCard('T-0126', 'build')] },
  ],
  checkpoints: [],
  recentDone: [],
} as unknown as BoardSnapshot;

let activePath: string | null = 'board://all';

function deps(): DeskDeps {
  return {
    api: {
      i18n,
      ui: { icon: () => document.createElement('i') },
      documents: { active: () => ({ path: activePath }), onChange: () => () => undefined },
    },
    snapshot: () => snapshot,
    runs: () => runs,
    chain: () => chain,
    invoke: async (method: string, payload?: unknown) => {
      invoked.push([method, payload]);
      return method === 'personaThread' ? { ok: true, messages: [] } : { ok: true };
    },
    subscribe: () => () => undefined,
    mutate: async (_label: string, fn: () => Promise<unknown>) => {
      await fn();
      return { ok: true };
    },
    chainAction: async (method: string, payload: unknown) => {
      invoked.push([method, payload]);
    },
    toggleAutopilot: () => invoked.push(['autopilot-popover', null]),
    openTicket: (card: TicketCard) => opened.push(card.id),
    newIdea: () => opened.push('new-idea'),
    titleOf: (id: string) => (id === 'T-0126' ? 'Git panel: stage single hunks' : null),
  } as unknown as DeskDeps;
}

const store = (personas: PersonaView[]): TeamStore => ({
  personas: () => personas,
  nameOf: (id) => personas.find((p) => p.id === id)?.title ?? id ?? '',
  loaded: () => true,
  error: () => '',
  refresh: async () => undefined,
  subscribe: () => () => undefined,
});

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

beforeEach(() => {
  runs = [run({})];
  chain = { master: 'run', poolSize: { opencode: 2, 'claude-code': 3 } } as unknown as ChainStatus;
  invoked = [];
  opened = [];
  document.body.replaceChildren();
});

afterEach(() => vi.restoreAllMocks());

describe('the Crew tab', () => {
  const personas = [persona({}), persona({ id: 'tessa', title: 'Tessa', role: 'Tester', dailyCost: 0.36, budget: null })];

  it('shows the head, the budget and a card per persona with its stuck run', () => {
    const host = document.body.appendChild(document.createElement('div'));
    mountTeam(deps(), store(personas), host);
    expect(host.querySelector('.desk-head-sub')!.textContent).toBe('2 personas · 1 stuck');
    expect(host.querySelector('.desk-budget')!.textContent).toBe('Budget$3.03 of $5 today');
    const tessa = host.querySelector('[data-persona="tessa"]')!;
    expect(tessa.querySelector('.desk-persona-state')!.textContent).toBe('stuck');
    expect(tessa.querySelector('.desk-persona-headline')!.textContent).toBe('No output for 9 min on T-0126');
    expect(tessa.querySelector('.desk-persona-role')!.textContent).toBe('Tester · $0.36 today');
    expect([...tessa.querySelectorAll('.desk-persona-controls button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Nudge the worker', 'Hand to Claude Code', 'Stop']);
    expect(host.querySelector('[data-persona="ben"] .desk-persona-role')!.textContent).toBe('Builder · $2.67 today');
  });

  it("draws the persona's one line as the card's line 3 where the record has one (req-144), the role where it has not", () => {
    const host = document.body.appendChild(document.createElement('div'));
    mountTeam(deps(), store([persona({ summary: 'Builds one part, test first.' }), persona({ id: 'tessa', title: 'Tessa', role: 'Tester', dailyCost: 0.36, budget: null })]), host);
    expect(host.querySelector('[data-persona="ben"] .desk-persona-role')!.textContent).toBe('Builds one part, test first. · $2.67 today');
    expect(host.querySelector('[data-persona="tessa"] .desk-persona-role')!.textContent).toBe('Tester · $0.36 today');
  });

  it("opens on the persona and tab the Persona page's link asked for, waiting or while open", () => {
    resetCrewFocus();
    const host = document.body.appendChild(document.createElement('div'));
    focusCrew({ persona: 'tessa', tab: '1:1' });
    mountTeam(deps(), store(personas), host);
    expect(host.querySelector('[data-persona="tessa"]')!.classList.contains('desk-persona-selected')).toBe(true);
    expect(host.querySelector('.desk-tab-on')!.textContent).toBe('1:1');
    focusCrew({ persona: 'ben', tab: 'Memory' });
    return new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        expect(host.querySelector('[data-persona="ben"]')!.classList.contains('desk-persona-selected')).toBe(true);
        expect(host.querySelector('.desk-tab-on')!.textContent).toBe('Memory');
        resetCrewFocus();
        resolve();
      });
    });
  });

  it('draws the Autopilot chip between the budget and Pause all, and a click opens the popover (board 7f)', () => {
    const host = document.body.appendChild(document.createElement('div'));
    mountTeam(deps(), store(personas), host);
    const chip = host.querySelector<HTMLButtonElement>('.desk-autopilot-chip')!;
    expect(chip.textContent).toBe('Autopilot · On');
    expect(chip.title).toBe('Autopilot: On (Mod+Alt+P)');
    expect(chip.getAttribute('aria-haspopup')).toBe('dialog');
    expect(chip.querySelector('.desk-autopilot-dot-positive')).not.toBeNull();
    expect(chip.previousElementSibling?.classList.contains('desk-budget')).toBe(true);
    expect(chip.nextElementSibling?.getAttribute('aria-label')).toBe('Pause all after this step');
    chip.click();
    expect(invoked).toContainEqual(['autopilot-popover', null]);
  });

  it('wires Nudge and Hand to Claude Code to the fleet; Stop asks first', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    mountTeam(deps(), store(personas), host);
    const [nudge, handoff, stop] = [...host.querySelectorAll<HTMLButtonElement>('.desk-persona-controls button')];
    nudge!.click();
    handoff!.click();
    await Promise.resolve();
    expect(invoked.map(([method]) => method)).toEqual(['fleetSend', 'handoffRun']);
    expect(invoked[1]![1]).toEqual({ runId: 'r1' });
    stop!.click();
    await nextFrame();
    expect(invoked.map(([method]) => method)).toEqual(['fleetSend', 'handoffRun']);
    const ask = host.querySelector('.desk-confirm')!;
    expect(ask.textContent).toContain('Stop Tessa? The branch stays.');
    [...ask.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Stop')!.click();
    await Promise.resolve();
    expect(invoked.map(([method]) => method)).toEqual(['fleetSend', 'handoffRun', 'fleetStop']);
  });

  it('offers no hand-off for a run already on Claude Code', () => {
    runs = [run({ provider: 'claude-code' })];
    const host = document.body.appendChild(document.createElement('div'));
    mountTeam(deps(), store(personas), host);
    expect([...host.querySelectorAll('.desk-persona-controls button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Nudge the worker', 'Stop']);
  });

  it('Pause all halts the chain, then reads Resume all', () => {
    const host = document.body.appendChild(document.createElement('div'));
    mountTeam(deps(), store(personas), host);
    host.querySelector<HTMLButtonElement>('.desk-head button[aria-label="Pause all after this step"]')!.click();
    expect(invoked).toEqual([['chainMaster', { mode: 'halted' }]]);
    chain = { master: 'halted' } as unknown as ChainStatus;
    const host2 = document.body.appendChild(document.createElement('div'));
    mountTeam(deps(), store(personas), host2);
    expect(host2.querySelector('.desk-head button[aria-label="Resume all"]')).not.toBeNull();
  });

  it('arms Stop all on the first press and aborts on the second', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    mountTeam(deps(), store(personas), host);
    const stopAll = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.desk-head button[aria-label="Stop all"]')!;
    stopAll().click();
    expect(invoked).toEqual([]);
    await nextFrame();
    expect(stopAll().classList.contains('desk-btn-armed')).toBe(true);
    stopAll().click();
    expect(invoked).toEqual([['chainAbort', {}]]);
  });

  it('selects the first persona, lists Setup, Memory and 1:1, and asks the thread on 1:1', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    mountTeam(deps(), store(personas), host);
    expect(host.querySelector('.desk-detail .desk-persona-title')!.textContent).toBe('Ben');
    expect([...host.querySelectorAll('.desk-tab')].map((t) => t.textContent)).toEqual(['Setup', 'Memory', '1:1']);
    expect(host.querySelector('.desk-tab-on')!.textContent).toBe('Setup');
    expect(host.querySelector('.desk-pool-model')!.textContent).toBe('qwen3-coder');
    [...host.querySelectorAll<HTMLElement>('.desk-tab')].find((t) => t.textContent === '1:1')!.click();
    await nextFrame();
    expect(invoked).toContainEqual(['personaThread', { persona: 'ben' }]);
    host.querySelector<HTMLElement>('[data-persona="tessa"]')!.click();
    await nextFrame();
    expect(host.querySelector('.desk-detail .desk-persona-title')!.textContent).toBe('Tessa');
  });

  it('req-269: Mission Control\'s persona has a card that opens her page; she is never selected and not counted', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    const opens: string[] = [];
    const pia = persona({ id: 'pia', title: 'Pia', kind: 'mission', role: 'custom', worker: '', model: '', pool: [], budget: null, dailyCost: undefined, phases: [] });
    mountTeam({ ...deps(), openPersona: (id: string) => opens.push(id) } as DeskDeps, store([pia, ...personas]), host);
    expect(host.querySelector('[data-persona="pia"]')).not.toBeNull();
    expect(host.querySelector('.desk-detail .desk-persona-title')!.textContent).toBe('Ben');
    expect(host.querySelector('.desk-head-sub')!.textContent).toBe('2 personas · 1 stuck');
    host.querySelector<HTMLElement>('[data-persona="pia"]')!.click();
    await nextFrame();
    expect(opens).toEqual(['pia']);
    expect(host.querySelector('.desk-detail .desk-persona-title')!.textContent).toBe('Ben');
    expect(invoked.some(([method]) => method === 'personaThread')).toBe(false);
  });

  it('leaves the owner out of the cards', () => {
    const host = document.body.appendChild(document.createElement('div'));
    mountTeam(deps(), store([...personas, persona({ id: 'you', title: 'You', kind: 'human' })]), host);
    expect(host.querySelector('[data-persona="you"]')).toBeNull();
    expect(host.querySelector('.desk-head-sub')!.textContent).toBe('2 personas · 1 stuck');
  });
});

describe('the Capacity band', () => {
  it('draws one button per persona with what it does, and the day against the budget', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const personas = [persona({}), persona({ id: 'tessa', title: 'Tessa', role: 'Tester' })];
    const open = vi.fn();
    mountCapacity(deps(), store(personas), host, open);
    expect([...host.querySelectorAll('.desk-cap-person .desk-cap-line')].map((p) => p.textContent)).toEqual(['idle', 'stuck on T-0126 · 9 min']);
    expect(host.querySelector('.desk-cap-today')!.textContent).toBe('$5.34 of $10 today');
    expect(host.querySelector('.desk-cap-stuckdot')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('.desk-cap-crew')!.click();
    expect(open).toHaveBeenCalled();
  });

  it('shows the band only while the Board tab is active (7e)', () => {
    expect(bandShownFor('board://all')).toBe(true);
    expect(bandShownFor('team://all')).toBe(false);
    expect(bandShownFor('notes/a.md')).toBe(false);
    expect(bandShownFor(null)).toBe(false);
    const host = document.body.appendChild(document.createElement('div'));
    activePath = 'notes/a.md';
    mountCapacity(deps(), store([persona({})]), host, vi.fn());
    expect(host.querySelector<HTMLElement>('.desk-capacity')!.hidden).toBe(true);
    activePath = 'board://all';
  });

  it('names a persona line and the header status', () => {
    expect(personaLineOf(personaCardOf(persona({ id: 'tessa' }), [run({})], [], () => null, Date.now()), i18n)).toBe('stuck on T-0126 · 9 min');
    expect(personaLineOf(personaCardOf(persona({ id: 'tessa' }), [run({ stuck: false }), run({ id: 'r2', stuck: false })], [], () => null, Date.now()), i18n)).toBe('works on T-0126 +1');
    expect(personaLineOf(personaCardOf(persona({ id: 'tessa' }), [run({ stuck: false, waiting: { kind: 'question', text: '?', since: '' } as never })], [], () => null, Date.now()), i18n)).toBe('T-0126 waits for you');
    expect(bandStatusOf([run({})], i18n)).toBe('1 stuck');
    expect(bandStatusOf([run({ stuck: false })], i18n)).toBe('1 running');
    expect(bandStatusOf([], i18n)).toBeNull();
    expect(bandHeaderStatusOf([run({})], chain, 0, i18n)).toBe('1 of 5 sessions');
    expect(bandHeaderStatusOf([run({})], chain, 1, i18n)).toBe('1 of 5 sessions · 1 queued');
    expect(bandHeaderStatusOf([run({})], null, 0, i18n)).toBe('1 stuck');
  });
});

describe('the Capacity band: Slots row and queue row (board 7e)', () => {
  const inThreeDays = new Date(Date.now() + 3 * 86_400_000);
  inThreeDays.setHours(9, 0, 0, 0);
  const monday = inThreeDays.toISOString();
  const weekday = new Intl.DateTimeFormat('en', { weekday: 'short' }).format(inThreeDays);
  const slotsChain = (): ChainStatus =>
    ({
      master: 'run',
      poolSize: { opencode: 2, 'claude-code': 3 },
      slots: [
        { id: 'a', label: 'Claude A', profile: 'private', state: 'busy', busy: 1, total: 2, remaining: 0.62, reliability: 'measured', q: 1.4, resetsAt: monday },
        { id: 'z', label: 'z.ai', profile: 'private', state: 'busy', busy: 1, total: 3, remaining: 0.7, reliability: 'estimated', q: 1.2, resetsAt: monday },
        { id: 'k', label: 'Kimi', profile: 'private', state: 'ready', busy: 0, total: 2, remaining: null, reliability: 'unknown', q: null, resetsAt: null },
        { id: 'l', label: 'Claude B', profile: 'private', state: 'needs-login', busy: 0, total: 1, remaining: 0.3, reliability: 'measured', q: 0.8, resetsAt: monday },
      ],
    }) as unknown as ChainStatus;
  const queuedSnapshot = {
    ...snapshot,
    columns: [
      { phase: { id: 'inbox', title: 'Inbox', persona: null, handover: 'manual' }, unknown: false, tickets: [] },
      { phase: { id: 'prioritized', title: 'Prioritized', persona: null, handover: 'manual' }, unknown: false, tickets: [ticketCard('T-0123', 'prioritized'), ticketCard('T-0124', 'prioritized')] },
      { phase: { id: 'build', title: 'Build', persona: 'ben', handover: 'agent build-default' }, unknown: false, tickets: [] },
    ],
  } as unknown as BoardSnapshot;

  it('draws one chip per slot: dots, bar by reliability, share, q with the upgrade mark, the reset', () => {
    chain = slotsChain();
    const host = document.body.appendChild(document.createElement('div'));
    mountCapacity(deps(), store([persona({})]), host, vi.fn());
    const chips = [...host.querySelectorAll<HTMLElement>('.desk-slot')];
    expect(chips.map((c) => c.querySelector('.desk-slot-name')!.textContent)).toEqual(['Claude A', 'z.ai', 'Kimi', 'Claude B']);
    const [a, z, kimi, login] = chips;
    expect([...a!.querySelectorAll('.desk-cap-slot')].map((d) => d.classList.contains('desk-cap-slot-busy'))).toEqual([true, false]);
    expect(a!.querySelector('.desk-slot-share')!.textContent).toBe('62 %');
    expect(a!.querySelector<HTMLElement>('.desk-slot-fill')!.style.width).toBe('62%');
    expect(a!.querySelector('.desk-slot-fill-estimated')).toBeNull();
    expect(a!.querySelector('.desk-slot-q')!.textContent).toBe('q 1.4');
    expect(a!.querySelector('.desk-slot-upgrade')!.getAttribute('aria-label')).toBe('Upgrade allowed');
    expect(a!.querySelector('.desk-slot-reset')!.textContent).toBe(`${weekday} 09:00`);
    expect(a!.title).toBe(`resets ${weekday} 09:00`);
    expect(z!.querySelector('.desk-slot-fill-estimated')).not.toBeNull();
    expect(z!.querySelector('.desk-slot-q')!.textContent).toBe('q 1.2');
    expect(z!.querySelector('.desk-slot-upgrade')).toBeNull();
    expect(kimi!.querySelector('.desk-slot-note')!.textContent).toBe('unknown');
    expect(kimi!.querySelector('.desk-slot-bar, .desk-slot-q, .desk-slot-reset')).toBeNull();
    expect(kimi!.title).toBe('quota unknown');
    expect(login!.querySelector('.desk-slot-note-attention')!.textContent).toBe('needs login');
    expect(login!.querySelector('.desk-slot-bar')).toBeNull();
  });

  it('puts the first queued ticket on the right of the last row and leaves the tranche part empty', () => {
    chain = slotsChain();
    const host = document.body.appendChild(document.createElement('div'));
    mountCapacity({ ...deps(), snapshot: () => queuedSnapshot }, store([persona({})]), host, vi.fn());
    const row = host.querySelector('.desk-cap-queuerow')!;
    expect(row.querySelector('.desk-queue-text')!.textContent).toBe('T-0123 queued · waits for a slot · 1st');
    expect(row.querySelector('.desk-tranche-text')).toBeNull();
  });

  it('draws the tranche part as board 7e does once the chain carries a tranche', () => {
    const full = { index: 1, runs: 4, size: 10, cost: 4.1, budget: 15, runsLeft: 6, msLeft: 2 * 3_600_000 + 10 * 60_000, progress: 0.4 };
    const nodes = trancheNodes(full, i18n);
    expect(nodes[0]!.textContent).toBe('Tranche 4 of 10 runs · $4.10 of $15 · checkpoint in 6 runs or 2 h 10 min');
    expect(nodes[1]!.querySelector<HTMLElement>('.desk-tranche-fill')!.style.width).toBe('40%');
  });

  it('says the shorter forms when the tranche lacks a limit', () => {
    const base = { index: 2, runs: 3, size: 10, cost: 4.1, budget: 15, runsLeft: 7, msLeft: 45 * 60_000, progress: 0.3 };
    const line = (patch: object): string | null => trancheNodes({ ...base, ...patch }, i18n)[0]!.textContent;
    expect(line({ msLeft: null })).toBe('Tranche 3 of 10 runs · $4.10 of $15 · checkpoint in 7 runs');
    expect(line({ budget: null })).toBe('Tranche 3 of 10 runs · $4.10 · checkpoint in 7 runs or 45 min');
    expect(line({ budget: null, msLeft: null })).toBe('Tranche 3 of 10 runs · $4.10 · checkpoint in 7 runs');
    expect(line({ size: null, runsLeft: null })).toBe('Tranche 2 · 3 runs · $4.10 of $15 · checkpoint in 45 min');
    expect(line({ size: null, runsLeft: null, msLeft: null })).toBe('Tranche 2 · 3 runs · $4.10 of $15');
    expect(line({ size: null, runsLeft: null, budget: null })).toBe('Tranche 2 · 3 runs · $4.10 · checkpoint in 45 min');
    expect(line({ size: null, runsLeft: null, budget: null, msLeft: null })).toBe('Tranche 2 · 3 runs · $4.10');
  });

  it('draws no queue part while nothing is queued', () => {
    const host = document.body.appendChild(document.createElement('div'));
    mountCapacity(deps(), store([persona({})]), host, vi.fn());
    expect(host.querySelector('.desk-queue')).toBeNull();
    expect(host.querySelectorAll('.desk-cap-persons, .desk-cap-slotrow, .desk-cap-queuerow')).toHaveLength(3);
  });
});

describe('the Board tab', () => {
  it('draws the columns with cost and persona, the New idea button in the head and Done this week last', () => {
    runs = [run({ persona: 'ben', stuck: false })];
    const host = document.body.appendChild(document.createElement('div'));
    mountBoard(deps(), store([persona({})]), host);
    expect([...host.querySelectorAll('.desk-col-title')].map((t) => t.textContent)).toEqual(['Inbox', 'Done this week']); // the last phase is the Done column
    const build = host.querySelector('[data-phase="done-this-week"]')!;
    expect(build.querySelector('.desk-col-cost')!.textContent).toBe('$1.20');
    expect(build.querySelector('.desk-card-who')!.textContent).toBe('Ben');
    expect(build.querySelector('.desk-card-kind')?.textContent).toBe('Accept');
    expect(host.querySelector('[data-phase="inbox"] .desk-card-who')!.textContent).toBe('unassigned');
    host.querySelector<HTMLElement>('.desk-head .desk-btn-primary')!.click();
    host.querySelector<HTMLElement>('[data-id="T-0126"]')!.click();
    expect(opened).toEqual(['new-idea', 'T-0126']);
  });
});
