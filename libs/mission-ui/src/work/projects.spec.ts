import { describe, expect, it } from 'vitest';
import { McI18n } from '../i18n/i18n.service';
import { holderGroupsOf } from './holder-rows';
import { lanesOf, type McLane } from './hold';
import { scopedDoneOf, scopedPhoneGroupsOf, scopedWorkGroupsOf, showsTicket, workProjectChoicesOf, workProjectScopeOf } from './project-scope';
import {
  DEFAULT_PROJECT_COLOR,
  chatProjectOf,
  filterInEffectOf,
  inProjectFilter,
  projectsOf,
  storeProjectFilter,
  storedProjectFilter,
  ticketProjectIdOf,
  type FilterStorage,
} from './projects';
import { groupsOf, type McBoard } from './work.model';

const i18n = new McI18n();
const t = i18n.t.bind(i18n);

const PROJECTS = [
  { id: 'drey', name: 'Drey', color: '#8ecbef' },
  { id: 'lariscus', name: 'Lariscus', color: '#f2cfae' },
  { id: 'home-lab', name: 'Home lab', color: '#bfe3cd' },
];

describe('the board projects (req-298, one active project since req-308)', () => {
  it('reads the snapshot projects tolerantly: a name falls back to the id, a bad colour to the default, junk drops out', () => {
    const board = { projects: [{ id: 'drey', name: 'Drey', color: '#8ecbef' }, { id: 'x', color: 'blue' }, { id: 'Bad Id' }, 'junk', { id: 'drey', name: 'Twice' }] };
    expect(projectsOf(board)).toEqual([
      { id: 'drey', name: 'Drey', color: '#8ecbef' },
      { id: 'x', name: 'x', color: DEFAULT_PROJECT_COLOR },
    ]);
    expect(projectsOf({})).toEqual([]);
    expect(projectsOf(null)).toEqual([]);
  });

  it("a ticket's project: its own, else the board's only one, else none (the engine's ticketProjectId)", () => {
    expect(ticketProjectIdOf('lariscus', PROJECTS)).toBe('lariscus');
    expect(ticketProjectIdOf(undefined, [PROJECTS[0]!])).toBe('drey');
    expect(ticketProjectIdOf(' ', PROJECTS)).toBeNull();
  });

  it("the choice in effect is the stored project, else the board's first; null only on a board without projects", () => {
    expect(filterInEffectOf('drey', PROJECTS)).toBe('drey');
    expect(filterInEffectOf(null, PROJECTS)).toBe('drey');
    expect(filterInEffectOf('gone', PROJECTS)).toBe('drey');
    expect(filterInEffectOf(null, [PROJECTS[1]!])).toBe('lariscus');
    expect(filterInEffectOf('drey', [])).toBeNull();
  });

  it('shows a ticket under its project only; a ticket without one, or of an unknown project, shows under none', () => {
    expect(inProjectFilter('drey', 'drey', PROJECTS)).toBe(true);
    expect(inProjectFilter('lariscus', 'drey', PROJECTS)).toBe(false);
    expect(inProjectFilter(null, 'drey', PROJECTS)).toBe(false);
    expect(inProjectFilter('gone', 'drey', PROJECTS)).toBe(false);
    expect(inProjectFilter('lariscus', null, PROJECTS)).toBe(true);
  });

  it("Pia's project is the choice in effect; on a board without projects she asks", () => {
    expect(chatProjectOf('drey')).toBe('drey');
    expect(chatProjectOf(null)).toBeUndefined();
  });

  it('keeps the choice on this device; a blocked storage or junk (an old _unassigned among it) reads as none', () => {
    const store = new Map<string, string>();
    const storage: FilterStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
    expect(storedProjectFilter(storage)).toBeNull();
    storeProjectFilter(storage, 'home-lab');
    expect(storedProjectFilter(storage)).toBe('home-lab');
    storeProjectFilter(storage, null);
    expect(store.size).toBe(0);
    store.set('mc.project-filter', '../evil');
    expect(storedProjectFilter(storage)).toBeNull();
    store.set('mc.project-filter', '_unassigned');
    expect(storedProjectFilter(storage)).toBeNull();
    const blocked: FilterStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    };
    expect(storedProjectFilter(blocked)).toBeNull();
    expect(() => storeProjectFilter(blocked, 'drey')).not.toThrow();
  });
});

// --- the Work list under the filter ------------------------------------------------

const STANDARD = ['paul', 'ben', 'you'];
const lane = (persona: string, title: string, kind: McLane['kind'], parallel: number | null): McLane => ({ persona, title, kind, color: '#8ecbef', parallel, min: 0 });
const LANES = [lane('paul', 'Paul', 'agent', 1), lane('ben', 'Ben', 'agent', 2), lane('you', 'You', 'human', null)];
const held = (id: string, title: string, holder: string, project: string | null, position: number) => ({
  id,
  phase: 'active',
  meta: { id, title, ...(project === null ? {} : { project }) },
  blocked: [],
  hold: { holder, why: 'entry', position, length: STANDARD.length, chain: STANDARD, mode: null, named: null, claimed: false, sentBack: null, questions: 0 },
});
const plain = (id: string, phase: string, project: string | null) => ({ id, phase, meta: { id, title: id, ...(project === null ? {} : { project }) }, blocked: [] });

const BOARD = {
  lanes: LANES,
  projects: PROJECTS,
  recentDone: [
    { id: 'T-0100', title: 'Old Drey', at: '2026-11-12T10:00:00Z', project: 'drey' },
    { id: 'T-0101', title: 'Old Lariscus', at: '2026-11-12T09:00:00Z', project: 'lariscus' },
  ],
  columns: [
    { phase: { id: 'inbox', title: 'Inbox' }, tickets: [plain('T-0140', 'inbox', 'drey'), plain('T-0141', 'inbox', null)] },
    {
      phase: { id: 'active', title: 'Active' },
      tickets: [
        held('T-0130', 'Drey build', 'ben', 'drey', 2),
        held('T-0131', 'Lariscus build', 'ben', 'lariscus', 2),
        held('T-0132', 'Lariscus plan', 'paul', 'lariscus', 1),
        held('T-0133', 'Drey accept', 'you', 'drey', 3),
      ],
    },
    { phase: { id: 'done', title: 'Done' }, tickets: [] },
  ],
} as unknown as McBoard;

const NOW = Date.parse('2026-11-14T09:00:00Z');
const WAITS = { personaWaits: { 'T-0130': 'ben', 'T-0131': 'ben' }, queued: {} };

function holders() {
  const all = groupsOf([{ kind: 'question', ticketId: 'T-0132', title: 'Lariscus asks', summary: 'Which one?' }], BOARD, []);
  return { all, groups: holderGroupsOf({ lanes: lanesOf(BOARD)!, groups: all, done: BOARD.recentDone ?? [], runs: [], waits: WAITS, paused: [], now: NOW }, t) };
}

describe("the Work list under Mission Control's project filter (req-298)", () => {
  it("narrows the rows to Drey's, keeps a group's load counting every project, and drops a group left empty", () => {
    const { groups } = holders();
    const scope = workProjectScopeOf(BOARD, 'drey');
    const scoped = scopedPhoneGroupsOf(groups, scope);
    expect(scoped.map((group) => group.key)).toEqual(['needs', 'lane:ben', 'phase:inbox', 'done']);
    expect(scoped.find((group) => group.key === 'needs')!.rows.map((row) => row.ticketId)).toEqual(['T-0133']);
    const ben = scoped.find((group) => group.key === 'lane:ben')!;
    expect(ben.rows.map((row) => row.ticketId)).toEqual(['T-0130']);
    expect(ben.load).toBe(groups.find((group) => group.key === 'lane:ben')!.load);
    expect(ben.load).toContain('2 waiting');
    expect(scoped.find((group) => group.key === 'phase:inbox')!.rows.map((row) => row.ticketId)).toEqual(['T-0140']);
    expect(scoped.find((group) => group.key === 'done')!.rows.map((row) => row.ticketId)).toEqual(['T-0100']);
  });

  it('no stored choice reads as the first project; a ticket without a project shows under none', () => {
    const { groups } = holders();
    const stored = scopedPhoneGroupsOf(groups, workProjectScopeOf(BOARD, null));
    expect(stored.find((group) => group.key === 'phase:inbox')!.rows.map((row) => row.ticketId)).toEqual(['T-0140']);
    const lariscus = scopedPhoneGroupsOf(groups, workProjectScopeOf(BOARD, 'lariscus'));
    expect(lariscus.map((group) => group.key)).toEqual(['needs', 'lane:ben', 'done']);
    expect(lariscus.flatMap((group) => group.rows.map((row) => row.ticketId))).toEqual(['T-0132', 'T-0131', 'T-0101']);
  });

  it("the desk's need cards, cards and Done this week follow the filter", () => {
    const { all } = holders();
    const scope = workProjectScopeOf(BOARD, 'lariscus');
    const desk = scopedWorkGroupsOf(all, scope);
    expect(desk[0]).toMatchObject({ kind: 'needs' });
    expect(desk.flatMap((group) => (group.kind === 'phase' ? group.tickets.map((vm) => vm.id) : []))).toEqual(['T-0131', 'T-0132']);
    expect(scopedDoneOf(BOARD.recentDone ?? [], scope).map((entry) => entry.id)).toEqual(['T-0101']);
  });

  it('a row of no ticket, or of a ticket the board does not hold, stays under every choice', () => {
    const scope = workProjectScopeOf(BOARD, 'drey');
    expect(showsTicket(scope, null)).toBe(true);
    expect(showsTicket(scope, 'T-9999')).toBe(true);
    expect(showsTicket(scope, 'T-0131')).toBe(false);
  });

  it("offers each project in the board's order; a stale choice reads as the first project", () => {
    const scope = workProjectScopeOf(BOARD, 'gone');
    expect(scope.filter).toBe('drey');
    expect(workProjectChoicesOf(scope)).toEqual([
      { id: 'drey', label: 'Drey', color: '#8ecbef' },
      { id: 'lariscus', label: 'Lariscus', color: '#f2cfae' },
      { id: 'home-lab', label: 'Home lab', color: '#bfe3cd' },
    ]);
  });
});
